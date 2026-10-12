// @ts-check
// The history of where sessions ran in herdr: every session the viewer sees in a pane is kept with its workspace, its
// tab — and the names the tab had before — its folder, and when it was seen; once it is in no pane it is closed, and
// stays to be found by those and opened there again.

/**
 * @typedef {import('../public/model/history.js').History} History
 * @typedef {import('../public/model/history.js').Place} Place
 * @typedef {{ session: string, workspace: string, tab: string | undefined, folder: string | undefined }} Running — a
 *   session in a herdr pane now; tab: its name, when herdr tells which tab the pane is in
 */

/**
 * The history after a look at herdr.
 * @param {History} history
 * @param {readonly Running[]} running
 * @param {number} now
 * @returns {{ history: History, changed: boolean }} — changed: more than the last sightings of running sessions, worth
 *   writing down
 */
export function observed(history, running, now) {
  /** @type {Record<string, Place>} */
  const next = { ...history };
  let changed = false;
  for (const { session, workspace, tab, folder } of running) {
    const before = history[session];
    const place = {
      workspace,
      tab: tab ?? before?.tab,
      earlierTabs: before === undefined || tab === undefined ? (before?.earlierTabs ?? []) : withEarlierName(before.earlierTabs, before.tab, tab),
      folder: folder ?? before?.folder,
      firstSeen: before?.firstSeen ?? now,
      lastSeen: now,
      open: true,
      note: before?.note,
    };
    changed ||= before === undefined || before.workspace !== workspace || before.tab !== place.tab || before.folder !== place.folder || !before.open;
    next[session] = place;
  }
  const runningNow = new Set(running.map(({ session }) => session));
  for (const [session, place] of Object.entries(history)) {
    if (!place.open || runningNow.has(session)) continue;
    next[session] = { ...place, open: false };
    changed = true;
  }
  return { history: next, changed };
}

/**
 * The names a tab had: the one it is losing joins them, unless it was only its number.
 * @param {readonly string[]} earlier
 * @param {string | undefined} was
 * @param {string} now
 */
function withEarlierName(earlier, was, now) {
  return was === undefined || was === now || /^\d+$/.test(was) || earlier.includes(was) ? earlier : [...earlier, was];
}
