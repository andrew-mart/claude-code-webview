// @ts-check
// The address a document drawn in the file panel comes by: server/app.js, /api/folder/.

/**
 * The address a document drawn in the panel comes by (server/app.js, /api/folder/): its folder's absolute path in
 * base64url, then its name — so its relative addresses resolve inside the folder.
 * @param {string} path — the document's absolute path
 * @param {'on' | 'off'} scripts — whether a page runs its scripts
 * @returns {string}
 */
export function folderAddress(path, scripts) {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const bytes = new TextEncoder().encode(path.slice(0, cut));
  const folder = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `/api/folder/${folder}/${encodeURIComponent(path.slice(cut + 1))}${scripts === 'on' ? '?scripts=1' : ''}`;
}
