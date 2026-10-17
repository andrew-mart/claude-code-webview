import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { createSessionHeader } = await import('../public/view/session-header.js');

test('sessionHeader_Should_ShowGptModelAndItsReportedContextWindow', (t) => {
  const header = createSessionHeader({ place: undefined, currentBranch: async () => undefined, tables: { value: () => 'default', choose: () => undefined }, leading: window.document.createElement('div'), navigation: [], tools: [] });
  t.after(header.dispose);

  header.onMeta({ model: 'gpt-6-sol', contextTokens: 420_000, contextWindow: 1_050_000, effort: 'high' });

  assert.match(header.element.querySelector('.fact-model')?.textContent ?? '', /gpt-6-sol/);
  assert.equal(header.element.querySelector('.fact-context')?.textContent, '420k/1.05M');
  assert.equal(header.element.querySelector('.fact-context')?.getAttribute('data-level'), 'calm');

  header.onMeta({ model: 'gpt-6-sol', contextTokens: 0, contextWindow: 1_050_000 });
  assert.equal(header.element.querySelector('.fact-context')?.getAttribute('title'), 'Context: 0 of 1.05M — 1.05M left');
});
