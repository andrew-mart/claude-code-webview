// @ts-check

/**
 * A folder as a key: the case, the kind of slashes and a trailing slash do not matter.
 * @param {string} path
 */
export function folderKey(path) {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}
