import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement, File: window.File });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';

// A session that is not running has nothing to write to: in the box's place, where it ran and a button that opens it
// there again
test('composer_Should_OfferToOpenSessionAgain_InPlaceOfBox_WhenItIsNotRunning', async () => {
  /** @type {string[]} */
  const asked = [];
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path) => {
      asked.push(path);
      const body = path === '/api/history/reopen' ? { ok: true, target: `#/${sessionId}` } : { state: 'offline' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => ({ workspace: 'trip_plans', tab: 'route planner', runningNow: undefined }), asides: createAsideStore(), onSent: () => undefined });
  window.document.body.append(composer.element);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const box = composer.element.querySelector('.composer-box');
  const card = composer.element.querySelector('.composer-resume');
  assert.ok(box instanceof window.HTMLElement && card instanceof window.HTMLElement);
  const shown = { box: !box.hidden, card: !card.hidden, where: card.querySelector('.composer-resume-where')?.textContent };

  [...card.querySelectorAll('button')].find((button) => !button.hidden)?.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  composer.dispose();

  assert.deepEqual({ shown, reopened: asked.filter((path) => path === '/api/history/reopen') }, {
    shown: { box: false, card: true, where: 'trip_plans · route planner' },
    reopened: ['/api/history/reopen'],
  });
});

// A session whose tab went on with another conversation — /clear, /new, /resume there: in the box's place, the one its
// tab runs now, to go to, and two ways back to this one: in that tab — /resume typed into the conversation it runs —
// or in a new tab, as a closed session opens; Codex's goes back in a new tab only, and so does Claude Code's whose tab
// runs Codex now
test('composer_Should_OfferToResumeHereOrInNewTab_When_ItsTabWentOnWithAnotherConversation', async () => {
  const runningNow = '5b0e8d14-3333-4444-8555-a66677778888';
  /** @type {{ path: string, body: unknown }[]} */
  const posted = [];
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path, /** @type {RequestInit | undefined} */ init) => {
      if (init?.method === 'POST') posted.push({ path, body: JSON.parse(String(init.body)) });
      const body = path === '/api/send' ? { ok: true, pane: 'w2:p1' } : { state: 'offline' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  /**
   * @param {import('../public/model/composer.js').Agent} agent — whose this session is
   * @param {import('../public/model/composer.js').Agent} [runsNow] - whose the one its tab runs now is
   */
  const shownFor = async (agent, runsNow = agent) => {
    const composer = createComposer(sessionId, { agent, focusBox: 'no', placeOf: () => ({ workspace: 'web', tab: 'checkout', runningNow: { id: runningNow, title: 'Coupon codes', agent: runsNow } }), asides: createAsideStore(), onSent: () => undefined });
    window.document.body.replaceChildren(composer.element);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const card = composer.element.querySelector('.composer-resume');
    const shown = {
      where: card?.querySelector('.composer-resume-where')?.textContent,
      goTo: card?.querySelector('.composer-resume-where a')?.getAttribute('href'),
      buttons: [...(card?.querySelectorAll('button') ?? [])].filter((button) => !button.hidden).map((button) => button.textContent),
    };
    [...(card?.querySelectorAll('button') ?? [])].find((button) => !button.hidden && button.textContent === 'Resume here')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    composer.dispose();
    return shown;
  };

  const claude = await shownFor('claude');
  const codex = await shownFor('codex');
  const codexNow = await shownFor('claude', 'codex');

  assert.deepEqual({ claude, codex, codexNow: codexNow.buttons, posted }, {
    claude: { where: 'Its tab went on with Coupon codes', goTo: `#/${runningNow}`, buttons: ['Resume here', 'New tab'] },
    codex: { where: 'Its tab went on with Coupon codes', goTo: `#/${runningNow}`, buttons: ['New tab'] },
    codexNow: ['New tab'],
    posted: [{ path: '/api/send', body: { session: runningNow, text: `/resume ${sessionId}` } }],
  });
});
