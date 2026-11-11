// @ts-check
// Antigravity CLI's (agy) conversations, from its home — ~/.gemini/antigravity-cli: a folder each under brain/, its
// transcript in it (agy.js reads it); the summary agy keeps of each in conversation_summaries.db — its title, its
// folder, whose subagent it is; and the prompts typed in agy's terminal (history.jsonl), each with the conversation it
// went to. agy titles a conversation someone works in; a program's run (agy -p) it leaves untitled, and nothing is
// typed to it. The summaries are read from a copy, made again when agy has written them since: agy keeps the database
// open, writing it ahead in its WAL file.
import { copyFile, mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord, text } from '../public/model/narrow.js';

/**
 * @typedef {{ title: string | undefined, cwd: string | undefined, kind: 'interactive' | 'sdk' }} AgyFacts — what agy
 *   says of a conversation: the title it gave it, its folder, whether someone works in it or a program runs it (agy -p)
 * @typedef {{ id: string, path: string, modifiedAt: number, size: number, facts: AgyFacts }} AgyConversation — its
 *   transcript, and what agy says of it
 * @typedef {{ title: string | undefined, cwd: string | undefined, subagent: boolean }} Summary — of a conversation, as agy
 *   keeps it
 */

/**
 * @param {string} home — agy's: ~/.gemini/antigravity-cli
 */
export function createAgyConversations(home) {
  /** The summaries read last, and of which state of agy's files: read again once they changed. */
  /** @type {{ stamp: string, summaries: ReadonlyMap<string, Summary> } | undefined} */
  let read;
  /** Where the summaries are copied to be read: made once. */
  /** @type {Promise<string> | undefined} */
  let copies;

  /** @returns {Promise<ReadonlyMap<string, Summary>>} */
  const summaries = async () => {
    const files = ['conversation_summaries.db', 'conversation_summaries.db-wal', 'conversation_summaries.db-shm'].map((name) => join(home, name));
    const stamps = await Promise.all(files.map((file) => stat(file).then((info) => `${info.mtimeMs}:${info.size}`, () => '-')));
    const stamp = stamps.join('|');
    if (read?.stamp === stamp) return read.summaries;
    copies ??= mkdtemp(join(tmpdir(), 'ccw-agy-'));
    const folder = await copies;
    const [database] = files;
    if (database === undefined || stamps[0] === '-') return new Map();
    const copied = await Promise.all(files.map(async (file, at) => (stamps[at] === '-' ? false : copyFile(file, join(folder, `summaries${file.slice(database.length)}`)).then(() => true))));
    const found = copied[0] === true ? await readSummaries(join(folder, 'summaries')) : undefined;
    if (found !== undefined) {
      read = { stamp, summaries: found };
      return found;
    }
    // a copy taken as agy wrote it may be read in part: the summaries read before stand — none before the first
    if (read !== undefined) return read.summaries;
    return new Map();
  };

  return {
    /**
     * The conversations agy keeps a transcript of — a subagent's is part of its parent's — each with what agy says of
     * it; one agy has not summed up yet runs a program's, its folder unknown, until it does.
     * @returns {Promise<AgyConversation[]>}
     */
    async list() {
      const [ids, known, typed] = await Promise.all([readdir(join(home, 'brain')).catch(() => []), summaries(), typedIn(join(home, 'history.jsonl'))]);
      const found = await Promise.all(
        ids.map(async (id) => {
          const summary = known.get(id);
          if (summary?.subagent === true) return [];
          const path = join(home, 'brain', id, '.system_generated', 'logs', 'transcript_full.jsonl');
          const info = await stat(path).catch(() => undefined);
          if (info === undefined || !info.isFile()) return [];
          const title = summary?.title;
          /** @type {AgyFacts} */
          const facts = { title, cwd: summary?.cwd, kind: title !== undefined || typed.has(id) ? 'interactive' : 'sdk' };
          return [{ id, path, modifiedAt: info.mtimeMs, size: info.size, facts }];
        }),
      );
      return found.flat();
    },
  };
}

/**
 * The summaries of a copy of agy's database; none when it cannot be read.
 * @param {string} file
 * @returns {Promise<Map<string, Summary> | undefined>}
 */
async function readSummaries(file) {
  // node:sqlite is still experimental, and says so as it loads: not before a database is there to read
  const { DatabaseSync } = await import('node:sqlite');
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const rows = db.prepare('SELECT conversation_id, title, workspace_uris, nesting_depth, parent_conversation_id FROM conversation_summaries').all();
      return new Map(rows.flatMap((row) => summaryOf(row)));
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * @param {unknown} row
 * @returns {[string, Summary][]}
 */
function summaryOf(row) {
  const id = isRecord(row) ? text(row.conversation_id) : undefined;
  if (!isRecord(row) || id === undefined) return [];
  const title = text(row.title);
  const parent = text(row.parent_conversation_id);
  const subagent = (typeof row.nesting_depth === 'number' && row.nesting_depth > 0) || (parent !== undefined && parent !== '');
  return [[id, { title: title === '' ? undefined : title, cwd: folderOf(row.workspace_uris), subagent }]];
}

/**
 * The first folder of agy's list of a conversation's folders, each a file URI: as written on the computer agy runs on,
 * forward slashes — D:/dev/shop, /home/ann/notes.
 * @param {unknown} uris — the JSON of the list
 * @returns {string | undefined}
 */
function folderOf(uris) {
  /** @type {unknown} */
  let list;
  try {
    list = JSON.parse(text(uris) ?? '');
  } catch {
    return undefined;
  }
  const [first] = Array.isArray(list) ? list : [];
  if (typeof first !== 'string' || !first.startsWith('file://')) return undefined;
  const path = decodeURIComponent(first.slice('file://'.length));
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

/**
 * The conversations a prompt was typed to in agy's terminal.
 * @param {string} file — history.jsonl
 * @returns {Promise<Set<string>>}
 */
async function typedIn(file) {
  const content = await readFile(file, 'utf8').catch(() => '');
  return new Set(
    content.split('\n').flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        const id = isRecord(entry) ? text(entry.conversationId) : undefined;
        return id === undefined ? [] : [id];
      } catch {
        return [];
      }
    }),
  );
}
