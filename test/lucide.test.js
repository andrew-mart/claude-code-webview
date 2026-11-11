import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { lucideIcon, putAllLucideIcons } = await import('../public/view/lucide.js');

/** @param {string} body */
const iconFile = (body) => `<!-- @license lucide-static - ISC -->\n<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">\n  ${body}\n</svg>\n`;
const files = /** @type {const} */ ({
  'icons/folder.svg': iconFile('<path d="M20 20H4V4h6l2 3h8z" />'),
  'icons/star.svg': iconFile('<polygon points="12 2 15 9 22 9 16 14 18 21 12 17 6 21 8 14 2 9 9 9" />'),
  'sprite.svg':
    '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<symbol id="folder" viewBox="0 0 24 24"><path d="M20 20H4V4h6l2 3h8z" /></symbol>' +
    '<symbol id="moon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></symbol>' +
    '<symbol id="star" viewBox="0 0 24 24"><polygon points="12 2 15 9 22 9 16 14 18 21 12 17 6 21 8 14 2 9 9 9" /></symbol>' +
    '</defs></svg>',
});

/**
 * Lucide's files as the viewer serves them, under vendor/lucide/: what the page asked for is told back.
 * @param {import('node:test').TestContext} t
 */
function serveLucide(t) {
  document.body.replaceChildren();
  /** @type {string[]} */
  const asked = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (/** @type {string | URL | Request} */ address) => {
    const path = String(address).replace(/^.*\/vendor\/lucide\//, '');
    asked.push(path);
    const body = Object.entries(files).find(([name]) => name === path)?.[1];
    return body === undefined ? new Response('Not found', { status: 404 }) : new Response(body);
  };
  t.after(() => {
    globalThis.fetch = before;
  });
  return asked;
}

/** Lets the files asked for come. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

/** The symbols the page holds, each with what it draws. */
const symbols = () => [...document.querySelectorAll('svg.lucide-sprite symbol')].map((symbol) => `${symbol.id}: ${symbol.innerHTML.trim()}`);

// The page holds the drawings of the icons it draws, not Lucide's whole set — some two thousand of them, nine thousand
// elements, most never drawn: each is asked for on its own, once, however many times it is drawn
test('lucideIcon_Should_PutOnlyTheIconsDrawnIntoThePage_EachAskedForOnce', async (t) => {
  const asked = serveLucide(t);

  const drawn = [lucideIcon('folder', undefined), lucideIcon('folder', 'blue'), lucideIcon('star', undefined)];
  await settled();

  assert.deepEqual(
    { asked, symbols: symbols(), uses: drawn.map((svg) => svg.querySelector('use')?.getAttribute('href')) },
    {
      asked: ['icons/folder.svg', 'icons/star.svg'],
      symbols: ['lucide-folder: <path d="M20 20H4V4h6l2 3h8z"></path>', 'lucide-star: <polygon points="12 2 15 9 22 9 16 14 18 21 12 17 6 21 8 14 2 9 9 9"></polygon>'],
      uses: ['#lucide-folder', '#lucide-folder', '#lucide-star'],
    },
  );
});

// The icon picker shows them all: the whole set comes in one file, the symbols not in the page yet put in — those drawn
// before stay as they are, none twice — and an icon drawn after asks for nothing more
test('putAllLucideIcons_Should_PutTheWholeSetFromOneFile_KeepingThoseDrawn_AndAskingNothingAfter', async (t) => {
  const asked = serveLucide(t);

  lucideIcon('folder', undefined);
  await settled();
  await putAllLucideIcons();
  lucideIcon('moon', undefined);
  await settled();

  assert.deepEqual(
    { asked, symbols: symbols() },
    {
      asked: ['icons/folder.svg', 'sprite.svg'],
      symbols: [
        'lucide-folder: <path d="M20 20H4V4h6l2 3h8z"></path>',
        'lucide-moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>',
        'lucide-star: <polygon points="12 2 15 9 22 9 16 14 18 21 12 17 6 21 8 14 2 9 9 9"></polygon>',
      ],
    },
  );
});
