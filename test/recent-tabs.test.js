import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteOpened, parseRecent, switcherEntries } from '../public/model/recent-tabs.js';

/** @typedef {import('../public/model/herdr.js').Opened} Opened */

/** @param {string} id @returns {Opened} */
const session = (id) => ({ kind: 'session', id });
/** @param {string} id @returns {Opened} */
const pane = (id) => ({ kind: 'pane', id });

// The tabs opened in the page, the latest first: one opened again moves to the front, once; the oldest go past the limit
test('noteOpened_Should_PutWhatIsOpenedFirst_OnceAndUpToLimit', () => {
  const opened = [session('s1'), pane('w1:p2'), session('s1')].reduce((recent, place) => noteOpened(recent, place, 3), /** @type {readonly Opened[]} */ ([]));

  assert.deepEqual(
    { opened, limited: noteOpened([session('s1'), pane('w1:p2'), session('s3')], session('s4'), 3) },
    { opened: [session('s1'), pane('w1:p2')], limited: [session('s4'), session('s1'), pane('w1:p2')] },
  );
});

// What the browser kept: places of another shape are left out
test('parseRecent_Should_ReadPlacesKept_LeavingOutOthers', () => {
  assert.deepEqual(parseRecent([session('s1'), { kind: 'pane', id: 7 }, { kind: 'tab', id: 'x' }, pane('w1:p2'), 'session']), [session('s1'), pane('w1:p2')]);
  assert.deepEqual(parseRecent('[]'), []);
});

// The switcher lists herdr's tabs in the order they were opened in the page — each with its workspace, and the pane the
// session runs in, to be drawn as the session list draws it: a session and its pane's terminal are one tab, its latest
// opening counting; a tab herdr no longer has is left out
test('switcherEntries_Should_ListHerdrTabsInOrderOpened_OnceEach', () => {
  /** @type {import('../public/model/herdr.js').HerdrLayout} */
  const layout = {
    herdr: true,
    workspaces: [
      {
        id: 'w1',
        number: 1,
        label: 'shop-api',
        status: 'idle',
        activeTab: 'w1:t1',
        tabs: [
          { id: 'w1:t1', number: 1, label: 'rate-limit', status: 'working', panes: [{ id: 'w1:p1', agent: 'claude', status: 'working', title: undefined, session: 's1', size: undefined, activity: 3 }] },
          { id: 'w1:t2', number: 2, label: 'tests', status: 'idle', panes: [{ id: 'w1:p2', agent: undefined, status: 'unknown', title: 'pwsh', session: undefined, size: undefined, activity: undefined }] },
        ],
      },
      { id: 'w2', number: 2, label: 'web', status: 'idle', activeTab: 'w2:t1', tabs: [{ id: 'w2:t1', number: 1, label: 'node-24', status: 'done', panes: [{ id: 'w2:p1', agent: 'claude', status: 'done', title: undefined, session: 's2', size: undefined, activity: 5 }] }] },
    ],
  };

  const entries = switcherEntries([pane('w1:p2'), session('s2'), pane('w1:p1'), session('gone'), session('s1')], layout);

  assert.deepEqual(
    entries.map(({ place, workspace, tab, pane }) => [place.id, workspace.label, tab.label, pane.id]),
    [
      ['w1:p2', 'shop-api', 'tests', 'w1:p2'],
      ['s2', 'web', 'node-24', 'w2:p1'],
      ['w1:p1', 'shop-api', 'rate-limit', 'w1:p1'],
    ],
  );
});
