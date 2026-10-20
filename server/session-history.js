// @ts-check
// The history of where sessions ran in herdr: every session the viewer sees in a pane is kept with its workspace, its
// tab — and the names the tab had before — the terminal that tells the tab from others, its folder, and when it was
// seen; once it is in no pane it is closed, and stays to be found by those and opened there again. A tab's conversations
// are the sessions of its terminal, one after another as /clear, /resume or a new claude started them; a closed tab
// opened again — one of its conversations resumed in a new tab — takes the others along.

/**
 * @typedef {import('../public/model/history.js').History} History
 * @typedef {import('../public/model/history.js').Place} Place
 * @typedef {{ session: string, workspace: string, claudeGpt?: boolean, tab: string | undefined, terminal: string | undefined, folder: string | undefined }} Running — a
 *   session in a herdr pane now; tab: its name, when herdr tells which tab the pane is in; terminal: the pane's
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
  const reopened = reopenedTabs(history, running);
  /** @type {Record<string, Place>} */
  const next = Object.fromEntries(Object.entries(history).map(([session, place]) => [session, movedFrom(place, reopened)]));
  let changed = reopened.size > 0;
  for (const { session, workspace, tab, terminal, folder, claudeGpt } of running) {
    const before = next[session];
    const place = {
      workspace,
      ...((claudeGpt ?? before?.claudeGpt) === true ? { claudeGpt: /** @type {const} */ (true) } : {}),
      tab: tab ?? before?.tab,
      earlierTabs: before === undefined || tab === undefined ? (before?.earlierTabs ?? []) : withEarlierName(before.earlierTabs, before.tab, tab),
      terminal: terminal ?? before?.terminal,
      folder: folder ?? before?.folder,
      firstSeen: before?.firstSeen ?? now,
      lastSeen: now,
      open: true,
      note: before?.note,
    };
    changed ||= before === undefined || before.workspace !== workspace || before.tab !== place.tab || before.terminal !== place.terminal || before.folder !== place.folder || !before.open || before.claudeGpt !== place.claudeGpt;
    next[session] = place;
  }
  const runningNow = new Set(running.map(({ session }) => session));
  for (const [session, place] of Object.entries(next)) {
    if (!place.open || runningNow.has(session)) continue;
    next[session] = { ...place, open: false };
    changed = true;
  }
  return { history: next, changed };
}

/**
 * The closed tabs opened again: a conversation seen in another tab than its own, which no conversation runs in now.
 * @param {History} history
 * @param {readonly Running[]} running
 * @returns {Map<string, string>} — the terminal of the tab it is in now, by the closed one's
 */
function reopenedTabs(history, running) {
  const runningIn = new Set(running.map(({ terminal }) => terminal));
  return new Map(
    running.flatMap(({ session, terminal }) => {
      const was = history[session]?.terminal;
      return terminal === undefined || was === undefined || was === terminal || runningIn.has(was) ? [] : [/** @type {const} */ ([was, terminal])];
    }),
  );
}

/**
 * A conversation of a closed tab opened again, in the tab it is in now.
 * @param {Place} place
 * @param {ReadonlyMap<string, string>} reopened — the terminal of the tab opened again, by the closed one's
 * @returns {Place}
 */
function movedFrom(place, reopened) {
  const now = place.terminal === undefined ? undefined : reopened.get(place.terminal);
  return now === undefined ? place : { ...place, terminal: now };
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
