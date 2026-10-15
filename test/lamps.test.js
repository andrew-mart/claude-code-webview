import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLamp, mergeSeen, paneLamp, parseSeen, seeOpened } from '../public/model/lamps.js';

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
