import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openedAt, parseHerdrLayout, parseTabChange, placeOf, searchLayout, sessionsByActivity, tabTarget } from '../public/model/herdr.js';

const session = '7d4e1b20-2222-4333-8444-955566667777';

/** @type {import('../public/model/herdr.js').HerdrWorkspace} */
const tripPlans = {
  id: 'w2',
  number: 1,
  label: 'trip_plans',
  status: 'working',
  activeTab: 'w2:t3',
  tabs: [
    { id: 'w2:t1', number: 1, label: 'hotels', status: 'done', panes: [{ id: 'w2:p1', agent: 'claude', status: 'done', title: 'Packing list draft', session, size: undefined, activity: 40 }] },
    { id: 'w2:t2', number: 2, label: 'visas', status: 'unknown', panes: [{ id: 'w2:p2', agent: undefined, status: 'unknown', title: 'powershell', session: undefined, size: { cols: 120, rows: 40 }, activity: undefined }] },
    { id: 'w2:t3', number: 3, label: 'search', status: 'working', panes: [{ id: 'w2:p3', agent: 'claude', status: 'working', title: 'Hostels across the EU', session: undefined, size: undefined, activity: 90 }] },
  ],
};
/** @type {import('../public/model/herdr.js').HerdrWorkspace} */
const notebook = {
  id: 'w3',
  number: 2,
  label: 'notebook',
  status: 'idle',
  activeTab: 'w3:t1',
  tabs: [{ id: 'w3:t1', number: 1, label: '1', status: 'idle', panes: [{ id: 'w3:p1', agent: 'codex', status: 'idle', title: 'Checklist', session: undefined, size: undefined, activity: 60 }] }],
};
const layout = { herdr: true, workspaces: [tripPlans, notebook] };

// A tab with Claude Code opens the session's feed; any other one — a shell, nvim, another agent, or Claude whose session
// is not known — opens the pane's terminal
test('tabTarget_Should_OpenSessionOfClaudeTab_AndTerminalOfAnyOther', () => {
  const [resume, apply, search] = tripPlans.tabs;
  const [checklist] = notebook.tabs;

  assert.deepEqual([resume, apply, search, checklist].map((tab) => tab && tabTarget(tab)), [`#/${session}`, '#/pane/w2:p2', '#/pane/w2:p3', '#/pane/w3:p1']);
});

// A tab split into panes opens the one with a Claude Code session, else its first pane
test('tabTarget_Should_PreferPaneWithSession_InSplitTab', () => {
  /** @type {import('../public/model/herdr.js').HerdrTab} */
  const split = {
    id: 'w2:t9',
    number: 9,
    label: 'split',
    status: 'working',
    panes: [
      { id: 'w2:p8', agent: undefined, status: 'unknown', title: 'shell', session: undefined, size: undefined, activity: undefined },
      { id: 'w2:p9', agent: 'claude', status: 'working', title: 'Work', session, size: undefined, activity: 95 },
    ],
  };

  assert.equal(tabTarget(split), `#/${session}`);
  assert.equal(tabTarget({ ...split, panes: [] }), undefined);
});

test('placeOf_Should_FindWorkspaceAndTabOfOpenSessionOrPane', () => {
  const places = [
    placeOf(layout, { kind: 'session', id: session }),
    placeOf(layout, { kind: 'pane', id: 'w3:p1' }),
    placeOf(layout, { kind: 'session', id: 'not-in-herdr' }),
  ].map((place) => place && `${place.workspace.label} / ${place.tab.label}`);

  assert.deepEqual(places, ['trip_plans / hotels', 'notebook / 1', undefined]);
});

// A workspace whose name matches keeps all its tabs; otherwise only the tabs whose name or terminal title match
test('searchLayout_Should_KeepMatchingWorkspacesAndTabs_IgnoringCase', () => {
  const found = (/** @type {string} */ text) => searchLayout(layout.workspaces, text).map((workspace) => `${workspace.label}: ${workspace.tabs.map((tab) => tab.label).join(', ')}`);

  assert.deepEqual(found(''), ['trip_plans: hotels, visas, search', 'notebook: 1']);
  assert.deepEqual(found('NOTEBOOK'), ['notebook: 1']);
  assert.deepEqual(found(' eu '), ['trip_plans: search']);
  assert.deepEqual(found('visas'), ['trip_plans: visas']);
});

// The address says what the page shows: a session's feed, or a herdr pane's terminal
test('openedAt_Should_ReadSessionOrPaneFromAddress', () => {
  assert.deepEqual(
    [`#/${session}`, '#/pane/w2:pK', '', '#/', '#/pane/', '#/something'].map(openedAt),
    [{ kind: 'session', id: session }, { kind: 'pane', id: 'w2:pK' }, undefined, undefined, undefined, undefined],
  );
});

// The page reads /api/herdr at its boundary: what does not fit the contract is left out, not guessed
test('parseHerdrLayout_Should_KeepWhatFitsContract_AndDropTheRest', () => {
  const reply = JSON.parse(JSON.stringify({ herdr: true, workspaces: [tripPlans, { id: 'broken' }] }));

  assert.deepEqual(parseHerdrLayout(reply), { herdr: true, workspaces: [tripPlans] });
  assert.deepEqual(parseHerdrLayout({ herdr: false, workspaces: [] }), { herdr: false, workspaces: [] });
  assert.deepEqual(parseHerdrLayout('a proxy error page'), { herdr: false, workspaces: [] });
});

// As herdr lists its agents: every session of every workspace, the one whose agent changed state last first; a pane
// without an agent — a shell, nvim — is no session
test('sessionsByActivity_Should_ListEverySessionOfEveryWorkspace_LatestActivityFirst', () => {
  const found = (/** @type {string} */ text) => sessionsByActivity(layout.workspaces, text).map(({ workspace, tab, pane }) => `${workspace.label}/${tab.label}/${pane.id}`);

  assert.deepEqual(found(''), ['trip_plans/search/w2:p3', 'notebook/1/w3:p1', 'trip_plans/hotels/w2:p1']);
  assert.deepEqual(found('NOTEBOOK'), ['notebook/1/w3:p1']);
  assert.deepEqual(found(' eu '), ['trip_plans/search/w2:p3']);
});

// What the viewer says about a tab named or closed; a reply it does not know — or none — is a change not made
test('parseTabChange_Should_TakeKnownReplies_And_CountAnyOtherAsFailed', () => {
  assert.deepEqual(
    [{ ok: true }, { ok: false, error: 'empty' }, { ok: false, error: 'exploded' }, undefined].map(parseTabChange),
    [{ ok: true }, { ok: false, error: 'empty' }, { ok: false, error: 'failed' }, { ok: false, error: 'failed' }],
  );
});
