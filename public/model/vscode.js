// @ts-check
// VS Code in the browser — the viewer's /vscode/ — opened at a session's folder.

/**
 * The address of VS Code opened at the folder: VS Code takes a folder as a path of its file URI — on Windows with a
 * slash ahead of the drive (/D:/dev/shop; "D:/dev/shop" alone opens empty), elsewhere as it is.
 * @param {string} cwd
 * @returns {string}
 */
export function vscodeAddress(cwd) {
  const path = cwd.replaceAll('\\', '/');
  const folder = /^[a-z]:/i.test(path) ? `/${path}` : path;
  return `/vscode/?${new URLSearchParams({ folder })}`;
}
