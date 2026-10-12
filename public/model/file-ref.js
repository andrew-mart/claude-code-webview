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
 * @param {string} source
 * @returns {readonly FileRef[]}
 */
export function findFileRefs(source) {
  return [...source.matchAll(fileRefPattern)].flatMap((match) => {
    const [text, path, line, endLine] = match;
    if (path === undefined) return [];
    return [{ index: match.index, text, path, line: lineNumber(line), endLine: lineNumber(endLine) }];
  });
}

/**
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
function lineNumber(value) {
  return value === undefined ? undefined : Number(value);
}

/**
 * A link `file:///D:/dev/x%20y/z.md` or `file:///Users/ann/z.md`; the line follows the path after ":" or comes in a "#L42" fragment.
 * @param {string} href
 * @returns {{ path: string, line: number | undefined, endLine: number | undefined } | undefined}
 */
export function fileRefFromHref(href) {
  const match = /^file:\/\/(?:\/([A-Za-z]:\/[^#]*?)|(\/[^#]*?))(?::(\d+)(?:-(\d+))?)?(?:#L(\d+))?$/i.exec(href);
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
