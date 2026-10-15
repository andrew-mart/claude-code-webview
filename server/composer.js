// @ts-check
// Prompts from the web page into a live Claude Code or Codex session: find its terminal in herdr and type the text there.
//
//   ~/.claude/sessions/<pid>.json  → pid of the process that has the session open (written by Claude Code itself)
//   herdr pane list + process-info → the pane where that process is in the foreground
//   the herdr view                 → the pane a Codex session runs in (herdr-view.js: codexPlace)
//   herdr pane send-text / send-keys → the text and Enter, as if the user typed them
import { setTimeout as delay } from 'node:timers/promises';
import { driveBtw } from './btw.js';
import { inputBox, settleOn, squash } from './claude-screen.js';
import { driveCodexBtw } from './codex-btw.js';
import { driveCodexRewind } from './codex-rewind.js';
import { codexDialog, codexInputBox, codexQueued, showsSideConversation, showsSubagent } from './codex-screen.js';
import { choiceDialog } from './dialog.js';
import { claudePaneIds, foregroundPids, succeeded, toTerminalInput } from './herdr.js';
import { latestRecords } from './registry.js';
import { driveRewind } from './rewind.js';
import { driveStop } from './stop.js';

/**
 * @typedef {{ ok: true, json: unknown, text: string } | { ok: false, error: string, missing: boolean }} HerdrReply — text: what herdr printed; missing: herdr is not installed (no such program)
 * @typedef {(args: readonly string[]) => Promise<HerdrReply>} RunHerdr
 * @typedef {import('./registry.js').LiveRecord} LiveRecord
 * @typedef {import('../public/model/composer.js').LiveState} LiveState — the /api/live contract, shared with the page
 * @typedef {import('../public/model/composer.js').SendOutcome} SendOutcome
 * @typedef {{ stepsUp: number, prompt: string, action: import('./rewind.js').RewindAction }} RewindRequest
 * @typedef {import('./rewind.js').RewindOutcome | { ok: false, error: 'herdr-missing' | 'offline' | 'no-herdr' | 'outside-herdr' | 'busy' | 'subagent' }} RewindReply
 * @typedef {import('../public/model/composer.js').StopOutcome} StopReply
 * @typedef {import('../public/model/composer.js').BtwReply} BtwReply
 * @typedef {{ pane: string, agent: 'claude' | 'codex', status: string, forget: () => void }} Place — the pane a session
 *   runs in, whose agent, busy or not; forget: the pane may have closed — look for it again next time
 * @typedef {{ kind: 'herdr-missing' | 'offline' } | { kind: 'no-herdr' | 'outside-herdr', status: string } | { kind: 'live', place: Place }} Location
 */

const presenceTtlMs = 30_000;
/** Backspaces sent to herdr at once, taking back a prompt Codex did not take. */
const eraseChunk = 100;
/** How much of what a terminal showed lately is read for an answer taller than its screen. */
const recentLines = 400;
/** A pause between the keys of an answer to a dialog. */
const answerStepMs = 150;
/** How many of the latest prompts sent from the page are kept per session: Esc gives back the one Claude had not started on. */
const keptPrompts = 5;

/**
 * @param {{ readRecords: () => Promise<readonly unknown[]>, herdr: RunHerdr, codexPlace: (sessionId: string) => Promise<import('./herdr-view.js').CodexPlace> }} deps
 *   readRecords — contents of ~/.claude/sessions/*.json; herdr — runs the herdr CLI with arguments; codexPlace — where a
 *   Codex session runs
 */
export function createComposer({ readRecords, herdr, codexPlace }) {
  /** A process's pane does not change while the process is alive: the search across all panes runs only the first time. */
  /** @type {Map<number, string>} */
  const paneByPid = new Map();
  /** Prompts the page typed into each session, newest last. */
  /** @type {Map<string, readonly string[]>} */
  const sentPrompts = new Map();
  /**
   * What the page does in a session's terminal goes one thing at a time: the keys of a prompt typed while a side
   * panel or the /rewind menu is open would be the panel's or the menu's.
   * @type {Map<string, Promise<unknown>>}
   */
  const turns = new Map();

  /**
   * The action once the session's terminal is done with the ones before it.
   * @template T
   * @param {string} sessionId
   * @param {() => Promise<T>} action
   * @returns {Promise<T>}
   */
  function inTurn(sessionId, action) {
    const done = (turns.get(sessionId) ?? Promise.resolve()).then(action);
    const settled = done.catch(() => undefined);
    turns.set(sessionId, settled);
    void settled.then(() => {
      if (turns.get(sessionId) === settled) turns.delete(sessionId);
    });
    return done;
  }

  /**
   * @param {number} pid
   * @returns {Promise<{ found: true, pane: string } | { found: false, reason: 'no-herdr' | 'outside-herdr' }>}
   */
  async function paneOf(pid) {
    const cached = paneByPid.get(pid);
    if (cached !== undefined) return { found: true, pane: cached };
    const list = await herdr(['pane', 'list']);
    if (!succeeded(list)) return { found: false, reason: 'no-herdr' };
    for (const pane of claudePaneIds(list.json)) {
      const info = await herdr(['pane', 'process-info', '--pane', pane]);
      if (succeeded(info) && foregroundPids(info.json).includes(pid)) {
        paneByPid.set(pid, pane);
        return { found: true, pane };
      }
    }
    return { found: false, reason: 'outside-herdr' };
  }

  /** Whether herdr is installed is cached briefly: the page asks about the session every few seconds. */
  /** @type {{ at: number, presence: 'present' | 'missing' | 'unreachable' } | undefined} */
  let presenceCache;

  /** @returns {Promise<'present' | 'missing' | 'unreachable'>} */
  async function herdrPresence() {
    if (presenceCache !== undefined && Date.now() - presenceCache.at < presenceTtlMs) return presenceCache.presence;
    const reply = await herdr(['pane', 'list']);
    const presence = succeeded(reply) ? 'present' : !reply.ok && reply.missing ? 'missing' : 'unreachable';
    presenceCache = { at: Date.now(), presence };
    return presence;
  }

  /**
   * Where the session is: without herdr it cannot be written to at all (and no input box is needed); without a process it
   * is not running. A session Claude Code has no record of may be Codex's.
   * @param {string} sessionId
   * @returns {Promise<Location>}
   */
  async function locate(sessionId) {
    const presence = await herdrPresence();
    if (presence === 'missing') return { kind: 'herdr-missing' };
    const record = latestRecords(await readRecords()).get(sessionId);
    if (record === undefined) return locateCodex(sessionId, presence);
    if (presence === 'unreachable') return { kind: 'no-herdr', status: record.status };
    const place = await paneOf(record.pid);
    if (!place.found) return { kind: place.reason, status: record.status };
    return { kind: 'live', place: { pane: place.pane, agent: 'claude', status: record.status, forget: () => paneByPid.delete(record.pid) } };
  }

  /**
   * A Codex session: in a herdr pane, busy while herdr sees its agent at work; open in Codex outside herdr; or closed.
   * @param {string} sessionId
   * @param {'present' | 'unreachable'} presence
   * @returns {Promise<Location>}
   */
  async function locateCodex(sessionId, presence) {
    const place = await codexPlace(sessionId);
    switch (place.found) {
      case 'pane':
        return { kind: 'live', place: { pane: place.pane, agent: 'codex', status: place.working ? 'busy' : 'idle', forget: () => undefined } };
      case 'elsewhere':
        return { kind: presence === 'unreachable' ? 'no-herdr' : 'outside-herdr', status: 'idle' };
      case 'none':
        return { kind: 'offline' };
      default:
        throw new Error(`No such place of a Codex session: ${JSON.stringify(place)}`);
    }
  }

  /**
   * @param {string} sessionId
   * @returns {Promise<{ ok: true, place: Place } | { ok: false, error: 'herdr-missing' | 'offline' | 'no-herdr' | 'outside-herdr' }>}
   */
  async function target(sessionId) {
    const where = await locate(sessionId);
    return where.kind === 'live' ? { ok: true, place: where.place } : { ok: false, error: where.kind };
  }

  /**
   * Keystrokes in order; if herdr refuses, the pane may have closed — forget it and report an error.
   * @param {Place} place
   * @param {readonly (readonly [string, string])[]} strokes — [herdr pane command, argument]
   * @returns {Promise<SendOutcome>}
   */
  async function press(place, strokes) {
    for (const [command, argument] of strokes) {
      if (!succeeded(await herdr(['pane', command, place.pane, argument]))) {
        place.forget();
        return { ok: false, error: 'send-failed' };
      }
    }
    return { ok: true, pane: place.pane };
  }

  /**
   * The text typed into the session's prompt box, and a wait until the box shows it. A long text comes into Claude Code
   * — and Codex — as a paste, and a key that comes while it is still being pasted joins it — Enter as a line break, and
   * nothing is sent. At most a few seconds: then the next key goes anyway.
   * @param {Place} place
   * @param {string} input
   * @returns {Promise<SendOutcome>}
   */
  async function typeIn(place, input) {
    const typed = await press(place, [['send-text', input]]);
    const boxOf = place.agent === 'codex' ? codexInputBox : inputBox;
    if (typed.ok) await settleOn(terminalOf(place.pane), (ms) => delay(ms), (screen) => showsTyped(boxOf(screen), input));
    return typed;
  }

  /**
   * A prompt into Codex's box and in with the key — Enter, or Tab to queue it — once Codex can take it: not while it asks
   * something — a picker's chosen option would take the Enter — nor while its terminal shows a sub-agent's thread, whose
   * input its parent controls, or a side conversation, which would take the prompt for a follow-up question. The prompt is looked for in the box after: one Codex did not take is taken back out, not
   * left there to be joined by the next one.
   * @param {Place} place
   * @param {string} input
   * @param {'enter' | 'tab'} key
   * @returns {Promise<SendOutcome>}
   */
  async function sendToCodex(place, input, key) {
    const terminal = terminalOf(place.pane);
    // a screen Codex is drawing anew shows no box for a moment
    const screen = (await settleOn(terminal, (ms) => delay(ms), (now) => codexInputBox(now) !== undefined)) ?? (await terminal.read());
    if (screen === undefined || codexInputBox(screen) === undefined) return { ok: false, error: 'asking' };
    if (showsSubagent(screen)) return { ok: false, error: 'subagent' };
    if (showsSideConversation(screen)) return { ok: false, error: 'side' };
    const typed = await typeIn(place, input);
    if (!typed.ok) return typed;
    const sent = await press(place, [['send-keys', key]]);
    if (!sent.ok) return sent;
    const taken = await settleOn(terminal, (ms) => delay(ms), (now) => !holdsTyped(codexInputBox(now), input));
    if (taken !== undefined) return sent;
    await takeOut(terminal, codexInputBox((await terminal.read()) ?? ''), input);
    return { ok: false, error: 'not-taken' };
  }

  /**
   * A prompt Codex did not take, taken back out of its box: a long paste's mark — whole at one key, or the rest of it
   * key by key — or the prompt as typed, its end at the box's end — a long one scrolls the box, its start out of sight.
   * @param {import('./claude-screen.js').Terminal} terminal
   * @param {string | undefined} box — what Codex's box shows
   * @param {string} input
   */
  async function takeOut(terminal, box, input) {
    if (box === undefined) return;
    const paste = /\[Pasted Content \d+ chars\]$/.exec(box);
    if (paste !== null) {
      await terminal.keys('backspace');
      const left = codexInputBox((await terminal.read()) ?? '');
      if (left !== undefined && /\[Pasted Content \d+ chars$/.test(left)) await erase(terminal, [...paste[0]].length - 1);
      return;
    }
    if (squash(box).endsWith(squash(input).slice(-24))) await erase(terminal, [...input].length);
  }

  /**
   * Backspaces, a chunk at a time.
   * @param {import('./claude-screen.js').Terminal} terminal
   * @param {number} count
   */
  async function erase(terminal, count) {
    const keys = Array.from({ length: count }, () => 'backspace');
    for (let at = 0; at < keys.length; at += eraseChunk) await terminal.keys(...keys.slice(at, at + eraseChunk));
  }

  /**
   * A prompt into Claude Code's box, then Enter.
   * @param {Place} place
   * @param {string} input
   * @returns {Promise<SendOutcome>}
   */
  async function sendToClaude(place, input) {
    const typed = await typeIn(place, input);
    return typed.ok ? press(place, [['send-keys', 'enter']]) : typed;
  }

  /**
   * A prompt into Claude Code's box, and what waits in its queue sent at once with it.
   * @param {Place} place
   * @param {string} input — none: the queue goes alone
   * @returns {Promise<SendOutcome>}
   */
  async function sendNowToClaude(place, input) {
    // into the box without Enter: Enter would only queue it as well
    /** @type {SendOutcome} */
    const typed = input === '' ? { ok: true, pane: place.pane } : await typeIn(place, input);
    return typed.ok
      ? press(place, [
          ['send-keys', 'ctrl+x'],
          ['send-keys', 'ctrl+s'],
        ])
      : typed;
  }

  /**
   * What the pane's terminal showed lately, lines scrolled off its screen included.
   * @param {string} pane
   * @returns {Promise<string | undefined>}
   */
  async function recentOf(pane) {
    const reply = await herdr(['pane', 'read', pane, '--source', 'recent', '--lines', String(recentLines), '--format', 'text']);
    return reply.ok ? reply.text : undefined;
  }

  /**
   * The screen with its styles — what the plain text loses, such as the prompt Codex shows browsed.
   * @param {string} pane
   * @returns {Promise<string | undefined>}
   */
  async function styledScreenOf(pane) {
    const reply = await herdr(['pane', 'read', pane, '--source', 'visible', '--format', 'ansi']);
    return reply.ok ? reply.text : undefined;
  }

  /**
   * The session's terminal: what its screen shows, keys and text typed into it.
   * @param {string} pane
   * @returns {import('./claude-screen.js').Terminal}
   */
  function terminalOf(pane) {
    return {
      read: async () => {
        const reply = await herdr(['pane', 'read', pane, '--source', 'visible', '--format', 'text']);
        return reply.ok ? reply.text : undefined;
      },
      keys: async (...keys) => succeeded(await herdr(['pane', 'send-keys', pane, ...keys])),
      text: async (text) => succeeded(await herdr(['pane', 'send-text', pane, text])),
    };
  }

  return {
    /**
     * @param {string} sessionId
     * @returns {Promise<LiveState>}
     */
    async liveState(sessionId) {
      const where = await locate(sessionId);
      switch (where.kind) {
        case 'herdr-missing':
        case 'offline':
          return { state: where.kind };
        case 'live': {
          const { place } = where;
          const screen = await terminalOf(place.pane).read();
          // Codex's terminal showing a sub-agent's thread, or a side conversation, is not where a prompt goes: the page
          // waits for the main thread
          const status = place.agent !== 'codex' || screen === undefined ? place.status : showsSubagent(screen) ? 'subagent' : showsSideConversation(screen) ? 'side' : place.status;
          // Claude Code's queue is in its transcript; Codex's is on its screen alone
          const queued = place.agent === 'codex' && screen !== undefined ? codexQueued(screen) : [];
          return { state: 'live', status, pane: place.pane, dialog: screen === undefined ? undefined : dialogOf(place.agent, screen), queued };
        }
        default:
          return { state: where.kind, status: where.status };
      }
    },
    /**
     * A prompt into the session: the text into its input box, then Enter. If Claude is busy, Claude Code queues it
     * itself; while Codex works, Tab queues it — its Enter would put it into the turn under way.
     * @param {string} sessionId
     * @param {string} text
     * @returns {Promise<SendOutcome>}
     */
    async send(sessionId, text) {
      const input = toTerminalInput(text);
      if (input === '') return { ok: false, error: 'empty' };
      return inTurn(sessionId, async () => {
        const found = await target(sessionId);
        if (!found.ok) return found;
        const { place } = found;
        const outcome = place.agent === 'codex' ? await sendToCodex(place, input, place.status === 'busy' ? 'tab' : 'enter') : await sendToClaude(place, input);
        if (outcome.ok) sentPrompts.set(sessionId, [...(sentPrompts.get(sessionId) ?? []), input].slice(-keptPrompts));
        return outcome;
      });
    },
    /**
     * What waits in Claude Code's queue, sent at once with the box's text: its send-now key — Ctrl+Enter, which a terminal
     * may pass on as plain Enter; Ctrl+X Ctrl+S reaches it from any. Claude's work that can go to the background goes
     * there and Claude reads the messages in the same turn; otherwise the turn is stopped and they go next.
     * Codex's Enter puts a prompt into its turn under way: it has no queue the viewer sends.
     * @param {string} sessionId
     * @param {string} text — none: the queue goes alone
     * @returns {Promise<SendOutcome>}
     */
    async sendNow(sessionId, text) {
      const input = toTerminalInput(text);
      return inTurn(sessionId, async () => {
        const found = await target(sessionId);
        if (!found.ok) return found;
        const { place } = found;
        if (place.agent === 'codex' && input === '') return { ok: false, error: 'empty' };
        const outcome = place.agent === 'codex' ? await sendToCodex(place, input, 'enter') : await sendNowToClaude(place, input);
        if (outcome.ok && input !== '') sentPrompts.set(sessionId, [...(sentPrompts.get(sessionId) ?? []), input].slice(-keptPrompts));
        return outcome;
      });
    },
    /**
     * A side question, as /btw in the session's terminal: Claude answers from the conversation without adding to it.
     * @param {string} sessionId
     * @param {string} question
     * @returns {Promise<BtwReply>}
     */
    async btw(sessionId, question) {
      if (question.trim() === '') return { ok: false, error: 'empty' };
      return inTurn(sessionId, async () => {
        const where = await locate(sessionId);
        if (where.kind !== 'live') return { ok: false, error: where.kind };
        const terminal = terminalOf(where.place.pane);
        // Codex answers it in a side conversation of its own (codex-btw.js)
        const recent = () => recentOf(where.place.pane);
        return where.place.agent === 'codex' ? driveCodexBtw(terminal, { question, wait: (ms) => delay(ms), recent }) : driveBtw(terminal, { question, wait: (ms) => delay(ms) });
      });
    },
    /**
     * An answer to the choice the agent waits for — Claude Code's AskUserQuestion dialog, what Codex asks — typed as the
     * terminal would get it. Only while the dialog is on the screen: in the prompt box its keys would be typed as text.
     * @param {string} sessionId
     * @param {readonly import('../public/model/dialog.js').DialogStep[]} steps
     * @returns {Promise<import('../public/model/dialog.js').DialogReply>}
     */
    async answer(sessionId, steps) {
      return inTurn(sessionId, async () => {
        const where = await locate(sessionId);
        if (where.kind !== 'live') return { ok: false, error: where.kind };
        const terminal = terminalOf(where.place.pane);
        const screen = await terminal.read();
        if (screen === undefined || dialogOf(where.place.agent, screen) === undefined) return { ok: false, error: 'no-dialog' };
        for (const step of steps) {
          const done = 'key' in step ? await terminal.keys(step.key) : await terminal.text(step.text);
          if (!done) return { ok: false, error: 'send-failed' };
          // a digit opens "Type something" for the words that follow: the dialog redraws first
          await delay(answerStepMs);
        }
        return { ok: true };
      });
    },
    /**
     * Interrupt the current turn — Esc in the session's terminal. A prompt Claude had not started on comes back, as
     * the page sent it, and leaves the terminal's box; Codex's Esc stops its turn, and that is all.
     * @param {string} sessionId
     * @returns {Promise<StopReply>}
     */
    async interrupt(sessionId) {
      return inTurn(sessionId, async () => {
        const found = await target(sessionId);
        if (!found.ok) return found;
        const { place } = found;
        if (place.agent === 'codex') {
          const stopped = await press(place, [['send-keys', 'esc']]);
          return stopped.ok ? { ok: true, pane: place.pane, prompt: undefined } : stopped;
        }
        const outcome = await driveStop(terminalOf(place.pane), { sent: sentPrompts.get(sessionId) ?? [], wait: (ms) => delay(ms) });
        if (outcome.ok) return { ok: true, pane: place.pane, prompt: outcome.prompt };
        if (outcome.error === 'box-not-cleared') return { ok: false, error: 'box-not-cleared' };
        place.forget();
        return { ok: false, error: 'send-failed' };
      });
    },
    /**
     * Rewind the session to before a message, through Claude Code's /rewind menu in its terminal, or Codex's backtrack.
     * Only while the agent waits for input: the keys would interrupt a turn in progress. Codex rewinds the conversation
     * alone — its files stay as they are — and not from a sub-agent's thread.
     * @param {string} sessionId
     * @param {RewindRequest} request
     * @returns {Promise<RewindReply>}
     */
    async rewind(sessionId, request) {
      return inTurn(sessionId, async () => {
        const where = await locate(sessionId);
        if (where.kind !== 'live') return { ok: false, error: where.kind };
        const { place } = where;
        if (place.agent === 'claude') {
          if (place.status === 'busy') return { ok: false, error: 'busy' };
          return driveRewind(terminalOf(place.pane), { ...request, wait: (ms) => delay(ms) });
        }
        if (request.action !== 'conversation') return { ok: false, error: 'option-not-found' };
        if (place.status === 'busy') return { ok: false, error: 'busy' };
        const terminal = terminalOf(place.pane);
        const screen = await terminal.read();
        if (screen !== undefined && showsSubagent(screen)) return { ok: false, error: 'subagent' };
        return driveCodexRewind({ ...terminal, styled: () => styledScreenOf(place.pane) }, { stepsUp: request.stepsUp, prompt: request.prompt, wait: (ms) => delay(ms) });
      });
    },
  };
}

/**
 * Whether the prompt box shows the text typed into it: its end, or the mark Claude Code — or Codex — puts for a paste.
 * No box on the screen — a menu or a dialog is open — there is nothing to wait for.
 * @param {string | undefined} box
 * @param {string} text
 */
function showsTyped(box, text) {
  return box === undefined || /\[Pasted (text|Content)/.test(box) || squash(box).includes(squash(text).slice(-24));
}

/**
 * What the agent asks in its terminal, as its screen shows it.
 * @param {'claude' | 'codex'} agent
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
function dialogOf(agent, screen) {
  return agent === 'claude' ? choiceDialog(screen) : codexDialog(screen);
}

/**
 * Whether Codex's box still holds the prompt typed into it: its end, or the mark Codex puts for a long paste. No box —
 * a dialog over it — it is not there to hold it.
 * @param {string | undefined} box
 * @param {string} text
 */
function holdsTyped(box, text) {
  return box !== undefined && (box.includes('[Pasted Content') || squash(box).includes(squash(text).slice(-24)));
}
