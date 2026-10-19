// @ts-check
// VS Code opened at a session's folder, or at a file's project with the file at its line: from a browser on the
// viewer's computer the computer's own VS Code — its settings, extensions and keys — anywhere else VS Code in the browser,
// in a tab of its own.

/**
 * @typedef {{ folder: string } | { path: string, line: number | undefined }} VsCodeTarget
 */

/**
 * @param {{ places: import('./editor-opener.js').PlaceFinder, desktop: (target: VsCodeTarget) => Promise<boolean>, web: (target: VsCodeTarget) => void }} parts —
 *   places: where the browser is; desktop: the computer's own VS Code opened, whether it started; web: VS Code in the
 *   browser opened — straight from a press, as a browser lets a page open a tab only then
 */
export function createVsCodeOpener({ places, desktop, web }) {
  /** Where the browser is, as last known: a press opens what is for there at once. */
  /** @type {import('../model/machine.js').EditorReach} */
  let known = 'unknown';
  void places.known().then((place) => {
    known = place;
  });
  /** @param {VsCodeTarget} target */
  const onComputer = (target) => {
    void desktop(target).then((started) => {
      if (!started) web(target);
    });
  };
  return {
    /** @param {VsCodeTarget} target */
    open(target) {
      if (known === 'same') return onComputer(target);
      if (known !== 'unknown') return web(target);
      void places.find().then((place) => {
        known = place;
        if (place === 'same') onComputer(target);
        else web(target);
      });
    },
  };
}
