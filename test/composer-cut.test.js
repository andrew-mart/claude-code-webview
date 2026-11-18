import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement, File: window.File, Blob: window.Blob, FileReader: window.FileReader });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '8b2d4f60-6666-4777-8888-999900001111';
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));
/** Waits until it holds, two seconds at most. @param {() => boolean} holds */
const until = async (holds) => {
  for (let waited = 0; waited < 2000 && !holds(); waited += 20) await settled();
};

// The viewer stopped Claude on a prompt Claude Code got cut short and holds it whole: the box it shows says how much was
// lost and takes the whole prompt back, before what is typed there — once, however often it asks — and tells the
// viewer it took it, so no other page puts it back again
test('composer_Should_PutThePromptClaudeGotCutShortBackWhole_Once', async (t) => {
  const sent = '1. Check the totals of last month.\n2. Round the taxes to cents.\n3. Send the report to the team.';
  /** @type {unknown[]} */
  const taken = [];
  let held = true;
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (/** @type {() => void} */ callback) => setTimeout(callback, 0),
    fetch: async (/** @type {string} */ url, /** @type {{ body?: string } | undefined} */ init) => {
      if (url === '/api/cut-taken') {
        taken.push(JSON.parse(init?.body ?? '{}'));
        held = false;
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const live = { state: 'live', status: 'idle', pane: 'w1:p1', queued: [], ...(held ? { cut: { text: sent, lost: 28, after: 'month. 2. Round the' } } : {}) };
      return new Response(JSON.stringify(live), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  localStorage.setItem(`viewer.draft.${sessionId}`, 'And archive it');
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined, onDialog: () => undefined });
  t.after(() => composer.dispose());
  window.document.body.append(composer.element);
  const box = composer.element.querySelector('.composer-input');
  const status = composer.element.querySelector('.composer-status');
  assert.ok(box instanceof window.HTMLTextAreaElement && status instanceof window.HTMLElement);
  await until(() => taken.length > 0);
  composer.pokeLive();
  await settled();
  composer.pokeLive();
  await settled();

  assert.deepEqual(
    { box: box.value, said: status.textContent, taken },
    {
      box: `${sent}\n\nAnd archive it`,
      said: 'Claude Code got the message without 28 characters after “month. 2. Round the”. The whole message is back in the box.',
      taken: [{ session: sessionId }],
    },
  );
});

// Once the box has the prompt back, it can send it through a file — the viewer puts it in a file and types the agent
// only a line to read it there: what the box holds goes so, and, sent, the box does not offer it again
test('composer_Should_SendThePromptThroughAFile_When_AskedAfterItCameCutShort', async (t) => {
  const sent = '1. Check the totals of last month.\n2. Round the taxes to cents.\n3. Send the report to the team.';
  /** @type {{ text?: unknown, throughFile?: unknown }[]} */
  const sends = [];
  let held = true;
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (/** @type {() => void} */ callback) => setTimeout(callback, 0),
    fetch: async (/** @type {string} */ url, /** @type {{ body?: string } | undefined} */ init) => {
      if (url === '/api/cut-taken') {
        held = false;
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === '/api/send') {
        sends.push(JSON.parse(init?.body ?? '{}'));
        return new Response('{"ok":true,"pane":"w1:p1"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const live = { state: 'live', status: 'idle', pane: 'w1:p1', queued: [], ...(held ? { cut: { text: sent, lost: 28, after: 'month. 2. Round the' } } : {}) };
      return new Response(JSON.stringify(live), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  localStorage.removeItem(`viewer.draft.${sessionId}`);
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined, onDialog: () => undefined });
  t.after(() => composer.dispose());
  window.document.body.append(composer.element);
  const throughFile = composer.element.querySelector('.composer-through-file');
  assert.ok(throughFile instanceof window.HTMLButtonElement, 'the box has no button to send through a file');
  const offeredBefore = !throughFile.hidden;
  await until(() => !held);
  const offeredOnceBack = !throughFile.hidden;
  throughFile.click();
  await until(() => sends.length > 0);
  await settled();

  assert.deepEqual(
    { offeredBefore, offeredOnceBack, sends: sends.map((one) => ({ text: one.text, throughFile: one.throughFile })), offeredOnceSent: !throughFile.hidden },
    { offeredBefore: false, offeredOnceBack: true, sends: [{ text: sent, throughFile: true }], offeredOnceSent: false },
  );
});
