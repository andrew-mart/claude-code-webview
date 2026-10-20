import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory } from '../public/model/history.js';
import { observed } from '../server/session-history.js';

/** @param {number} minutes — after 10:00 */
const at = (minutes) => Date.UTC(2026, 9, 12, 10, minutes);
/**
 * A session as herdr shows it now: in the kiwi workspace, in this tab — its pane's terminal herdr's term_<tab> unless
 * told.
 * @param {string} session
 * @param {string} tab
 * @param {string} [terminal]
 */
const running = (session, tab, terminal = `term_${tab}`) => ({ session, workspace: 'kiwi', tab, folder: 'D:/dev/kiwi', terminal });

test('history_Should_KeepGptLaunchForAnUnansweredSession_AfterItClosesAndViewerRestarts', () => {
  const live = observed({}, [{ ...running('s1', 'gateway'), claudeGpt: true }], at(0));
  const closed = observed(live.history, [], at(1));
  const restarted = parseHistory(JSON.parse(JSON.stringify(closed.history)));

  assert.equal(restarted.s1?.claudeGpt, true);
  assert.equal(restarted.s1?.open, false);
});

// A session seen in a herdr pane is remembered with where it runs — workspace, tab, its pane's terminal, folder — and
// since when
test('observed_Should_RememberWhereSessionRuns_And_SinceWhen', () => {
  assert.deepEqual(observed({}, [running('s1', 'code-review')], at(0)), {
    history: { s1: { workspace: 'kiwi', tab: 'code-review', earlierTabs: [], terminal: 'term_code-review', folder: 'D:/dev/kiwi', firstSeen: at(0), lastSeen: at(0), open: true, note: undefined } },
    changed: true,
  });
});

// Seen again as it was, only its last sighting moves: nothing worth writing down. Renamed, the name it had is kept for
// the search — a tab nobody named only had its number, which is no name
test('observed_Should_KeepNamesTabHad_And_TellOnlyChangesWorthKeeping', () => {
  const first = observed({}, [running('s1', '1', 'term_a')], at(0)).history;
  const again = observed(first, [running('s1', '1', 'term_a')], at(1));
  const named = observed(again.history, [running('s1', 'review', 'term_a')], at(2));
  const renamed = observed(named.history, [running('s1', 'code-review', 'term_a')], at(3));

  assert.deepEqual([again.changed, named.changed, named.history.s1?.earlierTabs, renamed.history.s1], [
    false,
    true,
    [],
    { workspace: 'kiwi', tab: 'code-review', earlierTabs: ['review'], terminal: 'term_a', folder: 'D:/dev/kiwi', firstSeen: at(0), lastSeen: at(3), open: true, note: undefined },
  ]);
});

// A session gone from every pane is closed — when it was last seen — and stays in the history, to be found again
test('observed_Should_CloseSessionGoneFromHerdr_WhenItWasLastSeen', () => {
  const both = observed({}, [running('s1', 'review'), running('s2', 'tests')], at(0)).history;

  const { history, changed } = observed(both, [running('s2', 'tests')], at(5));

  assert.deepEqual({ changed, s1: history.s1, s2open: history.s2?.open }, {
    changed: true,
    s1: { workspace: 'kiwi', tab: 'review', earlierTabs: [], terminal: 'term_review', folder: 'D:/dev/kiwi', firstSeen: at(0), lastSeen: at(0), open: false, note: undefined },
    s2open: true,
  });
});

// What older viewers kept — a session's workspace alone — is a place without a tab; anything unreadable is left out
test('parseHistory_Should_ReadOlderWorkspacesFile_AsPlacesWithoutTab', () => {
  const kept = { s1: 'kiwi', s2: { workspace: 'web', tab: 'tests', earlierTabs: ['t'], terminal: 'term_65cd', folder: 'D:/web', firstSeen: at(0), lastSeen: at(1), open: true, note: 'flaky' }, s3: 42 };

  assert.deepEqual(parseHistory(kept), {
    s1: { workspace: 'kiwi', tab: undefined, earlierTabs: [], terminal: undefined, folder: undefined, firstSeen: undefined, lastSeen: undefined, open: false, note: undefined },
    s2: { workspace: 'web', tab: 'tests', earlierTabs: ['t'], terminal: 'term_65cd', folder: 'D:/web', firstSeen: at(0), lastSeen: at(1), open: true, note: 'flaky' },
  });
});

// A closed tab opened again — one of its conversations resumed in a new tab — brings the tab's other conversations
// along; a conversation resumed elsewhere while its tab stays open, with another one in it, goes there alone
test('observed_Should_MoveClosedTabsConversations_ToTabOneOfThemIsResumedIn', () => {
  const started = observed({}, [running('s1', 'review', 'term_a'), running('s3', 'tests', 'term_b')], at(0)).history;
  const cleared = observed(started, [running('s2', 'review', 'term_a'), running('s4', 'tests', 'term_b')], at(1)).history;
  const clearedAgain = observed(cleared, [running('s2', 'review', 'term_a'), running('s5', 'tests', 'term_b')], at(2)).history;
  const closed = observed(clearedAgain, [running('s5', 'tests', 'term_b')], at(3)).history;

  const { history, changed } = observed(closed, [running('s5', 'tests', 'term_b'), running('s1', 'review', 'term_c'), running('s3', 'tests', 'term_d')], at(4));

  assert.deepEqual({ changed, terminals: Object.fromEntries(Object.entries(history).map(([session, place]) => [session, place.terminal])) }, {
    changed: true,
    terminals: { s1: 'term_c', s2: 'term_c', s3: 'term_d', s4: 'term_b', s5: 'term_b' },
  });
});
