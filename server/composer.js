// @ts-check
// Prompts from the web page into a live Claude Code session: find its terminal in herdr and type the text there.
//
//   ~/.claude/sessions/<pid>.json  → pid of the process that has the session open (written by Claude Code itself)
//   herdr pane list + process-info → the pane where that process is in the foreground
//   herdr pane send-text / send-keys → the text and Enter, as if the user typed them
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord, text } from '../public/model/narrow.js';
import { claudePaneIds, foregroundPids, toTerminalInput } from './herdr.js';

/**
 * @typedef {{ ok: true, json: unknown } | { ok: false, error: string, missing: boolean }} HerdrReply — missing: herdr is not installed (no such program)
 * @typedef {(args: readonly string[]) => Promise<HerdrReply>} RunHerdr
 * @typedef {{ pid: number, sessionId: string, status: string, updatedAt: number }} LiveRecord
 * @typedef {import('../public/model/composer.js').LiveState} LiveState — the /api/live contract, shared with the page
 * @typedef {import('../public/model/composer.js').SendOutcome} SendOutcome
 */

const presenceTtlMs = 30_000;

/**
 * @param {{ readRecords: () => Promise<readonly unknown[]>, herdr: RunHerdr }} deps
 *   readRecords — contents of ~/.claude/sessions/*.json; herdr — runs the herdr CLI with arguments
 */
export function createComposer({ readRecords, herdr }) {
  /** A process's pane does not change while the process is alive: the search across all panes runs only the first time. */
  /** @type {Map<number, string>} */
  const paneByPid = new Map();

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
    const record = latestRecord(await readRecords(), sessionId);
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
        case 'live':
          return { state: 'live', status: place.record.status, pane: place.pane };
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
      const place = await target(sessionId);
      if (!place.ok) return place;
      return press(place, [
        ['send-text', input],
        ['send-keys', 'enter'],
      ]);
    },
    /**
     * Interrupt the current turn — Esc in the session's terminal.
     * @param {string} sessionId
     * @returns {Promise<SendOutcome>}
     */
    async interrupt(sessionId) {
      const place = await target(sessionId);
      if (!place.ok) return place;
      return press(place, [['send-keys', 'esc']]);
    },
  };
}

/**
 * herdr reports a failure either by its exit code or by an error field in the JSON (e.g. protocol_mismatch).
 * @param {HerdrReply} reply
 * @returns {reply is { ok: true, json: unknown }}
 */
function succeeded(reply) {
  return reply.ok && !(isRecord(reply.json) && reply.json.error !== undefined);
}

/**
 * The registry of running sessions that Claude Code maintains: ~/.claude/sessions/<pid>.json.
 * @param {string} dir
 * @returns {Promise<readonly unknown[]>}
 */
export async function readSessionRecords(dir) {
  const names = await readdir(dir).catch(() => []);
  const records = await Promise.all(
    names
      .filter((name) => /^\d+\.json$/.test(name))
      .map(async (name) => {
        const content = await readFile(join(dir, name), 'utf8').catch(() => undefined);
        try {
          return content === undefined ? undefined : JSON.parse(content);
        } catch {
          return undefined; // the file is being rewritten right now — it will be read on the next poll
        }
      }),
  );
  return records.filter((record) => record !== undefined);
}

/**
 * The latest record of the interactive session with this id: the session may have been reopened in another process.
 * @param {readonly unknown[]} records
 * @param {string} sessionId
 * @returns {LiveRecord | undefined}
 */
function latestRecord(records, sessionId) {
  const matching = records.flatMap((raw) => {
    const record = parseRecord(raw);
    return record !== undefined && record.sessionId === sessionId ? [record] : [];
  });
  return matching.reduce((/** @type {LiveRecord | undefined} */ latest, record) => (latest === undefined || record.updatedAt > latest.updatedAt ? record : latest), undefined);
}

/**
 * @param {unknown} raw — contents of ~/.claude/sessions/<pid>.json
 * @returns {LiveRecord | undefined}
 */
function parseRecord(raw) {
  if (!isRecord(raw) || raw.kind !== 'interactive' || typeof raw.pid !== 'number') return undefined;
  const sessionId = text(raw.sessionId);
  const status = text(raw.status);
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0;
  return sessionId === undefined || status === undefined ? undefined : { pid: raw.pid, sessionId, status, updatedAt };
}
