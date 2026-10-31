import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLamp, keptLit, keepToggled, mergeSeen, paneLamp, parseSeen, seeOpened } from '../public/model/lamps.js';

/**
 * @param {import('../public/model/herdr.js').AgentStatus} status
 * @param {number} activity
 * @returns {import('../public/model/herdr.js').HerdrPane}
 */
const pane = (status, activity) => ({ id: 'w1:p1', agent: 'claude', status, title: undefined, session: 's1', size: undefined, activity });
/** @param {import('../public/model/herdr.js').HerdrPane} one */
const layoutOf = (one) => ({ herdr: true, workspaces: [{ id: 'w1', number: 1, label: 'web', status: one.status, activeTab: 'w1:t1', tabs: [{ id: 'w1:t1', number: 1, label: '1', status: one.status, panes: [one] }] }] });

// An agent that finished lights up as ready until its session is seen — opened in the page — then goes out; finishing
// again lights it again; working, it is working — what was seen of it stays, its count telling it from the next answer
test('lamps_Should_LightReadyUntilSeen_AndAgainWhenAgentFinishesAgain', () => {
  const opened = /** @type {const} */ ({ kind: 'session', id: 's1' });
  const done = pane('done', 5);
  const unseen = paneLamp(done, new Map());
  const seen = seeOpened(layoutOf(done), opened, new Map());
  const afterSeeing = paneLamp(done, seen);
  const doneAgain = paneLamp(pane('done', 7), seen);
  const working = pane('working', 8);
  const whileWorking = seeOpened(layoutOf(working), undefined, seen);

  assert.deepEqual(
    { unseen, afterSeeing, doneAgain, working: paneLamp(working, whileWorking), kept: [...whileWorking] },
    { unseen: 'ready', afterSeeing: 'idle', doneAgain: 'ready', working: 'working', kept: [['w1:p1', 5]] },
  );
});

// A tab or a workspace that finished is ready while one of its agents' answers is not seen, else it is out
test('groupLamp_Should_BeReadyWhileAnyOfItsAnswersIsUnseen', () => {
  const panes = [pane('done', 5), { ...pane('done', 3), id: 'w1:p2' }];

  assert.deepEqual(
    [groupLamp('done', panes, new Map([['w1:p1', 5]])), groupLamp('done', panes, new Map([['w1:p1', 5], ['w1:p2', 3]])), groupLamp('blocked', panes, new Map())],
    ['ready', 'idle', 'blocked'],
  );
});

// An agent its user keeps lit to come back to has a lamp of its own, lit steadily — its tab's and its workspace's too —
// once its answer is seen, in the page or in herdr (idle there); not seen yet, it is ready as any; once the agent changes
// state the mark is done with, and the lamp is as ever: working while it works, out once its next answer is seen
test('keptLit_Should_KeepSeenAgentLitSteadily_UntilItChangesState', () => {
  const kept = new Map([['w1:p1', 5]]);
  /** @param {import('../public/model/herdr.js').HerdrPane} one @param {import('../public/model/lamps.js').SeenPanes} seen */
  const lamps = (one, seen) => {
    const workspace = keptLit(layoutOf(one), kept).workspaces[0];
    const tab = workspace?.tabs[0];
    const shown = tab?.panes[0];
    return workspace === undefined || tab === undefined || shown === undefined ? [] : [paneLamp(shown, seen), groupLamp(tab.status, tab.panes, seen), groupLamp(workspace.status, tab.panes, seen)];
  };

  assert.deepEqual(
    {
      notSeenYet: lamps(pane('done', 5), new Map()),
      seenInPage: lamps(pane('done', 5), new Map([['w1:p1', 5]])),
      seenInHerdr: lamps(pane('idle', 5), new Map([['w1:p1', 5]])),
      workingAgain: lamps(pane('working', 6), new Map([['w1:p1', 5]])),
      nextAnswerSeen: lamps(pane('done', 7), new Map([['w1:p1', 7]])),
    },
    {
      notSeenYet: ['ready', 'ready', 'ready'],
      seenInPage: ['kept', 'kept', 'kept'],
      seenInHerdr: ['kept', 'kept', 'kept'],
      workingAgain: ['working', 'working', 'working'],
      nextAnswerSeen: ['idle', 'idle', 'idle'],
    },
  );
});

// One press marks an agent to come back to at its count now, the next takes the mark off; a mark the agent outlived is
// taken for none, and a press marks it anew
test('keepToggled_Should_MarkAtCountNow_TakeMarkOff_AndMarkAnewOverOneOutlived', () => {
  const marked = new Map([['w1:p1', 5]]);

  assert.deepEqual(
    [keepToggled(pane('idle', 5), new Map()), keepToggled(pane('idle', 5), marked), keepToggled(pane('done', 7), marked)],
    [{ pane: 'w1:p1', count: 5 }, { pane: 'w1:p1', count: undefined }, { pane: 'w1:p1', count: 7 }],
  );
});

// What one device saw counts on another: the viewer's answers seen come together with the page's own — a later count
// of the same agent's taking the place of an earlier one — and a reply of another shape is nothing seen
test('seenAnswers_Should_ComeTogetherFromViewerAndPage', () => {
  const fromViewer = parseSeen({ 'w1:p1': 5, 'w1:p2': 3, odd: 'x' });
  const page = new Map([['w1:p2', 7], ['w2:p1', 1]]);

  assert.deepEqual(
    { merged: [...mergeSeen(fromViewer, page)].sort(), other: [...parseSeen([1, 2])] },
    { merged: [['w1:p1', 5], ['w1:p2', 7], ['w2:p1', 1]], other: [] },
  );
});
