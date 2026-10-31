// @ts-check
// Folders to open a new herdr workspace in, offered as its folder is typed: those typed before, the latest first, then
// those sessions ran in.

/**
 * @typedef {'\\' | '/'} PathSeparator — how the viewer's computer parts a path: backslashes on Windows
 * @typedef {{ lists: readonly string[], part: string, how: 'starts' | 'holds' }} FolderSearch — lists: the folders to
 *   look in, each with its separator at the end; part: what a folder's name is to start with, or hold
 */

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
 * The folders offered for what is typed: those worked in that hold it — however its slashes lean, in any case — then
 * those found on the disk not among them that hold it too, those found for what was typed before still there among
 * them; none once what is typed is one of them — unless a slash after it goes into it: then all but it.
 * @param {readonly string[]} known — the folders worked in, the latest first
 * @param {readonly string[]} found — the folders found on the disk for what is typed
 * @param {string} typed
 * @param {number} limit — how many at most
 * @returns {string[]}
 */
export function folderOffers(known, found, typed, limit) {
  const wanted = folderKey(typed);
  const holds = (/** @type {string} */ folder) => folderKey(folder).toLowerCase().includes(wanted.toLowerCase());
  const offers = once([...known, ...found].filter(holds));
  const typedOne = (/** @type {string} */ folder) => folderKey(folder) === wanted;
  // a slash after the folder goes into it
  if (/[\\/]\s*$/.test(typed)) return offers.filter((folder) => !typedOne(folder)).slice(0, limit);
  return offers.some(typedOne) ? [] : offers.slice(0, limit);
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

/**
 * A folder as the viewer's computer writes paths: its slashes all one way, one for many, none at the end but a drive's
 * or the root's own.
 * @param {string} folder — as typed or met: either slashes
 * @param {PathSeparator} separator — the computer's
 * @returns {string}
 */
export function systemFolder(folder, separator) {
  const written = folder.trim().replace(/[\\/]+/g, separator);
  return /^([a-z]:)?[\\/]$/i.test(written) ? written : written.replace(/[\\/]+$/, '');
}

/**
 * Where on the disk to look for folders for what is typed: a path — the folder before its last slash, for names that
 * start with what follows it; a word — the folders the ones worked in are in, for names that hold it; nothing typed —
 * nowhere.
 * @param {string} typed — either slashes
 * @param {PathSeparator} separator — the computer's
 * @param {readonly string[]} known — the folders worked in, the latest first
 * @returns {FolderSearch}
 */
export function folderSearch(typed, separator, known) {
  const written = typed.trim().replace(/[\\/]+/g, separator);
  const cut = written.lastIndexOf(separator);
  if (cut >= 0) return { lists: [written.slice(0, cut + 1)], part: written.slice(cut + 1), how: 'starts' };
  if (written === '') return { lists: [], part: '', how: 'holds' };
  const parents = known.map((folder) => systemFolder(folder, separator)).flatMap((folder) => {
    const at = folder.lastIndexOf(separator);
    return at < 0 ? [] : [folder.slice(0, at + 1)];
  });
  return { lists: once(parents), part: written, how: 'holds' };
}

/**
 * The folders found where the search looked, in the order it looked there, each folder's as listed: a hidden one — its
 * name a dot first — only when what is looked for starts with a dot.
 * @param {FolderSearch} search
 * @param {ReadonlyMap<string, readonly string[]>} listed — the folders' names in each folder looked in
 * @returns {string[]}
 */
export function foundFolders(search, listed) {
  const part = search.part.toLowerCase();
  const fits = (/** @type {string} */ name) => {
    if (name.startsWith('.') && !part.startsWith('.')) return false;
    return search.how === 'starts' ? name.toLowerCase().startsWith(part) : name.toLowerCase().includes(part);
  };
  return search.lists.flatMap((folder) => (listed.get(folder) ?? []).filter(fits).map((name) => `${folder}${name}`));
}
