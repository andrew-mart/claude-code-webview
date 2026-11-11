// @ts-check
// Where a file, or a folder as a zip, downloads from: the viewer's address for it. In the iPhone's home-screen app iOS
// cannot save a download — the app is left on a screen with no way back but closing it — so there the address opens in
// Safari itself (x-safari-https:, iOS 17 and later), which saves it in its downloads and takes a cut one up again.

/**
 * @param {string} path
 * @param {'file' | 'folder'} kind
 * @param {{ opens: 'this-browser' | 'safari', origin: string }} where — opens: where the download goes; origin: the
 *   page's, which Safari is sent to — over https only, the only kind it is sent to so
 * @returns {string}
 */
export function downloadAddress(path, kind, { opens, origin }) {
  const address = `/api/${kind}/download?${new URLSearchParams({ path })}`;
  return opens === 'safari' && origin.startsWith('https://') ? `x-safari-${origin}${address}` : address;
}
