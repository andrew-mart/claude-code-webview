// @ts-check
// The conversations of herdr tabs, in the side panel: those of the tab the session shown runs or ran in — the one
// running first, then those it went on from after /clear, /new or /resume — and the tabs nothing runs in now, the latest
// closed first, each with its conversations. A conversation opens to be read; a closed tab opens again in herdr, its
// latest conversation resumed in it, the others along.
import { formatAgo } from '../model/format.js';
import { closedTabs, tabConversations } from '../model/history.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {import('../model/history.js').History} History
 * @typedef {import('../model/history.js').Conversation} Conversation
 * @typedef {{ title: string | undefined, activeAt: number }} Listed — a session as the session list has it
 * @typedef {{ shown: () => string | undefined, history: () => History, listed: (id: string) => Listed | undefined, open: (id: string) => void, reopen: (id: string) => Promise<import('../model/herdr.js').NewTab>, now: () => number }} HistorySource
 *   — shown: the session the page shows; listed: none for a session the viewer has no transcript of — nothing to read;
 *   open: a conversation shown on the page; reopen: a closed tab opened again in herdr, this conversation resumed in it
 * @typedef {{ id: string, title: string, ago: string, running: boolean, shown: boolean }} Row — a conversation as the
 *   panel lists it: running in its tab now, shown on the page
 * @typedef {{ heading: string, rows: readonly Row[] }} TabShown
 * @typedef {TabShown & { restores: string }} ClosedShown — restores: the conversation "Restore" resumes, its tab's latest
 */

/**
 * @param {HistorySource} source
 * @returns {{ element: HTMLElement, reload: () => Promise<void>, summary: () => string | undefined }} — reload: drawn
 *   anew from what the page knows now; summary: the shown session's tab, for the panel's header
 */
export function createHistoryView(source) {
  const element = h('div', { className: 'history' });
  /** What the panel shows, to draw it again only when that changes: a tab being restored stays so meanwhile. */
  let drawn = '';

  /** @param {Conversation} conversation @param {string | undefined} shown @returns {Row[]} — none for one with nothing to read */
  const rowOf = ({ id, place }, shown) => {
    const listed = source.listed(id);
    return listed === undefined ? [] : [{ id, title: listed.title ?? 'Untitled', ago: formatAgo(listed.activeAt, source.now()), running: place.open, shown: id === shown }];
  };

  /** The shown session's tab, while a conversation runs in it; a closed tab's conversation is marked among the closed. */
  const shownTab = (/** @type {History} */ history, /** @type {string | undefined} */ shown) => {
    const conversations = shown === undefined ? [] : tabConversations(history, shown);
    const place = conversations.find((conversation) => conversation.id === shown)?.place;
    if (place === undefined || conversations[0]?.place.open !== true) return [];
    return [{ heading: ['This tab', place.workspace, place.tab].filter((part) => part !== undefined).join(' · '), rows: conversations.flatMap((conversation) => rowOf(conversation, shown)) }];
  };

  /** @param {import('../model/history.js').ClosedTab} tab @param {string | undefined} shown @returns {ClosedShown[]} */
  const closedShown = ({ workspace, tab, conversations }, shown) => {
    const rows = conversations.flatMap((conversation) => rowOf(conversation, shown));
    const latest = conversations[0];
    return rows.length === 0 || latest === undefined ? [] : [{ heading: `${workspace} · ${tab}`, rows, restores: latest.id }];
  };

  const render = () => {
    const shown = source.shown();
    const history = source.history();
    const tab = shownTab(history, shown);
    const closed = closedTabs(history).flatMap((one) => closedShown(one, shown));
    const look = JSON.stringify([tab, closed]);
    if (look === drawn) return;
    drawn = look;
    const sections = [...tab.map(tabSection), ...closed.map(closedSection)];
    element.replaceChildren(...(sections.length === 0 ? [h('div', { className: 'panel-message', text: 'No herdr tab has had a conversation to show yet.' })] : sections));
  };

  /** @param {Row} row */
  const rowElement = ({ id, title, ago, running, shown }) => {
    const link = h('a', { className: 'history-conversation', attrs: { href: `#/${id}` } }, [h('span', { className: 'history-title', text: title }), h('span', { className: 'history-ago', text: ago })]);
    link.classList.toggle('running', running);
    link.classList.toggle('shown', shown);
    if (shown) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      source.open(id);
    });
    return link;
  };

  /** @param {TabShown} tab */
  const tabSection = ({ heading, rows }) => h('section', { className: 'history-tab' }, [h('h2', { className: 'history-heading', text: heading }), ...rows.map(rowElement)]);

  /** @param {ClosedShown} tab */
  const closedSection = ({ heading, rows, restores }) => {
    const restore = h('button', { className: 'history-restore', text: 'Restore', title: 'Open the tab again in herdr, its latest conversation resumed — the others along', attrs: { type: 'button' } });
    const section = h('section', { className: 'history-closed-tab' }, [h('div', { className: 'history-closed-head' }, [h('h3', { className: 'history-heading', text: heading }), restore]), ...rows.map(rowElement)]);
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
