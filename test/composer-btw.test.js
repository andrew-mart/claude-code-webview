import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
// a box opened with a draft in it is fitted to it on the next frame
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, sessionStorage: window.sessionStorage, HTMLElement: window.HTMLElement, File: window.File, requestAnimationFrame: (/** @type {() => void} */ callback) => setTimeout(callback, 0) });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

// A side question's answer belongs to its session, not to the box on the screen: switching to another session and back
// — even while Claude is still answering — shows it again, until it is closed
test('composer_Should_KeepSideAnswer_AcrossSwitchingSessions', async () => {
  /** @type {(value: Response) => void} */
  let answer = () => undefined;
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path) => {
      if (path === '/api/btw') return new Promise((resolve) => (answer = resolve));
      return new Response(JSON.stringify({ state: 'live', status: 'idle', pane: 'w1:p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const asides = createAsideStore();
  const open = async () => {
    const composer = createComposer(sessionId, { focusBox: 'no', placeOf: () => undefined, asides });
    window.document.body.append(composer.element);
    await settle();
    return composer;
  };
  /** @param {Awaited<ReturnType<typeof open>>} composer */
  const shown = (composer) => {
    const aside = composer.element.querySelector('.side-answer');
    return aside instanceof window.HTMLElement && !aside.hidden ? aside.querySelector('.side-answer-text')?.textContent : undefined;
  };

  const first = await open();
  const box = first.element.querySelector('.composer-input');
  const form = first.element.querySelector('.composer-box');
  assert.ok(box instanceof window.HTMLTextAreaElement && form instanceof window.HTMLElement);
  box.value = '/btw where is the config?';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await settle();
  first.dispose();
  first.element.remove();
  const whileAnswering = await open();
  const answering = shown(whileAnswering);
  answer(new Response(JSON.stringify({ ok: true, answer: 'In src/config.ts.' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await settle();
  const answered = shown(whileAnswering);
  whileAnswering.dispose();
  whileAnswering.element.remove();
  const later = await open();
  const again = shown(later);
  later.element.querySelector('.side-answer-close')?.dispatchEvent(new window.Event('click'));
  later.dispose();
  later.element.remove();
  const afterClosing = await open();
  const closed = shown(afterClosing);
  afterClosing.dispose();

  assert.deepEqual({ answering, answered, again, closed }, { answering: 'Answering…', answered: 'In src/config.ts.', again: 'In src/config.ts.', closed: undefined });
});

// An answer outlives a reload of the page's tab; a question still being answered does not — its request went with the
// page — and a closed one is gone
test('asideStore_Should_KeepAnswersAcrossReload_ButNotQuestionsBeingAnswered', () => {
  const before = createAsideStore();
  before.set('s1', { question: 'Where is the config?', answer: 'In src/config.ts.' });
  before.set('s2', { question: 'And the tests?', answer: undefined });
  before.set('s3', { question: 'Closed?', answer: 'Yes.' });
  before.set('s3', undefined);

  const after = createAsideStore();

  assert.deepEqual(['s1', 's2', 's3'].map((id) => after.get(id)), [{ question: 'Where is the config?', answer: 'In src/config.ts.' }, undefined, undefined]);
});
