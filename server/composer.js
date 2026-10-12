// @ts-check
// Prompts from the web page into a live Claude Code session: find its terminal in herdr and type the text there.
//
//   ~/.claude/sessions/<pid>.json  → pid of the process that has the session open (written by Claude Code itself)
//   herdr pane list + process-info → the pane where that process is in the foreground
//   herdr pane send-text / send-keys → the text and Enter, as if the user typed them
import { setTimeout as delay } from 'node:timers/promises';
import { driveBtw } from './btw.js';
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
 * @typedef {import('./rewind.js').RewindOutcome | { ok: false, error: 'herdr-missing' | 'offline' | 'no-herdr' | 'outside-herdr' | 'busy' }} RewindReply
 * @typedef {import('../public/model/composer.js').StopOutcome} StopReply
 * @typedef {import('../public/model/composer.js').BtwReply} BtwReply
 */

const presenceTtlMs = 30_000;
/** A pause between the keys of an answer to a dialog. */
const answerStepMs = 150;
/** How many of the latest prompts sent from the page are kept per session: Esc gives back the one Claude had not started on. */
const keptPrompts = 5;

/**
 * @param {{ readRecords: () => Promise<readonly unknown[]>, herdr: RunHerdr }} deps
 *   readRecords — contents of ~/.claude/sessions/*.json; herdr — runs the herdr CLI with arguments
 */
export function createComposer({ readRecords, herdr }) {
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
   * Where the session is: without herdr it cannot be written to at all (and no input box is needed); without a process it is not running.
   * @param {string} sessionId
   * @returns {Promise<{ kind: 'herdr-missing' | 'offline' } | { kind: 'no-herdr' | 'outside-herdr', record: LiveRecord } | { kind: 'live', record: LiveRecord, pane: string }>}
   */
  async function locate(sessionId) {
    const presence = await herdrPresence();
    if (presence === 'missing') return { kind: 'herdr-missing' };
    const record = latestRecords(await readRecords()).get(sessionId);
    if (record === undefined) return { kind: 'offline' };
    if (presence === 'unreachable') return { kind: 'no-herdr', record };
    const place = await paneOf(record.pid);
    return place.found ? { kind: 'live', record, pane: place.pane } : { kind: place.reason, record };
  }

  /**
   * @param {string} sessionId
   * @returns {Promise<{ ok: true, pane: string, pid: number } | { ok: false, error: 'herdr-missing' | 'offline' | 'no-herdr' | 'outside-herdr' }>}
   */
  async function target(sessionId) {
    const place = await locate(sessionId);
    return place.kind === 'live' ? { ok: true, pane: place.pane, pid: place.record.pid } : { ok: false, error: place.kind };
  }

  /**
   * Keystrokes in order; if herdr refuses, the pane may have closed — forget it and report an error.
   * @param {{ pane: string, pid: number }} place
   * @param {readonly (readonly [string, string])[]} strokes — [herdr pane command, argument]
   * @returns {Promise<SendOutcome>}
   */
  async function press(place, strokes) {
    for (const [command, argument] of strokes) {
      if (!succeeded(await herdr(['pane', command, place.pane, argument]))) {
        paneByPid.delete(place.pid);
        return { ok: false, error: 'send-failed' };
      }
    }
    return { ok: true, pane: place.pane };
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
      const place = await locate(sessionId);
      switch (place.kind) {
        case 'herdr-missing':
        case 'offline':
          return { state: place.kind };
        case 'live': {
          const screen = await terminalOf(place.pane).read();
          return { state: 'live', status: place.record.status, pane: place.pane, dialog: screen === undefined ? undefined : choiceDialog(screen) };
        }
        default:
          return { state: place.kind, status: place.record.status };
      }
    },
    /**
     * A prompt into the session: the text into Claude Code's input box, then Enter. If Claude is busy, Claude Code queues it itself.
     * @param {string} sessionId
     * @param {string} text
     * @returns {Promise<SendOutcome>}
     */
    async send(sessionId, text) {
      const input = toTerminalInput(text);
      if (input === '') return { ok: false, error: 'empty' };
      return inTurn(sessionId, async () => {
        const place = await target(sessionId);
        if (!place.ok) return place;
        const outcome = await press(place, [
          ['send-text', input],
          ['send-keys', 'enter'],
        ]);
        if (outcome.ok) sentPrompts.set(sessionId, [...(sentPrompts.get(sessionId) ?? []), input].slice(-keptPrompts));
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
        const place = await target(sessionId);
        if (!place.ok) return place;
        return driveBtw(terminalOf(place.pane), { question, wait: (ms) => delay(ms) });
      });
    },
    /**
     * An answer to the choice Claude Code waits for — its AskUserQuestion dialog — typed as the terminal would get it.
     * Only while the dialog is on the screen: in the prompt box its digits would be typed as text.
     * @param {string} sessionId
     * @param {readonly import('../public/model/dialog.js').DialogStep[]} steps
     * @returns {Promise<import('../public/model/dialog.js').DialogReply>}
     */
    async answer(sessionId, steps) {
      return inTurn(sessionId, async () => {
        const place = await target(sessionId);
        if (!place.ok) return place;
        const terminal = terminalOf(place.pane);
        const screen = await terminal.read();
        if (screen === undefined || choiceDialog(screen) === undefined) return { ok: false, error: 'no-dialog' };
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
     * the page sent it, and leaves the terminal's box.
     * @param {string} sessionId
     * @returns {Promise<StopReply>}
     */
    async interrupt(sessionId) {
      return inTurn(sessionId, async () => {
        const place = await target(sessionId);
        if (!place.ok) return place;
        const outcome = await driveStop(terminalOf(place.pane), { sent: sentPrompts.get(sessionId) ?? [], wait: (ms) => delay(ms) });
        if (outcome.ok) return { ok: true, pane: place.pane, prompt: outcome.prompt };
        if (outcome.error === 'box-not-cleared') return { ok: false, error: 'box-not-cleared' };
        paneByPid.delete(place.pid);
        return { ok: false, error: 'send-failed' };
      });
    },
    /**
     * Rewind the session to before a message, through Claude Code's /rewind menu in its terminal. Only while Claude
     * waits for input: the keys would interrupt a turn in progress.
     * @param {string} sessionId
     * @param {RewindRequest} request
     * @returns {Promise<RewindReply>}
     */
    async rewind(sessionId, request) {
      return inTurn(sessionId, async () => {
        const place = await locate(sessionId);
        if (place.kind !== 'live') return { ok: false, error: place.kind };
        if (place.record.status === 'busy') return { ok: false, error: 'busy' };
        return driveRewind(terminalOf(place.pane), { ...request, wait: (ms) => delay(ms) });
      });
    },
  };
}
