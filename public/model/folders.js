// @ts-check
// Folders to open a new herdr workspace in, offered as its folder is typed: those typed before, the latest first, then
// those sessions ran in.

/** How many typed folders are kept. */
const keptFolders = 20;

/**
 * A folder as it is compared: forward slashes, no slash at the end, a Windows path in one case.
 * @param {string} folder
 */
function folderKey(folder) {
  const path = folder.trim().replaceAll('\\', '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(path) ? path.toLowerCase() : path;
}

/**
 * Each folder once — as it was first met — in the order met.
 * @param {readonly string[]} folders
 * @returns {string[]}
 */
function once(folders) {
  /** @type {Set<string>} */
  const seen = new Set();
  return folders.filter((folder) => {
    const key = folderKey(folder);
    if (key === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {readonly string[]} remembered — folders typed before, the latest first
 * @param {import('./history.js').History} history — where sessions ran
 * @returns {string[]}
 */
export function folderChoices(remembered, history) {
  // a session open now ran latest of all: the viewer does not say when it saw it last — it sees it now
  const ran = Object.values(history)
    .flatMap((place) => (place.folder === undefined ? [] : [{ folder: place.folder, at: place.open ? Infinity : (place.lastSeen ?? 0) }]))
    .sort((a, b) => b.at - a.at)
    .map(({ folder }) => folder);
  return once([...remembered, ...ran]);
}

/**
 * The name a new workspace in this folder is given when none is: the folder's own — the last part of its path.
 * @param {string} folder — as typed: either slashes, a slash at the end or not
 * @returns {string} — empty for no folder
 */
export function workspaceNameOf(folder) {
  return folder.split(/[\\/]/).map((part) => part.trim()).filter((part) => part !== '').at(-1) ?? '';
}

/**
 * The typed folders with this one put first; nothing typed changes nothing.
 * @param {readonly string[]} remembered
 * @param {string} folder
 * @returns {string[]}
 */
export function rememberFolder(remembered, folder) {
  if (folder.trim() === '') return [...remembered];
  return once([folder.trim(), ...remembered]).slice(0, keptFolders);
}
