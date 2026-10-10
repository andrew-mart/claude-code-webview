// @ts-check
// The list of Claude Code sessions for the sidebar, and lookup of transcript files.
// Layout: <root>/<project folder>/<session id>.jsonl, subagents — <root>/<project folder>/<session id>/subagents/agent-<id>.jsonl
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { interpretEntry } from '../public/model/entry.js';
import { isRecord, text } from '../public/model/narrow.js';

/**
 * interactive — someone works in it (a terminal, an IDE); sdk — a program drives it through the Agent SDK or claude -p.
 * @typedef {'interactive' | 'sdk'} SessionKind
 * @typedef {{ title: string | undefined, cwd: string | undefined, branch: string | undefined, kind: SessionKind }} SessionSummary
 * @typedef {{ id: string, project: string, title: string | undefined, cwd: string | undefined, branch: string | undefined, kind: SessionKind, modifiedAt: number, size: number }} SessionInfo
 * @typedef {{ agentId: string, toolUseId: string | undefined, agentType: string | undefined, description: string | undefined }} SubagentInfo
 * @typedef {{ path: string, project: string, id: string, modifiedAt: number, size: number }} SessionFile
 */

const sessionFileName = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const headBytes = 256 * 1024;
const tailBytes = 64 * 1024;
const maxTailBytes = 4 * 1024 * 1024;
const summaryBatch = 16;
/** @type {SessionSummary} */
const unknownSummary = { title: undefined, cwd: undefined, branch: undefined, kind: 'interactive' };

/**
 * Session index with a summary cache: a file is reread only if its size or modification time changed.
 * There can be thousands of sessions, so a single list request computes summaries within a time budget
 * (the first batch always), the remaining sessions go out untitled and are filled in on later requests.
 * @param {string} root — ~/.claude/projects
 * @param {{ summaryBudgetMs: number }} options
 */
export function createSessionIndex(root, { summaryBudgetMs }) {
  /** @type {Map<string, { size: number, modifiedAt: number, summary: SessionSummary }>} */
  const summaries = new Map();
  /** @type {Map<string, string>} */
  const pathsById = new Map();

  /** @returns {Promise<readonly SessionInfo[]>} */
  async function list() {
    const files = await sessionFiles(root);
    for (const file of files) pathsById.set(file.id, file.path);
    const deadline = Date.now() + summaryBudgetMs;
    const stale = files.filter((file) => cachedSummary(file) === undefined);
    for (let start = 0; start < stale.length && (start === 0 || Date.now() < deadline); start += summaryBatch) {
      await Promise.all(stale.slice(start, start + summaryBatch).map(summarize));
    }
    return files.map((file) => ({ ...omitPath(file), ...(cachedSummary(file) ?? unknownSummary) }));
  }

  /**
   * @param {SessionFile} file
   * @returns {SessionSummary | undefined}
   */
  function cachedSummary(file) {
    const cached = summaries.get(file.path);
    return cached !== undefined && cached.size === file.size && cached.modifiedAt === file.modifiedAt ? cached.summary : undefined;
  }

  /** @param {SessionFile} file */
  async function summarize(file) {
    const summary = summarizeSession(await edgeLines(file.path, file.size));
    summaries.set(file.path, { size: file.size, modifiedAt: file.modifiedAt, summary });
  }

  /**
   * The session's transcript file; after /cd it moves to another project's folder.
   * @param {string} id
   * @returns {Promise<string | undefined>}
   */
  async function find(id) {
    const known = pathsById.get(id);
    if (known !== undefined && (await exists(known))) return known;
    const found = (await sessionFiles(root)).find((file) => file.id === id);
    if (found !== undefined) pathsById.set(id, found.path);
    return found?.path;
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

  return { list, find, subagents, findSubagent };
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
          return info === undefined ? undefined : { path, project, id: match[1], modifiedAt: info.mtimeMs, size: info.size };
        }),
      );
      return files.filter((file) => file !== undefined);
    }),
  );
  return nested.flat().sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/**
 * The start and end of the file: the start holds the first prompt, the end the latest title and folder.
 * The last lines can be huge (a base64 screenshot), so the tail window grows
 * until it contains a whole entry with a folder.
 * @param {string} path
 * @param {number} size
 * @returns {Promise<string[]>}
 */
async function edgeLines(path, size) {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(Math.min(size, headBytes));
    await handle.read(head, 0, head.length, 0);
    const headLines = head.toString('utf8').split('\n');
    if (size <= headBytes) return headLines;
    for (let window = tailBytes; ; window *= 4) {
      const tail = Buffer.alloc(Math.min(size - headBytes, window));
      await handle.read(tail, 0, tail.length, size - tail.length);
      // The window's first line is almost always cut off — skip it.
      const tailLines = tail.toString('utf8').split('\n').slice(1);
      const found = tailLines.some((line) => line.includes('"cwd":'));
      if (found || tail.length === size - headBytes || window >= maxTailBytes) return [...headLines, ...tailLines];
    }
  } finally {
    await handle.close();
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
  /** @type {{ custom: string | undefined, ai: string | undefined, prompt: string | undefined, cwd: string | undefined, branch: string | undefined, sdk: boolean, interactive: boolean }} */
  const seen = { custom: undefined, ai: undefined, prompt: undefined, cwd: undefined, branch: undefined, sdk: false, interactive: false };
  for (const line of lines) {
    const raw = parse(line);
    if (!isRecord(raw)) continue;
    seen.cwd = text(raw.cwd) ?? seen.cwd;
    seen.branch = text(raw.gitBranch) ?? seen.branch;
    const entrypoint = text(raw.entrypoint);
    if (entrypoint !== undefined && entrypoint.startsWith('sdk')) seen.sdk = true;
    if (entrypoint !== undefined && !entrypoint.startsWith('sdk')) seen.interactive = true;
    for (const event of interpretEntry(raw)) {
      if (event.kind === 'title' && event.custom) seen.custom = event.title;
      if (event.kind === 'title' && !event.custom) seen.ai = event.title;
      if (event.kind === 'prompt' && seen.prompt === undefined && event.text !== '') seen.prompt = event.text.split('\n', 1)[0];
    }
  }
  return { title: seen.custom ?? seen.ai ?? seen.prompt, cwd: seen.cwd, branch: seen.branch, kind: seen.sdk && !seen.interactive ? 'sdk' : 'interactive' };
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
