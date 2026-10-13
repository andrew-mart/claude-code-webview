// @ts-check
// A branch's changes: what it changed since it was made from its parent branch — its commits and what is not committed
// yet — file by file, each with its diff. The /api/changes contract, shared with the server.
import { count, isRecord, text } from './narrow.js';

/**
 * @typedef {'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'untracked'} ChangeStatus
 * @typedef {{ path: string, oldPath: string | undefined, status: ChangeStatus, added: number | undefined, removed: number | undefined }} ChangedFile
 *   — oldPath: a renamed or copied file's path before; added, removed: its lines, none for a binary file
 * @typedef {'made-from' | 'main-branch' | 'upstream' | 'head' | 'chosen'} BaseHow — made-from: the branch it was made
 *   from, as git recorded it; main-branch: no such record, the repository's main branch; upstream: the main branch
 *   itself, against what it was pushed to; head: nothing to compare with but the last commit; chosen: the page's choice
 * @typedef {{ name: string, sha: string, how: BaseHow }} BranchBase — sha: the commit the branch left its base at
 * @typedef {{ sha: string, subject: string }} BranchCommit
 * @typedef {{ ok: true, root: string, branch: string | undefined, base: BranchBase, commits: BranchCommit[], files: ChangedFile[], branches: string[] } | { ok: false, error: 'not-a-repository' | 'no-git' }} BranchChanges
 *   — root: the repository's top folder, files' paths are from it; branch: none when HEAD is detached; commits: the
 *   newest first; branches: those a base can be chosen from
 * @typedef {{ ok: true, rows: import('./tool.js').DiffRow[], binary: boolean } | { ok: false, error: 'not-a-repository' | 'no-git' | 'not-in-repository' }} FileDiff
 *   — one file's diff since the base; binary: a file with no lines to show
 */

/** @type {ReadonlySet<string>} */
const statuses = new Set(['modified', 'added', 'deleted', 'renamed', 'copied', 'type-changed', 'untracked']);
/** @type {ReadonlySet<string>} */
const hows = new Set(['made-from', 'main-branch', 'upstream', 'head', 'chosen']);
/** @type {ReadonlySet<string>} */
const rowKinds = new Set(['add', 'del', 'ctx', 'gap']);

/**
 * The /api/changes reply: what cannot be read in it — a file of a status not known, a branch not named — is left out;
 * a reply of another shape is none.
 * @param {unknown} json
 * @returns {BranchChanges | undefined}
 */
export function parseBranchChanges(json) {
  if (!isRecord(json)) return undefined;
  if (json.ok === false) return json.error === 'not-a-repository' || json.error === 'no-git' ? { ok: false, error: json.error } : undefined;
  const root = text(json.root);
  const base = baseOf(json.base);
  if (json.ok !== true || root === undefined || base === undefined) return undefined;
  return {
    ok: true,
    root,
    branch: text(json.branch),
    base,
    commits: listOf(json.commits).flatMap((commit) => {
      const sha = text(commit.sha);
      const subject = text(commit.subject);
      return sha === undefined || subject === undefined ? [] : [{ sha, subject }];
    }),
    files: listOf(json.files).flatMap((file) => {
      const path = text(file.path);
      const status = text(file.status);
      return path === undefined || status === undefined || !isStatus(status) ? [] : [{ path, oldPath: text(file.oldPath), status, added: count(file.added), removed: count(file.removed) }];
    }),
    branches: (Array.isArray(json.branches) ? json.branches : []).flatMap((name) => (typeof name === 'string' ? [name] : [])),
  };
}

/**
 * The /api/changes/file reply: its rows, a row that cannot be read left out; a reply of another shape is none.
 * @param {unknown} json
 * @returns {FileDiff | undefined}
 */
export function parseFileDiff(json) {
  if (!isRecord(json)) return undefined;
  if (json.ok === false) return json.error === 'not-a-repository' || json.error === 'no-git' || json.error === 'not-in-repository' ? { ok: false, error: json.error } : undefined;
  if (json.ok !== true || typeof json.binary !== 'boolean') return undefined;
  return {
    ok: true,
    binary: json.binary,
    rows: listOf(json.rows).flatMap((row) => {
      const kind = text(row.kind);
      const line = text(row.text);
      return kind === undefined || line === undefined || !isRowKind(kind) ? [] : [{ kind, oldNo: count(row.oldNo), newNo: count(row.newNo), text: line }];
    }),
  };
}

/**
 * @param {unknown} value
 * @returns {BranchBase | undefined}
 */
function baseOf(value) {
  if (!isRecord(value)) return undefined;
  const name = text(value.name);
  const sha = text(value.sha);
  const how = text(value.how);
  return name === undefined || sha === undefined || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) || how === undefined || !isHow(how) ? undefined : { name, sha, how };
}

/**
 * The records of a list; none when it is no list.
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function listOf(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * @param {string} value
 * @returns {value is ChangeStatus}
 */
function isStatus(value) {
  return statuses.has(value);
}

/**
 * @param {string} value
 * @returns {value is BaseHow}
 */
function isHow(value) {
  return hows.has(value);
}

/**
 * @param {string} value
 * @returns {value is import('./tool.js').DiffRow['kind']}
 */
function isRowKind(value) {
  return rowKinds.has(value);
}
