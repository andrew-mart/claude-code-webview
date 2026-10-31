import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentOfSession, openedAt, paneSession, parseHerdrLayout, parseNewTab, parseNewWorkspace, parseTabChange, placeOf, searchLayout, sessionsByActivity, successorIn, tabTarget } from '../public/model/herdr.js';

const session = '7d4e1b20-2222-4333-8444-955566667777';

/** @type {import('../public/model/herdr.js').HerdrWorkspace} */
const tripPlans = {
  id: 'w2',
  number: 1,
  label: 'trip_plans',
  status: 'working',
  activeTab: 'w2:t3',
  tabs: [
    { id: 'w2:t1', number: 1, label: 'hotels', status: 'done', panes: [{ id: 'w2:p1', agent: 'claude', status: 'done', title: 'Packing list draft', session, size: undefined, activity: 40, hidden: true }] },
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

// The variables a session restarted starts with, as the viewer tells them: each NAME=VALUE; anything else is left out
test('parseHerdrLayout_Should_KeepVariablesSessionsRestartWith', () => {
  assert.deepEqual(parseHerdrLayout({ herdr: true, restartEnv: ['CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1', 7], workspaces: [] }), {
    herdr: true,
    restartEnv: ['CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1'],
    workspaces: [],
  });
});

// Every session of every workspace, in the order asked: those with their lamp lit — at work, asking, done with an answer
// not seen, kept to come back to — above those idle, each part the one whose agent changed state last first, as herdr
// lists its agents; or by that alone, lamps or not. A pane without an agent — a shell, nvim — is no session
test('sessionsByActivity_Should_ListEverySessionOfEveryWorkspace_LitFirstOrLatestChangeFirst_AsAsked', () => {
  /** @param {string} text @param {import('../public/model/lamps.js').SeenPanes} seen @param {import('../public/model/herdr.js').SessionOrder} [order] */
  const found = (text, seen, order = 'lamps') => sessionsByActivity(layout.workspaces, text, seen, order).map(({ workspace, tab, pane }) => `${workspace.label}/${tab.label}/${pane.id}`);

  assert.deepEqual(
    {
      unseen: found('', new Map()),
      seen: found('', new Map([['w2:p1', 40]])),
      searched: [found('NOTEBOOK', new Map()), found(' eu ', new Map())],
      latestChange: found('', new Map(), 'activity'),
    },
    {
      // the finished agent's answer not seen yet — its lamp lit — goes above the idle one that changed later
      unseen: ['trip_plans/search/w2:p3', 'trip_plans/hotels/w2:p1', 'notebook/1/w3:p1'],
      seen: ['trip_plans/search/w2:p3', 'notebook/1/w3:p1', 'trip_plans/hotels/w2:p1'],
      searched: [['notebook/1/w3:p1'], ['trip_plans/search/w2:p3']],
      // lamps or not: the latest change first
      latestChange: ['trip_plans/search/w2:p3', 'notebook/1/w3:p1', 'trip_plans/hotels/w2:p1'],
    },
  );
});

// What the viewer says about a tab named or closed; a reply it does not know — or none — is a change not made
test('parseTabChange_Should_TakeKnownReplies_And_CountAnyOtherAsFailed', () => {
  assert.deepEqual(
    [{ ok: true }, { ok: false, error: 'empty' }, { ok: false, error: 'exploded' }, undefined].map(parseTabChange),
    [{ ok: true }, { ok: false, error: 'empty' }, { ok: false, error: 'failed' }, { ok: false, error: 'failed' }],
  );
});

// A tab opened from the page comes back with its page address; a reply without one — or none — is a tab not opened
test('parseNewTab_Should_TakeAddressOfNewTab_And_CountAnyOtherAsFailed', () => {
  assert.deepEqual(
    [{ ok: true, target: '#/pane/w2:p9' }, { ok: true }, { ok: false, error: 'failed' }, undefined].map(parseNewTab),
    [{ ok: true, target: '#/pane/w2:p9' }, { ok: false, error: 'failed' }, { ok: false, error: 'failed' }, { ok: false, error: 'failed' }],
  );
});

// A workspace opened from the page comes back with its page address, or why it was not opened; anything else — or no
// reply — is a workspace not opened
test('parseNewWorkspace_Should_TakeAddressOrReason_And_CountAnyOtherAsFailed', () => {
  assert.deepEqual(
    [{ ok: true, target: '#/pane/w5:p1' }, { ok: false, error: 'no-folder' }, { ok: false, error: 'not-created' }, { ok: false, error: 'empty' }, { ok: false, error: 'boom' }, undefined].map(parseNewWorkspace),
    [{ ok: true, target: '#/pane/w5:p1' }, { ok: false, error: 'no-folder' }, { ok: false, error: 'not-created' }, { ok: false, error: 'empty' }, { ok: false, error: 'failed' }, { ok: false, error: 'failed' }],
  );
});

// /clear, /new, /resume in the tab of the session the page shows: its pane goes on with another session, which the page
// follows; a session still in a pane — this one or another — a pane gone or left with a shell, or a session that was in
// no pane, has none to follow
test('successorIn_Should_TellSessionItsPaneWentOnWith', () => {
  const cleared = '5b0e8d14-3333-4444-8555-a66677778888';
  /**
   * trip_plans with these sessions in its panes, by pane id, the others with none; resume's tab closed unless its pane
   * is told.
   * @param {Readonly<Record<string, string | undefined>>} sessions
   * @returns {import('../public/model/herdr.js').HerdrLayout}
   */
  const running = (sessions) => ({
    herdr: true,
    workspaces: [{ ...tripPlans, tabs: tripPlans.tabs.filter((tab) => tab.id !== 'w2:t1' || 'w2:p1' in sessions).map((tab) => ({ ...tab, panes: tab.panes.map((pane) => ({ ...pane, session: sessions[pane.id] })) })) }],
  });
  const before = running({ 'w2:p1': session });

  assert.deepEqual(
    [
      successorIn(before, running({ 'w2:p1': cleared }), session),
      successorIn(before, running({ 'w2:p1': session }), session),
      successorIn(before, running({ 'w2:p1': cleared, 'w2:p3': session }), session),
      successorIn(before, running({}), session),
      successorIn(before, running({ 'w2:p1': undefined }), session),
      successorIn(running({ 'w2:p1': undefined }), running({ 'w2:p1': cleared }), session),
    ],
    [cleared, undefined, undefined, undefined, undefined, undefined],
  );
});

// A terminal the page shows turns into the session Claude Code starts in it — a tab opened with Claude, or claude typed
// there; a pane that had the session when the page opened it stays a terminal, and so does one where none started
test('paneSession_Should_TellSessionStartedInPane_SincePageOpenedIt', () => {
  /** @type {import('../public/model/herdr.js').HerdrLayout} */
  const started = { herdr: true, workspaces: [{ ...notebook, tabs: [{ id: 'w3:t1', number: 1, label: '1', status: 'idle', panes: [{ id: 'w3:p1', agent: 'claude', status: 'idle', title: '', session, size: undefined, activity: 60 }] }] }] };

  assert.deepEqual(
    [paneSession(started, 'w3:p1', undefined), paneSession(started, 'w3:p1', session), paneSession(layout, 'w3:p1', undefined), paneSession(layout, 'w9:p9', undefined)],
    [session, undefined, undefined, undefined],
  );
});

// A session the list has no transcript of yet — Codex writes its thread's file only with the first message — is the
// agent's that herdr runs it in: Codex's in a Codex pane; in a Claude pane, or in none, Claude Code's
test('agentOfSession_Should_TellAgentOfPaneRunningSession', () => {
  const thread = '01a18cb3-a5fe-7523-836f-de7520188f53';
  /** @type {import('../public/model/herdr.js').HerdrLayout} */
  const running = {
    herdr: true,
    workspaces: [
      {
        ...notebook,
        tabs: [
          { id: 'w3:t1', number: 1, label: '1', status: 'idle', panes: [{ id: 'w3:p1', agent: 'codex', status: 'idle', title: 'notebook', session: thread, size: undefined, activity: 60 }] },
          { id: 'w3:t2', number: 2, label: '2', status: 'idle', panes: [{ id: 'w3:p2', agent: 'claude', status: 'idle', title: 'notebook', session, size: undefined, activity: 61 }] },
        ],
      },
    ],
  };

  assert.deepEqual([agentOfSession(running, thread), agentOfSession(running, session), agentOfSession(running, 'nowhere')], ['codex', 'claude', 'claude']);
});
