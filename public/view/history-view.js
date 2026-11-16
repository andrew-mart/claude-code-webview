// @ts-check
// The conversations of herdr tabs, in the side panel: those of the tab the session shown runs or ran in — the one
// running first, then those it went on from after /clear, /new or /resume — and the tabs nothing runs in now, the latest
// closed first, each with its conversations. A conversation opens to be read; a closed tab opens again in herdr, its
// latest conversation resumed in it, the others along. A search over the history at its top shows, in their place, the
// tabs it finds — open or closed — by a tab's name, its workspace, folder, or a conversation's title, note or id. A conversation is drawn as the session list draws a session
// (session-row.js), its workspace's colour on its edge; the heads as the list's.
import { formatAgo } from '../model/format.js';
import { closedTabs, foundTabs, tabConversations } from '../model/history.js';
import { splitTabIcon } from '../model/tab-icon.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { sessionRowParts } from './session-row.js';
import { tintByWorkspace } from './workspace-tint.js';

/**
 * @typedef {import('../model/history.js').History} History
 * @typedef {import('../model/history.js').Conversation} Conversation
 * @typedef {{ title: string | undefined, activeAt: number }} Listed — a session as the session list has it
 * @typedef {{ shown: () => string | undefined, history: () => History, listed: (id: string) => Listed | undefined, open: (id: string) => void, reopen: (id: string) => Promise<import('../model/herdr.js').NewTab>, now: () => number, iconOf: (workspace: string) => string | undefined }} HistorySource
 *   — shown: the session the page shows; listed: none for a session the viewer has no transcript of — nothing to read;
 *   open: a conversation shown on the page; reopen: a closed tab opened again in herdr, this conversation resumed in it;
 *   iconOf: a workspace's icon, by its name — none for one with none
 * @typedef {{ id: string, title: string, workspace: string, where: string, icon: string | undefined, ago: string, running: boolean, shown: boolean }} Row
 *   — a conversation as the panel lists it: where — its workspace, named without its icon, and its tab; running in its
 *   tab now, shown on the page
 * @typedef {{ first: Row, more: readonly Row[], restores: string }} ClosedShown — first: the row Restore is beside;
 *   restores: the conversation Restore resumes, its tab's latest
 */

/**
 * @param {HistorySource} source
 * @returns {{ element: HTMLElement, reload: () => Promise<void>, summary: () => string | undefined }} — reload: drawn
 *   anew from what the page knows now; summary: the shown session's tab, for the panel's header
 */
export function createHistoryView(source) {
  const search = h('input', { className: 'search history-search', attrs: { type: 'search', placeholder: 'Search: tab, workspace, folder, title, note', 'aria-label': 'Search the history', autocomplete: 'off' } });
  // what it shows is drawn under the search, which stays as it is typed into
  const shows = h('div', { className: 'history-shown' });
  const element = h('div', { className: 'history' }, [h('div', { className: 'history-search-row' }, [search]), shows]);
  /** What the panel shows, to draw it again only when that changes: a tab being restored stays so meanwhile. */
  let drawn = '';

  /** @param {Conversation} conversation @param {string | undefined} shown @returns {Row[]} — none for one with nothing to read */
  const rowOf = ({ id, place }, shown) => {
    const listed = source.listed(id);
    if (listed === undefined) return [];
    const where = [splitTabIcon(place.workspace).name, place.tab].filter((part) => part !== undefined).join(' · ');
    return [{ id, title: listed.title ?? 'Untitled', workspace: place.workspace, where, icon: source.iconOf(place.workspace), ago: formatAgo(listed.activeAt, source.now()), running: place.open, shown: id === shown }];
  };

  /** The shown session's tab, while a conversation runs in it; a closed tab's conversation is marked among the closed. */
  const shownTab = (/** @type {History} */ history, /** @type {string | undefined} */ shown) => {
    const conversations = shown === undefined ? [] : tabConversations(history, shown);
    const place = conversations.find((conversation) => conversation.id === shown)?.place;
    if (place === undefined || conversations[0]?.place.open !== true) return [];
    return [conversations.flatMap((conversation) => rowOf(conversation, shown))];
  };

  /** @param {import('../model/history.js').ClosedTab} tab @param {string | undefined} shown @returns {ClosedShown[]} */
  const closedShown = ({ conversations }, shown) => {
    const [first, ...more] = conversations.flatMap((conversation) => rowOf(conversation, shown));
    const latest = conversations[0];
    return first === undefined || latest === undefined ? [] : [{ first, more, restores: latest.id }];
  };

  /** With no search, the shown session's tab and the tabs closed; searching, the tabs found, running or closed. */
  const render = () => {
    const shown = source.shown();
    const history = source.history();
    const wanted = search.value.trim();
    const found = wanted === '' ? undefined : foundTabs(history, wanted, (id) => source.listed(id)?.title);
    const running = found === undefined ? shownTab(history, shown) : found.open.map((tab) => tab.conversations.flatMap((conversation) => rowOf(conversation, shown))).filter((rows) => rows.length > 0);
    const closed = (found === undefined ? closedTabs(history) : found.closed).flatMap((tab) => closedShown(tab, shown));
    const look = JSON.stringify([wanted, running, closed]);
    if (look === drawn) return;
    drawn = look;
    const sections = [...(found === undefined ? running.map(thisTab) : openTabs(running)), ...closedTabsShown(closed)];
    const nothing = found === undefined ? 'No herdr tab has had a conversation to show yet.' : 'No tab in the history matches the search.';
    shows.replaceChildren(...(sections.length === 0 ? [h('div', { className: 'panel-message', text: nothing })] : sections));
  };
  search.addEventListener('input', render);

  /** @param {Row} row */
  const rowElement = ({ id, title, workspace, where, icon, ago, running, shown }) => {
    const link = h('a', { className: 'herdr-tab history-conversation', attrs: { href: `#/${id}` } }, sessionRowParts({ icon, title, where }, [h('span', { className: 'history-ago', text: ago })]));
    tintByWorkspace(link, workspace);
    link.classList.toggle('running', running);
    link.classList.toggle('selected', shown);
    if (shown) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      source.open(id);
    });
    return link;
  };

  /** @param {readonly Row[]} rows */
  const thisTab = (rows) => h('section', { className: 'history-tab' }, [h('h2', { className: 'history-heading', text: 'This tab' }), ...rows.map(rowElement)]);

  /** The tabs a search found running, under one head. @param {readonly (readonly Row[])[]} tabs */
  const openTabs = (tabs) => (tabs.length === 0 ? [] : [h('h2', { className: 'history-heading', text: 'Open tabs' }), ...tabs.map((rows) => h('section', { className: 'history-tab' }, rows.map(rowElement)))]);

  /** @param {readonly ClosedShown[]} tabs */
  const closedTabsShown = (tabs) => (tabs.length === 0 ? [] : [h('h2', { className: 'history-heading history-closed-heading', text: 'Closed tabs' }), ...tabs.map(closedSection)]);

  /** @param {ClosedShown} tab */
  const closedSection = ({ first, more, restores }) => {
    const restoring = 'Restore: open the tab again in herdr, its latest conversation resumed — the others along';
    const restore = h('button', { className: 'icon-button history-restore', title: restoring, attrs: { type: 'button', 'aria-label': restoring } }, [icon('undo')]);
    // Restore in the row of the tab's latest conversation, at its right end
    const section = h('section', { className: 'history-closed-tab' }, [h('div', { className: 'history-closed-head' }, [rowElement(first), restore]), ...more.map(rowElement)]);
    restore.addEventListener('click', () => {
      restore.disabled = true;
      section.querySelector('.history-error')?.remove();
      void source.reopen(restores).then((opened) => {
        restore.disabled = false;
        if (opened.ok) source.open(restores);
        else section.append(h('div', { className: 'history-error', text: 'herdr did not open the tab.' }));
      });
    });
    return section;
  };

  return {
    element,
    async reload() {
      render();
    },
    summary: () => undefined,
  };
}

/**
 * The conversation a session's tab went on from, over its feed: a click shows it.
 * @param {{ id: string, title: string, activeAt: number }} earlier
 * @param {number} now
 * @returns {HTMLAnchorElement}
 */
export function earlierLink({ id, title, activeAt }, now) {
  return h('a', { className: 'tab-earlier', title: 'Read the conversation this tab had before this one', attrs: { href: `#/${id}` } }, [
    icon('history'),
    h('span', { className: 'tab-earlier-label', text: 'Earlier in this tab' }),
    h('span', { className: 'tab-earlier-title', text: title }),
    h('span', { className: 'tab-earlier-ago', text: formatAgo(activeAt, now) }),
  ]);
}
