import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// DOMPurify binds to window on import (through the markdown view), so the DOM is set up before the view loads.
const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text, Element: window.Element, HTMLElement: window.HTMLElement, HTMLAnchorElement: window.HTMLAnchorElement });
const { createChangesView } = await import('../public/view/changes-view.js');

/** @typedef {import('../public/model/branch-changes.js').BranchChanges} BranchChanges */
/** @typedef {import('../public/model/branch-changes.js').ChangedFile} ChangedFile */

const baseSha = 'a'.repeat(40);
/** @type {BranchChanges} */
const changes = {
  ok: true,
  root: 'D:/dev/shop',
  branch: 'feat',
  base: { name: 'main', sha: baseSha, how: 'made-from' },
  commits: [
    { sha: 'b'.repeat(40), subject: 'feat: limits' },
    { sha: 'c'.repeat(40), subject: 'feat: start' },
  ],
  files: [
    { path: 'src/limits.ts', oldPath: undefined, status: 'modified', added: 2, removed: 1 },
    { path: 'logo.png', oldPath: undefined, status: 'deleted', added: undefined, removed: undefined },
  ],
  branches: ['main', 'feat', 'dev'],
};

/**
 * The view over a viewer that answers with these changes; what it was asked is recorded.
 * @param {BranchChanges | undefined} reply
 */
function viewOf(reply) {
  /** @type {(string | undefined)[]} */
  const loads = [];
  /** @type {[string, string][]} */
  const diffs = [];
  /** @type {string[]} */
  const opened = [];
  const view = createChangesView({
    load: async (base) => {
      loads.push(base);
      return reply;
    },
    loadDiff: async (base, file) => {
      diffs.push([base, file.path]);
      return { ok: true, binary: false, rows: [{ kind: 'ctx', oldNo: 1, newNo: 1, text: 'export const limit = 60;' }, { kind: 'add', oldNo: undefined, newNo: 2, text: 'export const burst = 10;' }] };
    },
    openFile: (path) => opened.push(path),
  });
  window.document.body.append(view.element);
  return { view, loads, diffs, opened };
}
const settled = () => new Promise((done) => setTimeout(done, 0));
/** @param {Element} element @param {string} selector */
const textOf = (element, selector) => element.querySelector(selector)?.textContent ?? '';

// The branch's changes: against which base, how many commits and files, each file with its status and lines; a file
// opened shows its diff, asked from the base the changes were counted from
test('changesView_Should_ListBranchFiles_And_ShowDiffOfFileOpened', async () => {
  const { view, diffs } = viewOf(changes);
  await view.reload();

  const [first] = view.element.querySelectorAll('details.change');
  assert.ok(first instanceof window.HTMLDetailsElement);
  first.open = true;
  first.dispatchEvent(new window.Event('toggle'));
  await settled();

  assert.deepEqual(
    {
      facts: textOf(view.element, '.changes-facts'),
      files: [...view.element.querySelectorAll('details.change > summary')].map((row) => [textOf(row, '.change-status'), textOf(row, '.change-path'), textOf(row, '.change-lines')]),
      diff: [...first.querySelectorAll('table.diff tr')].map((row) => row.className),
      diffs,
    },
    {
      facts: '2 commits · 2 files · +2 −1',
      files: [
        ['M', 'src/limits.ts', '+2 −1'],
        ['D', 'logo.png', ''],
      ],
      diff: ['ctx', 'add'],
      diffs: [[baseSha, 'src/limits.ts']],
    },
  );
});

// Another base is chosen from the repository's branches, and the changes are counted again from it; a changed file
// opens in the panel by its path in the repository
test('changesView_Should_CountAgainFromBaseChosen_And_OpenChangedFile', async () => {
  const { view, loads, opened } = viewOf(changes);
  await view.reload();

  const base = view.element.querySelector('select.changes-base');
  assert.ok(base instanceof window.HTMLSelectElement);
  base.value = 'dev';
  base.dispatchEvent(new window.Event('change'));
  await settled();
  const open = view.element.querySelector('details.change .change-open');
  assert.ok(open instanceof window.HTMLButtonElement);
  open.click();

  assert.deepEqual({ loads, choices: [...base.options].map((option) => option.value), opened }, { loads: [undefined, 'dev'], choices: ['main', 'dev'], opened: ['D:/dev/shop/src/limits.ts'] });
});

// A folder out of git, or a viewer that does not answer, is said in words
test('changesView_Should_SayWhyThereAreNoChanges', async () => {
  const outOfGit = viewOf({ ok: false, error: 'not-a-repository' });
  const silent = viewOf(undefined);
  await outOfGit.view.reload();
  await silent.view.reload();

  assert.deepEqual([outOfGit.view.element.textContent, silent.view.element.textContent], ["The session's folder is not in a git repository.", "Could not get the branch's changes from the viewer."]);
});
