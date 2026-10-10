// @ts-check
// Images attached to a prompt from the page. The server saves them as files and lists their paths at the end of the
// prompt — Claude Code opens them with its Read tool; the feed shows that list as pictures again.

const heading = 'Attached images:';
/** A file the viewer saved: …/.claude-code-webview/uploads/<name>; the name is the server's own, never a user's. */
const uploadedFile = /[\\/]\.claude-code-webview[\\/]uploads[\\/]([\w-]+\.(?:png|jpe?g|gif|webp))$/i;

/**
 * @param {string} text — what the user typed
 * @param {readonly string[]} paths — absolute paths of the saved images
 * @returns {string} — the prompt that goes to the terminal
 */
export function withAttachedImages(text, paths) {
  const body = text.trimEnd();
  if (paths.length === 0) return body;
  const block = [heading, ...paths].join('\n');
  return body === '' ? block : `${body}\n\n${block}`;
}

/**
 * The prompt text without the list of attached images, and the list. Only a list at the very end, with nothing
 * but absolute paths in it, counts: the same words in the middle of a prompt are just words.
 * @param {string} text
 * @returns {{ text: string, paths: string[] }}
 */
export function splitAttachedImages(text) {
  const lines = text.split('\n');
  const at = lines.lastIndexOf(heading);
  const paths = at < 0 ? [] : lines.slice(at + 1);
  if (paths.length === 0 || !paths.every((line) => /^(?:[A-Za-z]:[\\/]|\/)/.test(line))) return { text, paths: [] };
  return { text: lines.slice(0, at).join('\n').trimEnd(), paths };
}

/**
 * Where the page loads an attached image from; undefined for a file the viewer did not save itself.
 * @param {string} path
 * @returns {string | undefined}
 */
export function uploadUrl(path) {
  const name = uploadedFile.exec(path)?.[1];
  return name === undefined ? undefined : `/api/upload/${name}`;
}
