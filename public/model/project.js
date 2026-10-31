// @ts-check
// A session's project in the file panel: a folder's folders and files, the project's text searched, its files downloaded
// and uploaded. The /api/dir, /api/search and transfers' contract, shared with the server (project.js, transfer.js there).
import { count, isRecord, text } from './narrow.js';

/**
 * @typedef {{ text: string, mode: 'text' | 'regex', caseSensitive: boolean, wholeWord: boolean }} SearchQuery
 * @typedef {{ name: string, kind: 'folder' | 'file' }} FolderEntry
 * @typedef {{ path: string, line: number, column: number, text: string }} Match — path: the file's whole; line, column:
 *   from 1; text: the line's
 * @typedef {'not-absolute' | 'not-found' | 'not-a-folder'} FolderRefusal
 * @typedef {{ ok: true, path: string, entries: FolderEntry[], more: boolean } | { ok: false, error: FolderRefusal }} FolderListing
 *   — more: the folder holds more than came
 * @typedef {{ ok: true } | { ok: false, error: 'exists', name: string } | { ok: false, error: 'too-large' | 'bad-name' | 'failed' }} UploadOutcome
 *   — a file uploaded into a folder: exists — one by its name is there, kept, name: the one it is there by, which may
 *   differ in case; failed — anything else the viewer did not do
 * @typedef {{ ok: true, file: Blob } | { ok: false, error: 'not-found' | 'too-large' | 'failed' }} DownloadOutcome — a file
 *   or a folder's zip downloaded: not-found — it is not there, deleted or renamed; too-large — a folder too big to zip;
 *   failed — anything else, a download cut midway too
 * @typedef {{ ok: true, root: string, matches: Match[], more: boolean } | { ok: false, error: FolderRefusal | 'bad-pattern' | 'no-git' }} SearchFound
 *   — more: the search stopped at its limit
 */

/**
 * The /api/dir reply; an entry that cannot be read is left out, a reply of another shape is none.
 * @param {unknown} json
 * @returns {FolderListing | undefined}
 */
export function parseFolderListing(json) {
  if (!isRecord(json)) return undefined;
  if (json.ok === false) return isFolderRefusal(json.error) ? { ok: false, error: json.error } : undefined;
  const path = text(json.path);
  if (json.ok !== true || path === undefined || !Array.isArray(json.entries)) return undefined;
  const entries = json.entries.flatMap((entry) => {
    const name = isRecord(entry) ? text(entry.name) : undefined;
    const kind = isRecord(entry) ? kindOf(entry.kind) : undefined;
    return name === undefined || kind === undefined ? [] : [{ name, kind }];
  });
  return { ok: true, path, entries, more: json.more === true };
}

/**
 * The /api/search reply; a match that cannot be read is left out, a reply of another shape is none.
 * @param {unknown} json
 * @returns {SearchFound | undefined}
 */
export function parseSearchFound(json) {
  if (!isRecord(json)) return undefined;
  if (json.ok === false) return isFolderRefusal(json.error) || json.error === 'bad-pattern' || json.error === 'no-git' ? { ok: false, error: json.error } : undefined;
  const root = text(json.root);
  if (json.ok !== true || root === undefined || !Array.isArray(json.matches)) return undefined;
  const matches = json.matches.flatMap((match) => {
    if (!isRecord(match)) return [];
    const path = text(match.path);
    const line = count(match.line);
    const column = count(match.column);
    const said = text(match.text);
    return path === undefined || line === undefined || column === undefined || said === undefined ? [] : [{ path, line, column, text: said }];
  });
  return { ok: true, root, matches, more: json.more === true };
}

/**
 * The /api/file/upload reply; any refusal the panel does not tell apart, and a reply of another shape, is a failure.
 * @param {unknown} json
 * @returns {UploadOutcome}
 */
export function parseUploadOutcome(json) {
  if (!isRecord(json)) return { ok: false, error: 'failed' };
  if (json.ok === true) return { ok: true };
  const there = text(json.name);
  if (json.ok === false && json.error === 'exists' && there !== undefined) return { ok: false, error: 'exists', name: there };
  return json.ok === false && (json.error === 'too-large' || json.error === 'bad-name') ? { ok: false, error: json.error } : { ok: false, error: 'failed' };
}

/** The refusals of a download the panel tells apart, by the viewer's status for them. */
/** @type {Readonly<Partial<Record<number, 'not-found' | 'too-large'>>>} */
const downloadRefusals = { 404: 'not-found', 413: 'too-large' };

/**
 * A file downloaded from the viewer, or a folder as a zip, its bytes counted as they come.
 * @param {Response | undefined} response — none when the viewer did not answer
 * @param {(received: number, total: number | undefined) => void} progress — total: the length the viewer told, none
 *   for a zip being made
 * @returns {Promise<DownloadOutcome>}
 */
export async function receiveDownload(response, progress) {
  if (response === undefined || response.body === null) return { ok: false, error: 'failed' };
  if (!response.ok) return { ok: false, error: downloadRefusals[response.status] ?? 'failed' };
  const length = response.headers.get('Content-Length');
  const total = length !== null && /^\d+$/.test(length) ? Number(length) : undefined;
  let received = 0;
  const counted = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      progress(received, total);
      controller.enqueue(chunk);
    },
  });
  // the bytes kept by the browser as they come, not in the page: a file of a gigabyte too
  const file = await new Response(response.body.pipeThrough(counted)).blob().catch(() => undefined);
  return file === undefined ? { ok: false, error: 'failed' } : { ok: true, file };
}

/**
 * @param {unknown} value
 * @returns {value is FolderRefusal}
 */
function isFolderRefusal(value) {
  return value === 'not-absolute' || value === 'not-found' || value === 'not-a-folder';
}

/**
 * @param {unknown} value
 * @returns {FolderEntry['kind'] | undefined}
 */
function kindOf(value) {
  return value === 'folder' || value === 'file' ? value : undefined;
}

/**
 * The project a file is searched in: the open session's folder when the file is in it, else the file's own folder.
 * @param {string} path — the file's, either kind of slashes
 * @param {string | undefined} folder — the open session's, none while no session is open
 * @returns {string}
 */
export function projectOfFile(path, folder) {
  // compared as one kind of slashes, a Windows drive's path in any case
  const plain = (/** @type {string} */ one) => {
    const slashed = one.replaceAll('\\', '/').replace(/\/+$/, '');
    return /^[A-Za-z]:\//.test(slashed) ? slashed.toLowerCase() : slashed;
  };
  if (folder !== undefined && plain(path).startsWith(`${plain(folder)}/`)) return folder;
  return path.replace(/[\\/][^\\/]*$/, '');
}

/**
 * @typedef {{ line: number, spec: string, path: string | undefined }} FileImport — path: the file it leads to, none for
 *   a package or a file not there
 * @typedef {{ path: string, line: number, text: string }} FileImporter
 * @typedef {{ ok: true, imports: FileImport[], importedBy: FileImporter[], more: boolean } | { ok: false, error: 'not-absolute' | 'not-found' | 'too-large' | 'not-a-folder' }} FileLinks
 *   — the /api/links reply: what a file imports and what imports it; more: the search for its importers stopped short
 */

/**
 * The /api/links reply; a link that cannot be read is left out, a reply of another shape is none.
 * @param {unknown} json
 * @returns {FileLinks | undefined}
 */
export function parseFileLinks(json) {
  if (!isRecord(json)) return undefined;
  if (json.ok === false) return isFolderRefusal(json.error) || json.error === 'too-large' ? { ok: false, error: json.error } : undefined;
  if (json.ok !== true || !Array.isArray(json.imports) || !Array.isArray(json.importedBy)) return undefined;
  const imports = json.imports.flatMap((link) => {
    const line = isRecord(link) ? count(link.line) : undefined;
    const spec = isRecord(link) ? text(link.spec) : undefined;
    return line === undefined || spec === undefined || !isRecord(link) ? [] : [{ line, spec, path: text(link.path) }];
  });
  const importedBy = json.importedBy.flatMap((link) => {
    const path = isRecord(link) ? text(link.path) : undefined;
    const line = isRecord(link) ? count(link.line) : undefined;
    const said = isRecord(link) ? text(link.text) : undefined;
    return path === undefined || line === undefined || said === undefined ? [] : [{ path, line, text: said }];
  });
  return { ok: true, imports, importedBy, more: json.more === true };
}
