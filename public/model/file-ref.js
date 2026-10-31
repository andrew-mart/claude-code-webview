// @ts-check
// File references in answer text: "D:/dev/x/a.cs:42" → path and line.

/**
 * @typedef {{ index: number, text: string, path: string, line: number | undefined, endLine: number | undefined }} FileRef
 */

/**
 * A path character and a path's last character: a trailing dot ends the sentence, it is not part of the name.
 * Typographic quotes («», “”, ‘’) close the quote around a path, they are not part of it either.
 */
const pathChar = String.raw`[^\s"'\`<>|*?()[\]{},;:«»“”‘’„]`;
const pathEnd = String.raw`[^\s"'\`<>|*?()[\]{},;:.«»“”‘’„]`;
const windowsPath = String.raw`[A-Za-z]:[\\/]${pathChar}*${pathEnd}`;
/**
 * A macOS/Linux path counts as a reference only if it starts with ~ or a common root: otherwise addresses
 * like /api/health, which answers are full of, would become references.
 */
const posixRoots = ['Users', 'home', 'tmp', 'var', 'opt', 'etc', 'usr', 'mnt', 'srv', 'root', 'private', 'Volumes', 'workspace', 'workspaces'];
const posixPath = String.raw`(?:~|/(?:${posixRoots.join('|')}))/${pathChar}*${pathEnd}`;

/**
 * An absolute path (Windows — forward or back slashes, macOS/Linux — from the root or ~), optionally followed by
 * ":line", ":line-line" or ":line:column". A path does not start inside a word or a URL.
 */
const fileRefPattern = new RegExp(String.raw`(?<![\w/\\.:~])(${windowsPath}|${posixPath})(?::(\d+)(?:-(\d+)|:\d+)?)?`, 'g');

/**
 * The rest of a file name with spaces, after a path that ends in a word with no extension: a few more words, the last
 * with an extension, then the line — and the name ends there, before a space, punctuation or the text's end.
 */
const nameWord = String.raw`[^\s"'\`<>|*?()[\]{},;:/\\«»“”‘’„]+`;
const spacedName = new RegExp(String.raw`^((?: ${nameWord}){0,5}? ${nameWord}\.[A-Za-z0-9]{1,10})(?::(\d+)(?:-(\d+)|:\d+)?)?(?=$|[\s,;!?)\]»”’"'\`]|\.(?:\s|$))`);

/**
 * @param {string} source
 * @returns {readonly FileRef[]}
 */
export function findFileRefs(source) {
  const pattern = new RegExp(fileRefPattern.source, 'g');
  /** @type {FileRef[]} */
  const refs = [];
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const [text, found, line, endLine] = match;
    if (found === undefined) continue;
    const ref = withSpacedName(source, { index: match.index, text, path: withoutPlace(found), line: lineNumber(line), endLine: lineNumber(endLine) });
    refs.push(ref);
    pattern.lastIndex = ref.index + ref.text.length;
  }
  return refs;
}

/**
 * A path without the place in its document a link names after it — report.html#chain-tv: a # after a file's name and
 * its extension, then words and hyphens to its end. A # inside a name stays: D:/dev/C#/, notes#1.md.
 * @param {string} path
 * @returns {string}
 */
function withoutPlace(path) {
  return /^(.*\.[A-Za-z0-9]+)#[\w-]+$/.exec(path)?.[1] ?? path;
}

/**
 * A path cut at a space where the file's name goes on: "D:/docs/Notes from the team.md" is found as "D:/docs/Notes".
 * @param {string} source
 * @param {FileRef} ref
 * @returns {FileRef}
 */
function withSpacedName(source, ref) {
  if (ref.line !== undefined || endsInFileName(ref.path)) return ref;
  const [tail, name, line, endLine] = spacedName.exec(source.slice(ref.index + ref.text.length)) ?? [];
  if (tail === undefined || name === undefined) return ref;
  return { index: ref.index, text: ref.text + tail, path: ref.path + name, line: lineNumber(line), endLine: lineNumber(endLine) };
}

/**
 * A path from its start to its end, spaces in its names allowed, optionally followed by its line: what inline code
 * holds when it is a path.
 */
const wholePath = new RegExp(String.raw`^((?:[A-Za-z]:[\\/]|~/|/(?:${posixRoots.join('|')})/)[^"<>|*?:\n\`]*[^"<>|*?:\n\`\s.])(?::(\d+)(?:-(\d+)|:\d+)?)?$`);

/**
 * The path inline code is as a whole, spaces in the names of its folders included: `D:/docs/20261016 - hosting/` is one
 * path, which text ends at its first space. None for code that is no path or one found whole in text as it is — nor for
 * code where the name of a file ends before it does: `D:/docs/a.md and b.md` is a file and words.
 * @param {string} code
 * @returns {FileRef | undefined}
 */
export function wholeFileRef(code) {
  const [first] = findFileRefs(code);
  if (first === undefined || first.index !== 0 || first.text === code || first.line !== undefined || endsInFileName(first.path)) return undefined;
  const [text, path, line, endLine] = wholePath.exec(code) ?? [];
  if (text === undefined || path === undefined) return undefined;
  return { index: 0, text, path, line: lineNumber(line), endLine: lineNumber(endLine) };
}

/**
 * @param {string} path
 * @returns {boolean} — whether its last name has an extension
 */
function endsInFileName(path) {
  return /\.[A-Za-z0-9]+$/.test(path.split(/[\\/]/).pop() ?? '');
}

/**
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
function lineNumber(value) {
  return value === undefined ? undefined : Number(value);
}

/**
 * A link `file:///D:/dev/x%20y/z.md` or `file:///Users/ann/z.md`; the line follows the path after ":" or comes in a "#L42" fragment;
 * another fragment — a place in the document — opens the document.
 * @param {string} href
 * @returns {{ path: string, line: number | undefined, endLine: number | undefined } | undefined}
 */
export function fileRefFromHref(href) {
  const match = /^file:\/\/(?:\/([A-Za-z]:\/[^#]*?)|(\/[^#]*?))(?::(\d+)(?:-(\d+))?)?(?:#(?:L(\d+)|[^#]*))?$/i.exec(href);
  const encoded = match?.[1] ?? match?.[2];
  if (match === null || encoded === undefined) return undefined;
  return { path: safeDecode(encoded), line: lineNumber(match[3] ?? match[5]), endLine: lineNumber(match[4]) };
}

/**
 * @param {string} value
 * @returns {string}
 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // broken %-sequence — show the path as is
  }
}

/**
 * The pictures the file panel shows as pictures, by extension. Only raster ones: an SVG from the viewer's own address
 * could run a script in its page, so it is shown as text.
 * A Map, not an object: an extension such as .constructor must not find the object's own properties.
 * @type {ReadonlyMap<string, string>}
 */
const imageTypes = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
]);

/**
 * @param {string} path
 * @returns {string | undefined} — the media type of the picture at path; none when it is not one
 */
export function imageTypeOfPath(path) {
  const extension = /\.(\w+)$/.exec(path)?.[1]?.toLowerCase();
  return extension === undefined ? undefined : imageTypes.get(extension);
}
