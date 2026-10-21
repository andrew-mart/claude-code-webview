import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { createSessionHeader } = await import('../public/view/session-header.js');

/**
 * A session's header, with no folder or branch known yet and nothing around it.
 * @param {string} sessionId
 */
const headerOf = (sessionId) => createSessionHeader({ sessionId, place: undefined, currentBranch: async () => undefined, tables: { value: () => 'default', choose: () => undefined }, leading: window.document.createElement('div'), navigation: [], tools: [] });

test('sessionHeader_Should_ShowGptModelAndItsReportedContextWindow', (t) => {
  const header = headerOf('0d3f9a2c-1b7e-4c55-9e0a-6f2d8b41c7e3');
  t.after(header.dispose);

  header.onMeta({ model: 'gpt-6-sol', contextTokens: 420_000, contextWindow: 1_050_000, effort: 'high' });

  assert.match(header.element.querySelector('.fact-model')?.textContent ?? '', /gpt-6-sol/);
  assert.equal(header.element.querySelector('.fact-context')?.textContent, '420k/1.05M');
  assert.equal(header.element.querySelector('.fact-context')?.getAttribute('data-level'), 'calm');

  header.onMeta({ model: 'gpt-6-sol', contextTokens: 0, contextWindow: 1_050_000 });
  assert.equal(header.element.querySelector('.fact-context')?.getAttribute('title'), 'Context: 0 of 1.05M — 1.05M left');
});

// The session's id is in view at a glance — its first eight characters, as a commit's short hash — and in full in the
// details
test('sessionHeader_Should_ShowSessionId_ShortAmongFacts_InFullInDetails', (t) => {
  const header = headerOf('675eea90-5475-430f-ad4a-86e0de5c27cb');
  t.after(header.dispose);

  assert.equal(header.element.querySelector('.head-facts .fact-session')?.textContent, '675eea90');
  assert.match(header.element.querySelector('.head-details')?.textContent ?? '', /675eea90-5475-430f-ad4a-86e0de5c27cb/);
});

// The id is copied in full from the details — for `claude --resume`, or to name the session elsewhere
test('sessionHeader_Should_CopyWholeSessionId_FromDetails', async (t) => {
  /** @type {string[]} */
  const copied = [];
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (/** @type {string} */ text) => void copied.push(text) }, configurable: true });
  t.after(() => Reflect.deleteProperty(globalThis.navigator, 'clipboard'));
  const header = headerOf('675eea90-5475-430f-ad4a-86e0de5c27cb');
  t.after(header.dispose);

  const copy = header.element.querySelector('.head-details button[aria-label="Copy the session id"]');
  assert.ok(copy instanceof window.HTMLButtonElement);
  copy.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(copied, ['675eea90-5475-430f-ad4a-86e0de5c27cb']);
});
