// @ts-check
// Work that can wait for the page to show what was just changed: a tap answered at once — the list on a phone sliding
// away — and the heavier work after it, a session put together, rather than the page standing still until all of it is
// done. A frame's own callback would hold that frame back: the work goes in the turn after it.

/**
 * The task once the page has drawn its next frame; at once while the page is hidden, where it draws none.
 * @param {{ document: { visibilityState: DocumentVisibilityState }, requestAnimationFrame: (callback: FrameRequestCallback) => number, setTimeout: (handler: () => void) => number }} page
 * @param {() => void} task
 */
export function afterDrawing(page, task) {
  if (page.document.visibilityState === 'hidden') task();
  else page.requestAnimationFrame(() => page.setTimeout(task));
}
