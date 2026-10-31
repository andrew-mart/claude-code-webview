import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// A page opened through a tunnel, at an address of its own, in a browser with a mouse
const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://viewer.example.com/' });
Object.assign(globalThis, { window, location: window.location, localStorage: window.localStorage });
window.matchMedia = () => /** @type {MediaQueryList} */ (/** @type {unknown} */ ({ matches: false }));
globalThis.matchMedia = window.matchMedia;
const { createEditorOpener, createPlaceFinder } = await import('../public/view/editor-opener.js');

const viewer = { instance: '6f1c2a3b-0000-4000-8000-000000000001', port: 7788, editor: true, vscode: false, separator: /** @type {const} */ ('/') };

/**
 * The browser: the viewer at its 127.0.0.1 answers once the page is let reach this computer's apps; the permission is
 * known to it by the given name, other names unknown.
 * @param {{ name: string, state: () => PermissionState }} permission
 * @param {() => boolean} lets — whether the page is let reach the apps now
 * @param {{ route?: 'direct' | 'proxy' }} [options] - proxy: the browser sends 127.0.0.1 through a proxy too, so it does
 *   not know which address space the request goes to, and refuses one that names it
 */
function browser(permission, lets, { route = 'direct' } = {}) {
  window.localStorage.clear();
  globalThis.fetch = async (/** @type {string | URL | Request} */ address, /** @type {RequestInit | undefined} */ init) => {
    if (route === 'proxy' && init !== undefined && 'targetAddressSpace' in init) throw new TypeError('Failed to fetch');
    if (String(address) !== `http://127.0.0.1:${viewer.port}/api/machine` || !lets()) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(viewer));
  };
  const query = async (/** @type {{ name: string }} */ asked) => {
    if (asked.name !== permission.name) throw new TypeError(`'${asked.name}' is not a valid permission name`);
    return { state: permission.state() };
  };
  Object.defineProperty(globalThis, 'navigator', { value: { permissions: { query } }, configurable: true });
}

// A browser that refused the page this computer's apps is not taken for one elsewhere: the button stays, and once the
// browser lets the page in, the next press finds the viewer — the refusal is not kept for the next time
test('editorOpener_Should_AskAgain_When_BrowserRefusedThisComputersApps', async () => {
  let allowed = false;
  browser({ name: 'loopback-network', state: () => (allowed ? 'granted' : 'denied') }, () => allowed);
  const opener = createEditorOpener(Promise.resolve(viewer));

  const refused = await opener.check();
  const kept = await opener.reach();
  allowed = true;
  const let_ = await opener.check();

  assert.deepEqual([refused, kept, let_], ['blocked', 'unknown', 'same']);
});

// A Chrome from before the permission was split knows it by its older name; one where the page may reach the apps and
// nothing answers is elsewhere, and is kept so
test('editorOpener_Should_TellRefusalByOlderName_And_KeepWhatIsElsewhere', async () => {
  browser({ name: 'local-network-access', state: () => 'denied' }, () => false);
  const older = await createEditorOpener(Promise.resolve(viewer)).check();
  browser({ name: 'loopback-network', state: () => 'granted' }, () => false);
  const opener = createEditorOpener(Promise.resolve(viewer));
  const elsewhere = await opener.check();

  assert.deepEqual([older, elsewhere, await createEditorOpener(Promise.resolve(viewer)).reach()], ['blocked', 'elsewhere', 'elsewhere']);
});

// Where the browser is is found for a viewer with no editor too — VS Code opens on its computer — while the editor's
// button has nothing to open there
test('placeFinder_Should_FindBrowserOnViewersComputer_ForViewerWithNoEditor', async () => {
  browser({ name: 'loopback-network', state: () => 'granted' }, () => true);
  const noEditor = Promise.resolve({ ...viewer, editor: false });
  const places = createPlaceFinder(noEditor);
  const editor = createEditorOpener(noEditor, places);

  const before = await places.known();
  const found = await places.find();

  assert.deepEqual([before, found, await places.known(), await editor.reach(), await editor.check()], ['unknown', 'same', 'same', 'none', 'none']);
});

// A system proxy that takes 127.0.0.1 too leaves the browser not knowing where the request goes: it asks no one, and
// lets through the request that names no address space — the viewer found on this computer
test('editorOpener_Should_FindViewerHere_When_BrowserSendsThisComputersAddressThroughProxy', async () => {
  browser({ name: 'loopback-network', state: () => 'prompt' }, () => true, { route: 'proxy' });

  assert.equal(await createEditorOpener(Promise.resolve(viewer)).check(), 'same');
});
