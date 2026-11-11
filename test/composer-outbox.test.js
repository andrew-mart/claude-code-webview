import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, sessionStorage: window.sessionStorage, HTMLElement: window.HTMLElement, File: window.File, matchMedia: () => ({ matches: false }) });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';
const outboxKey = `viewer.outbox.${sessionId}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/**
 * The box of a session in a herdr pane, Claude idle in it, the viewer reached or not as the test says — lost, when told,
 * while a prompt is being sent, its reply never coming; what the page asked it to send recorded.
 * @param {{ reachable: boolean, sendsUnanswered: number }} viewer
 */
async function boxOf(viewer) {
  /** @type {Record<string, unknown>[]} */
  const sent = [];
  Object.assign(globalThis, {
    fetch: async (/** @type {string} */ path, /** @type {RequestInit | undefined} */ init) => {
      if (!viewer.reachable) throw new TypeError('Failed to fetch');
      if (path === '/api/send') {
        sent.push(JSON.parse(String(init?.body)));
        if (viewer.sendsUnanswered > 0) {
          viewer.sendsUnanswered--;
          viewer.reachable = false;
          throw new TypeError('Failed to fetch');
        }
      }
      const body = path === '/api/send' ? { ok: true, pane: 'w1:p1' } : path.startsWith('/api/live') ? { state: 'live', status: 'idle', pane: 'w1:p1' } : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  localStorage.clear();
  /** @type {string[]} */
  const shownInFeed = [];
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: (text) => void shownInFeed.push(text), onDialog: () => undefined });
  window.document.body.replaceChildren(composer.element);
  await settle();
  const box = composer.element.querySelector('.composer-input');
  assert.ok(box instanceof window.HTMLTextAreaElement);
  /** @param {string} text */
  const send = async (text) => {
    box.value = text;
    box.dispatchEvent(new window.Event('input', { bubbles: true }));
    box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
  };
  const waiting = () => [...composer.element.querySelectorAll('.composer-waiting-row')].map((row) => row.querySelector('.composer-waiting-text')?.textContent);
  const kept = () => {
    const stored = localStorage.getItem(outboxKey);
    return stored === null ? [] : JSON.parse(stored).map((/** @type {{ text: string }} */ one) => one.text);
  };
  /** The viewer reached again: the browser tells the page it is online. */
  const back = async () => {
    viewer.reachable = true;
    window.dispatchEvent(new window.Event('online'));
    await settle();
    await settle();
  };
  const status = composer.element.querySelector('.composer-status');
  assert.ok(status instanceof window.HTMLElement);
  /** How the status line tells the last thing done: busy while the prompt waits, ok once it went. */
  const tone = () => status.dataset.tone;
  return { composer, box, send, waiting, kept, back, sent, shownInFeed, tone };
}

// Out of the viewer's reach the box still takes a prompt: sent, it waits — kept by the browser, the box emptied, the
// prompt shown waiting over it — and goes once the viewer answers again, its row gone, the feed showing it and the
// status line telling it went
test('composer_Should_KeepPromptSentOutOfReach_AndSendItOnceViewerIsBack', async () => {
  const { composer, box, send, waiting, kept, back, sent, shownInFeed, tone } = await boxOf({ reachable: false, sendsUnanswered: 0 });
  const typing = !box.disabled;

  await send('Run the tests');
  const out = { box: box.value, waiting: waiting(), kept: kept(), sent: sent.length, tone: tone() };
  await back();
  composer.dispose();

  assert.deepEqual(
    { typing, out, after: { sent: sent.map((body) => [body.text, typeof body.id]), waiting: waiting(), kept: kept(), shownInFeed, tone: tone() } },
    {
      typing: true,
      out: { box: '', waiting: ['Run the tests'], kept: ['Run the tests'], sent: 0, tone: 'busy' },
      after: { sent: [['Run the tests', 'string']], waiting: [], kept: [], shownInFeed: ['Run the tests'], tone: 'ok' },
    },
  );
});

// A prompt whose reply does not come — the viewer lost while it was being sent — waits the same way, and goes again
// under the id it went with: the viewer types it once, whether the first one reached it or not
test('composer_Should_KeepPromptWithoutReply_AndSendItAgainUnderItsId', async () => {
  const { composer, send, waiting, kept, back, sent } = await boxOf({ reachable: true, sendsUnanswered: 1 });

  await send('Go on');
  const out = { waiting: waiting(), kept: kept() };
  await back();
  composer.dispose();

  assert.deepEqual(
    { out, sameId: sent.length === 2 && sent[0]?.id === sent[1]?.id, left: kept() },
    { out: { waiting: ['Go on'], kept: ['Go on'] }, sameId: true, left: [] },
  );
});
