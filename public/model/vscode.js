// @ts-check
// VS Code in the browser — the viewer's /vscode/ — opened at a session's folder, or at a file's project with the file.

/**
 * The address of VS Code opened at the folder.
 * @param {string} cwd
 * @returns {string}
 */
export function vscodeAddress(cwd) {
  return `/vscode/?${new URLSearchParams({ folder: uriPath(cwd) })}`;
}

/**
 * The address of VS Code opened at a file's project with the file in it, at its line: VS Code opens a file given as a
 * URI under the address its page is reached at — its server's files are there — the line after the path, gone to.
 * @param {{ folder: string, path: string, line: number | undefined, authority: string }} file — folder: the file's
 *   project; authority: the address VS Code's page is reached at
 * @returns {string}
 */
export function vscodeFileAddress({ folder, path, line, authority }) {
  // a name's spaces and marks escaped, the drive's colon left as it is
  const escaped = uriPath(path)
    .split('/')
    .map((name) => encodeURIComponent(name).replaceAll('%3A', ':'))
    .join('/');
  const atLine = line === undefined ? [] : [['gotoLineMode', 'true']];
  const payload = JSON.stringify([['openFile', `vscode-remote://${authority}${escaped}${line === undefined ? '' : `:${line}`}`], ...atLine]);
  return `/vscode/?${new URLSearchParams({ folder: uriPath(folder), payload })}`;
}

/**
 * A path as the path of its file URI, as VS Code takes a folder: on Windows with a slash ahead of the drive
 * (/D:/dev/shop; "D:/dev/shop" alone opens empty), elsewhere as it is.
 * @param {string} path
 * @returns {string}
 */
function uriPath(path) {
  const slashed = path.replaceAll('\\', '/');
  return /^[a-z]:/i.test(slashed) ? `/${slashed}` : slashed;
}
