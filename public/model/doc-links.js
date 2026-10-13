// @ts-check
// A document's links read from where it lies, and the settings block at its head.

/**
 * @typedef {{ kind: 'file', path: string, line: number | undefined } | { kind: 'anchor', id: string } | { kind: 'web' }} DocLink
 *   — file: a path next to the document or above it, with the line a #L42 names; anchor: a place in the document
 *   itself; web: an address with a scheme
 */

/** A scheme — http:, mailto:, data: — but not a drive letter. */
const scheme = /^[a-z][a-z0-9+.-]+:/i;
const drive = /^[a-z]:[\\/]/i;

/**
 * @param {string} filePath — the document's absolute path
 * @param {string} href — a link or a picture's address in it
 * @returns {DocLink}
 */
export function docLinkTarget(filePath, href) {
  if (href.startsWith('#')) return { kind: 'anchor', id: decoded(href.slice(1)) };
  if (scheme.test(href) && !drive.test(href)) return { kind: 'web' };
  const [address = '', hash = ''] = href.split('#');
  const relative = decoded(address.split('?')[0] ?? '').replaceAll('\\', '/');
  const folder = filePath.replaceAll('\\', '/').replace(/\/[^/]*$/, '');
  const root = drive.test(filePath) ? filePath.slice(0, 2) : '';
  const joined = drive.test(relative) ? relative : relative.startsWith('/') ? `${root}${relative}` : `${folder}/${relative}`;
  const line = /^L(\d+)/.exec(hash)?.[1];
  return { kind: 'file', path: normalized(joined), line: line === undefined ? undefined : Number(line) };
}

/**
 * Escapes such as %20 read; a % that escapes nothing taken as it is.
 * @param {string} text
 */
function decoded(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * A path with its . and .. steps taken.
 * @param {string} path — with forward slashes
 */
function normalized(path) {
  /** @type {string[]} */
  const steps = [];
  for (const step of path.split('/')) {
    if (step === '.') continue;
    if (step === '..' && steps.length > 1) steps.pop();
    else steps.push(step);
  }
  return steps.join('/');
}

/**
 * The settings block (YAML between --- lines) at the very head of a markdown document, and the text after it.
 * @param {string} text
 * @returns {{ frontMatter: string | undefined, body: string }}
 */
export function splitFrontMatter(text) {
  const found = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n/.exec(text);
  if (found === null) return { frontMatter: undefined, body: text };
  return { frontMatter: found[1], body: text.slice(found[0].length) };
}
