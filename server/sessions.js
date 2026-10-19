// @ts-check
// The list of Claude Code sessions — and Codex's — for the sidebar, and lookup of transcript files.
// Layout: <root>/<project folder>/<session id>.jsonl, subagents — <root>/<project folder>/<session id>/subagents/agent-<id>.jsonl;
// Codex's: <codexRoot>/<year>/<month>/<day>/rollout-<time>-<session id>.jsonl, read as Claude Code's (codex.js); one
// its user edited a prompt of and sent again goes on in rollout-<time>-<session id>_<its own id>.jsonl (joined.js).
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { interpretEntry } from '../public/model/entry.js';
import { createCodexReading } from './codex.js';
import { openJoined } from './joined.js';
import { isRecord, text } from '../public/model/narrow.js';
import { readLineAt } from './tail.js';

/**
 * interactive — someone works in it (a terminal, an IDE); sdk — a program drives it through the Agent SDK or claude -p.
 * @typedef {'interactive' | 'sdk'} SessionKind
 * lastActivity — when the last prompt or answer was written; the file's own time moves also when Claude Code adds
 * service records to an old session (a summary on restart, a bridge note)
 * @typedef {{ title: string | undefined, cwd: string | undefined, branch: string | undefined, kind: SessionKind, lastActivity: number | undefined }} SessionSummary
 * activeAt — the last prompt or answer; the file's time while that is not known yet
 * @typedef {'claude' | 'codex'} Agent — whose session it is: Claude Code's, or Codex's
 * @typedef {{ id: string, project: string, agent: Agent, title: string | undefined, cwd: string | undefined, branch: string | undefined, kind: SessionKind, modifiedAt: number, size: number, activeAt: number }} SessionInfo
 * @typedef {{ agentId: string, toolUseId: string | undefined, agentType: string | undefined, description: string | undefined }} SubagentInfo
 * @typedef {{ path: string, project: string, agent: Agent, id: string, modifiedAt: number, size: number }} SessionFile
 * @typedef {{ id: string, cwd: string, startedAt: number }} StartedSession — a session Claude Code has open: its folder,
 *   and when it started
 */

const sessionFileName = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
/** A Codex session's file: the session's id is the first one in its name — a file the session goes on in names its own after it. */
const codexFileName = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[0-9a-f-]{36})?\.jsonl$/i;
const headBytes = 256 * 1024;
const tailBytes = 64 * 1024;
const maxTailBytes = 4 * 1024 * 1024;
const summaryBatch = 16;
/** @type {SessionSummary} */
const unknownSummary = { title: undefined, cwd: undefined, branch: undefined, kind: 'interactive', lastActivity: undefined };

/**
 * Session index with a summary cache: a file is reread only if its size or modification time changed.
 * There can be thousands of sessions, so a single list request computes summaries within a time budget
 * (the first batch always), the remaining sessions go out untitled and are filled in on later requests.
 * @param {string} root — ~/.claude/projects
 * @param {{ summaryBudgetMs: number, missRetryMs: number, codexRoot?: string | undefined, started?: (() => Promise<readonly StartedSession[]>) | undefined }} options
 *   — missRetryMs: how long an id found in no file is not looked for again — the pages ask about it often, and each look
 *   goes over all the files; codexRoot: ~/.codex/sessions, none: no Codex sessions; started: the sessions Claude Code
 *   has open — one with no transcript yet, before its first message, is listed by its folder — none: only transcripts
 */
export function createSessionIndex(root, { summaryBudgetMs, missRetryMs, codexRoot, started }) {
  /** summarizedAt — when the summary was made: a page that asked before learns it with the next changes */
  /** @type {Map<string, { size: number, modifiedAt: number, summary: SessionSummary, summarizedAt: number }>} */
  const summaries = new Map();
  /** @type {Map<string, string>} */
  const pathsById = new Map();
  /** Ids found in no file, and when: not looked for again for a while. */
  /** @type {Map<string, number>} */
  const missedAt = new Map();
  /** @type {Set<string>} */
  const codexPaths = new Set();
  /** A Codex session's files in turn, by its first one — the path it is known by — when it goes on in more than one. */
  /** @type {Map<string, readonly string[]>} */
  const codexParts = new Map();
  /** Where the file before a Codex session's next one leaves off: the next one's first line tells, and never changes. */
  /** @type {Map<string, number | undefined>} */
  const goesOnFrom = new Map();
  /** When each session open with no transcript was first listed: a page that asked before learns of it with the next changes. */
  /** @type {ReadonlyMap<string, number>} */
  let startedListedAt = new Map();

  /**
   * Every session file, Claude Code's and Codex's, newest first — a Codex session's files as one, and a session with a
   * copy under another project's folder (its project moved while it ran) by the file written last: the copy stays as it
   * was made, the session goes on in the other.
   */
  async function allFiles() {
    const codex = codexRoot === undefined ? [] : codexSessions(await codexFiles(codexRoot));
    for (const session of codex) {
      codexPaths.add(session.file.path);
      if (session.paths.length > 1) codexParts.set(session.file.path, session.paths);
    }
    return newestById([...(await sessionFiles(root)), ...codex.map((session) => session.file)].sort((a, b) => b.modifiedAt - a.modifiedAt));
  }

  /** @returns {Promise<readonly SessionInfo[]>} */
  async function list() {
    return (await listed(Date.now())).map(({ info }) => info);
  }

  /**
   * The sessions changed since a version the caller got earlier — the file was written, or its summary is new — so a
   * page that polls the list gets a couple of sessions, not all of them. Without a version, all of them.
   * total — how many there are: fewer than the caller has means some were deleted.
   * @param {number | undefined} since
   * @returns {Promise<{ version: number, total: number, sessions: readonly SessionInfo[] }>}
   */
  async function changes(since) {
    // Taken before the files are looked at: whatever changes while they are, comes with the next changes.
    const version = Date.now();
    const all = await listed(version);
    return { version, total: all.length, sessions: all.filter(({ changedAt }) => since === undefined || changedAt > since).map(({ info }) => info) };
  }

  /**
   * @param {number} version — when this listing began: a summary made now goes out with it, so it counts as of then
   * @returns {Promise<{ info: SessionInfo, changedAt: number }[]>}
   */
  async function listed(version) {
    const files = await allFiles();
    for (const file of files) pathsById.set(file.id, file.path);
    const deadline = Date.now() + summaryBudgetMs;
    const stale = files.filter((file) => cachedSummary(file) === undefined);
    for (let start = 0; start < stale.length && (start === 0 || Date.now() < deadline); start += summaryBatch) {
      await Promise.all(stale.slice(start, start + summaryBatch).map((file) => summarize(file, version)));
    }
    const all = files.map((file) => {
      const cached = cachedSummary(file);
      const { lastActivity, ...summary } = cached === undefined ? unknownSummary : cached.summary;
      const info = { ...omitPath(file), ...summary, activeAt: lastActivity === undefined ? file.modifiedAt : lastActivity };
      return { info, changedAt: cached === undefined ? file.modifiedAt : Math.max(file.modifiedAt, cached.summarizedAt) };
    });
    const transcribed = new Set(files.map((file) => file.id));
    const untranscribed = (started === undefined ? [] : await started()).filter((session) => !transcribed.has(session.id));
    // Claude Code tells it has the session open a while after it started: it counts as changed once it is listed
    const fresh = untranscribed.map((session) => ({ info: startedInfo(session), changedAt: startedListedAt.get(session.id) ?? version }));
    startedListedAt = new Map(fresh.map(({ info, changedAt }) => [info.id, changedAt]));
    // Latest activity first: a session Claude Code merely touched does not jump above the ones being worked in.
    return [...all, ...fresh].sort((a, b) => b.info.activeAt - a.info.activeAt);
  }

  /**
   * @param {SessionFile} file
   * @returns {{ summary: SessionSummary, summarizedAt: number } | undefined}
   */
  function cachedSummary(file) {
    const cached = summaries.get(file.path);
    return cached !== undefined && cached.size === file.size && cached.modifiedAt === file.modifiedAt ? cached : undefined;
  }

  /**
   * @param {SessionFile} file
   * @param {number} version
   */
  async function summarize(file, version) {
    const lines = await edgeLines(await partsOf(file.path));
    const summary = summarizeSession(file.agent === 'codex' ? codexLines(lines) : lines);
    summaries.set(file.path, { size: file.size, modifiedAt: file.modifiedAt, summary, summarizedAt: version });
  }

  /**
   * The session's transcript file; after /cd it moves to another project's folder.
   * @param {string} id
   * @returns {Promise<string | undefined>}
   */
  async function find(id) {
    const known = pathsById.get(id);
    if (known !== undefined && (await exists(known))) return known;
    const missed = missedAt.get(id);
    if (missed !== undefined && Date.now() - missed < missRetryMs) return undefined;
    const found = (await allFiles()).find((file) => file.id === id);
    if (found === undefined) {
      missedAt.set(id, Date.now());
      return undefined;
    }
    missedAt.delete(id);
    pathsById.set(id, found.path);
    return found.path;
  }

  /**
   * @param {string} id
   * @returns {Promise<readonly SubagentInfo[]>}
   */
  async function subagents(id) {
    const sessionPath = await find(id);
    if (sessionPath === undefined) return [];
    const dir = join(sessionPath.replace(/\.jsonl$/, ''), 'subagents');
    const names = await readdirOrEmpty(dir);
    const metas = names.filter((name) => /^agent-[0-9a-z]+\.meta\.json$/i.test(name));
    return Promise.all(metas.map(async (name) => subagentInfo(name, await readFile(join(dir, name), 'utf8'))));
  }

  /**
   * @param {string} id
   * @param {string} agentId
   * @returns {Promise<string | undefined>}
   */
  async function findSubagent(id, agentId) {
    const sessionPath = await find(id);
    if (sessionPath === undefined) return undefined;
    const path = join(sessionPath.replace(/\.jsonl$/, ''), 'subagents', `agent-${agentId}.jsonl`);
    return (await exists(path)) ? path : undefined;
  }

  /**
   * Whose session a transcript file is: a Codex one is read through codex.js.
   * @param {string} path
   * @returns {Agent}
   */
  function agentOf(path) {
    return codexPaths.has(path) ? 'codex' : 'claude';
  }

  /**
   * The files a session is read from, in turn, each up to where the session leaves it: one, but for a Codex session
   * that went on in more.
   * @param {string} path — the session's, as find gives it
   * @returns {Promise<readonly import('./joined.js').Part[]>}
   */
  async function partsOf(path) {
    const paths = codexParts.get(path) ?? [path];
    const ends = await Promise.all(paths.slice(1).map(goesOnAt));
    return paths.map((part, i) => ({ path: part, end: ends[i] }));
  }

  /**
   * @param {string} next — a file a Codex session goes on in
   * @returns {Promise<number | undefined>} — where in the file before the session goes on from: none while the file's
   *   first line is not written whole
   */
  async function goesOnAt(next) {
    if (goesOnFrom.has(next)) return goesOnFrom.get(next);
    const first = await readLineAt([{ path: next, end: undefined }], 0).catch(() => undefined);
    if (first === undefined) return undefined;
    const meta = parse(first);
    const base = isRecord(meta) && isRecord(meta.payload) && isRecord(meta.payload.history_base) ? meta.payload.history_base.end_byte_offset : undefined;
    const end = typeof base === 'number' ? base : undefined;
    goesOnFrom.set(next, end);
    return end;
  }

  /**
   * A session's folder, who runs it and when it was last active, by its id: none for a session not found.
   * @param {string} id
   * @returns {Promise<{ cwd: string | undefined, kind: SessionKind, activeAt: number } | undefined>}
   */
  async function summaryOf(id) {
    const path = await find(id);
    if (path === undefined) return undefined;
    // a session's folder and who runs it do not change: a summary made before tells them, a later file or not
    if (!summaries.has(path)) {
      const file = (await allFiles()).find((one) => one.path === path);
      if (file !== undefined) await summarize(file, Date.now());
    }
    const known = summaries.get(path);
    if (known === undefined) return undefined;
    const { cwd, kind, lastActivity } = known.summary;
    return { cwd, kind, activeAt: lastActivity === undefined ? known.modifiedAt : lastActivity };
  }

  return { list, changes, find, subagents, findSubagent, agentOf, partsOf, summaryOf };
}

/**
 * Codex's lines as Claude Code's, for a summary.
 * @param {readonly string[]} lines
 * @returns {string[]}
 */
function codexLines(lines) {
  const reading = createCodexReading();
  return lines.flatMap((line) => reading.translate(parse(line)).map((record) => JSON.stringify(record)));
}

/**
 * Codex's sessions, each from its files: known by its first one, as new as its newest one, as long as all of them.
 * @param {readonly SessionFile[]} files
 * @returns {{ file: SessionFile, paths: readonly string[] }[]}
 */
function codexSessions(files) {
  /** @type {Map<string, SessionFile[]>} */
  const byId = new Map();
  for (const file of files) byId.set(file.id, [...(byId.get(file.id) ?? []), file]);
  return [...byId.values()].flatMap((own) => {
    // the session's first file names it alone; the ones it goes on in add their own ids, made later
    const parts = [...own].sort((a, b) => (basename(a.path) < basename(b.path) ? -1 : 1));
    const [first] = parts;
    if (first === undefined) return [];
    const modifiedAt = Math.max(...parts.map((part) => part.modifiedAt));
    const size = parts.reduce((sum, part) => sum + part.size, 0);
    return [{ file: { ...first, modifiedAt, size }, paths: parts.map((part) => part.path) }];
  });
}

/**
 * Codex's session files, by its folders of years, months and days.
 * @param {string} codexRoot
 * @returns {Promise<SessionFile[]>}
 */
async function codexFiles(codexRoot) {
  const days = [];
  for (const year of await readdirOrEmpty(codexRoot)) {
    for (const month of await readdirOrEmpty(join(codexRoot, year))) {
      for (const day of await readdirOrEmpty(join(codexRoot, year, month))) days.push(join(codexRoot, year, month, day));
    }
  }
  const nested = await Promise.all(
    days.map(async (dir) => {
      const files = await Promise.all(
        (await readdirOrEmpty(dir)).map(async (name) => {
          const id = codexFileName.exec(name)?.[1];
          if (id === undefined) return undefined;
          const path = join(dir, name);
          const info = await stat(path).catch(() => undefined);
          return info === undefined || !info.isFile() ? undefined : { path, project: 'codex', agent: /** @type {const} */ ('codex'), id, modifiedAt: info.mtimeMs, size: info.size };
        }),
      );
      return files.filter((file) => file !== undefined);
    }),
  );
  return nested.flat();
}

/**
 * The first file of each id among files newest first: the one written last.
 * @param {readonly SessionFile[]} files
 * @returns {SessionFile[]}
 */
function newestById(files) {
  /** @type {Map<string, SessionFile>} */
  const byId = new Map();
  for (const file of files) if (!byId.has(file.id)) byId.set(file.id, file);
  return [...byId.values()];
}

/**
 * All session files, newest first.
 * @param {string} root
 * @returns {Promise<SessionFile[]>}
 */
async function sessionFiles(root) {
  const projects = await readdirOrEmpty(root);
  const nested = await Promise.all(
    projects.map(async (project) => {
      const names = await readdirOrEmpty(join(root, project));
      const files = await Promise.all(
        names.map(async (name) => {
          const match = sessionFileName.exec(name);
          if (match === null || match[1] === undefined) return undefined;
          const path = join(root, project, name);
          const info = await stat(path).catch(() => undefined);
          return info === undefined ? undefined : { path, project, agent: /** @type {const} */ ('claude'), id: match[1], modifiedAt: info.mtimeMs, size: info.size };
        }),
      );
      return files.filter((file) => file !== undefined);
    }),
  );
  return nested.flat().sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/**
 * The start and end of the file: the start holds the first prompt, the end the latest title, folder and message.
 * The last lines can be huge (a base64 screenshot), and an old session can end with screens of service records, so
 * the tail window grows until it contains a whole prompt or answer.
 * @param {readonly import('./joined.js').Part[]} parts — the session's files, read as one
 * @returns {Promise<string[]>}
 */
async function edgeLines(parts) {
  const joined = await openJoined(parts);
  try {
    const size = joined.size;
    const head = Buffer.alloc(Math.min(size, headBytes));
    await joined.read(head, 0);
    const headLines = head.toString('utf8').split('\n');
    if (size <= headBytes) return headLines;
    for (let window = tailBytes; ; window *= 4) {
      const tail = Buffer.alloc(Math.min(size - headBytes, window));
      await joined.read(tail, size - tail.length);
      // The window's first line is almost always cut off — skip it.
      const tailLines = tail.toString('utf8').split('\n').slice(1);
      const found = tailLines.some((line) => line.includes('"type":"user"') || line.includes('"type":"assistant"'));
      if (found || tail.length === size - headBytes || window >= maxTailBytes) return [...headLines, ...tailLines];
    }
  } finally {
    await joined.close();
  }
}

/**
 * @param {string} name
 * @param {string} json — contents of agent-<id>.meta.json
 * @returns {SubagentInfo}
 */
function subagentInfo(name, json) {
  const agentId = name.replace(/^agent-/, '').replace(/\.meta\.json$/, '');
  const meta = parse(json);
  const fields = isRecord(meta) ? meta : {};
  return { agentId, toolUseId: text(fields.toolUseId), agentType: text(fields.agentType), description: text(fields.description) };
}

/**
 * @param {SessionFile} file
 * @returns {Omit<SessionFile, 'path'>}
 */
function omitPath({ path, ...rest }) {
  return rest;
}

/**
 * A session Claude Code has open with no transcript yet: untitled, in its folder — under the project folder its
 * transcript will be written in — active since it started.
 * @param {StartedSession} session
 * @returns {SessionInfo}
 */
function startedInfo({ id, cwd, startedAt }) {
  return { id, project: cwd.replace(/[^a-zA-Z0-9]/g, '-'), agent: 'claude', title: undefined, cwd, branch: undefined, kind: 'interactive', modifiedAt: startedAt, size: 0, activeAt: startedAt };
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function readdirOrEmpty(dir) {
  return readdir(dir).catch(() => []);
}

/** @param {string} path */
async function exists(path) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/**
 * Title: the one set by the user, otherwise the latest one Claude Code generated, otherwise the first line of the first prompt.
 * Folder and branch are the last recorded ones: the session may have been moved with /cd.
 * A session is an SDK one when every record that names how Claude Code was started names the SDK.
 * @param {readonly string[]} lines — JSONL lines (start and end of the file)
 * @returns {SessionSummary}
 */
export function summarizeSession(lines) {
  /** @type {{ custom: string | undefined, ai: string | undefined, prompt: string | undefined, cwd: string | undefined, branch: string | undefined, sdk: boolean, interactive: boolean, lastActivity: number | undefined }} */
  const seen = { custom: undefined, ai: undefined, prompt: undefined, cwd: undefined, branch: undefined, sdk: false, interactive: false, lastActivity: undefined };
  for (const line of lines) {
    const raw = parse(line);
    if (!isRecord(raw)) continue;
    seen.cwd = text(raw.cwd) ?? seen.cwd;
    seen.branch = text(raw.gitBranch) ?? seen.branch;
    const stamp = raw.type === 'user' || raw.type === 'assistant' ? text(raw.timestamp) : undefined;
    const written = stamp === undefined ? Number.NaN : Date.parse(stamp);
    if (!Number.isNaN(written) && (seen.lastActivity === undefined || written > seen.lastActivity)) seen.lastActivity = written;
    const entrypoint = text(raw.entrypoint);
    if (entrypoint !== undefined && entrypoint.startsWith('sdk')) seen.sdk = true;
    if (entrypoint !== undefined && !entrypoint.startsWith('sdk')) seen.interactive = true;
    for (const event of interpretEntry(raw)) {
      if (event.kind === 'title' && event.custom) seen.custom = event.title;
      if (event.kind === 'title' && !event.custom) seen.ai = event.title;
      if (event.kind === 'prompt' && seen.prompt === undefined && event.text !== '') seen.prompt = event.text.split('\n', 1)[0];
    }
  }
  return { title: seen.custom ?? seen.ai ?? seen.prompt, cwd: seen.cwd, branch: seen.branch, kind: seen.sdk && !seen.interactive ? 'sdk' : 'interactive', lastActivity: seen.lastActivity };
}

/**
 * @param {string} line
 * @returns {unknown}
 */
function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined; // a line Claude Code is still writing, or a cut-off start when reading the tail
  }
}
