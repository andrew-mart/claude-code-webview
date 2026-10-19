// @ts-check
// A button for what is done on the viewer's computer — a window opened there, before its user: shown in a browser that
// may be there, none in one known to be elsewhere — a phone, another computer.

/**
 * @param {HTMLButtonElement} button
 * @param {import('./editor-opener.js').PlaceFinder} places — where the browser is
 * @param {() => void} act — done on the viewer's computer, once the browser is found there
 */
export function onComputer(button, places, act) {
  /** @param {import('../model/machine.js').EditorReach} place */
  const show = (place) => {
    button.hidden = place === 'elsewhere' || place === 'none';
  };
  button.hidden = true;
  void places.known().then(show);
  // where the browser is not known yet, the press finds out first
  button.addEventListener('click', async () => {
    const known = await places.known();
    const place = known === 'unknown' ? await places.find() : known;
    show(place);
    if (place === 'same') act();
  });
}
