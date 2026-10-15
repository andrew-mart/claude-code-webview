// @ts-check
// The sidebar's head, one row over the lists: the account's usage, then 🔍 — the search, opened in place of the row —
// ⇄ — the other list, herdr's or every session's — and the list's own button: ⚙, the sessions list's options over it,
// or herdr's ＋ for a new workspace. Searching and switching are seldom: the lists get the height.
import { h } from './dom.js';
import { icon } from './icons.js';

/** @typedef {'herdr' | 'sessions'} SidebarMode */

/** Where ⇄ goes from each list: the other one — its name, what it shows, its icon. */
const otherList = /** @type {const} */ ({
  herdr: { mode: 'sessions', name: 'Sessions', title: 'Every session, latest first', icon: 'list' },
  sessions: { mode: 'herdr', name: 'herdr', title: "herdr's workspaces and their tabs, as herdr shows them", icon: 'shell' },
});

/**
 * @param {{ row: HTMLElement, searchRow: HTMLElement, search: HTMLInputElement, options: HTMLElement, newWorkspace: HTMLElement, onMode: (mode: SidebarMode) => void }} parts
 *   — row: the head's, its buttons put at its end; searchRow: the search box's, shown in place of the row; options: the
 *   sessions list's, shown over the list; newWorkspace: herdr's ＋; onMode: the other list asked for
 */
export function createSidebarHead({ row, searchRow, search, options, newWorkspace, onMode }) {
  /** @param {string} className @param {Parameters<typeof icon>[0]} iconName @param {string} name */
  const button = (className, iconName, name) => h('button', { className: `icon-button ${className}`, title: name, attrs: { type: 'button', 'aria-label': name } }, [icon(iconName)]);
  const find = button('sidebar-find', 'search', 'Search');
  const switching = button('sidebar-switch', 'list', 'Sessions');
  const opening = button('sidebar-options', 'sliders', 'Options of the list');
  opening.setAttribute('aria-expanded', 'false');
  row.append(h('span', { className: 'sidebar-tools' }, [find, switching, opening, newWorkspace]));
  const closing = button('search-close', 'cross', 'Close the search');
  searchRow.append(closing);
  /** @type {SidebarMode} */
  let mode = 'sessions';

  /** @param {boolean} open */
  const showSearch = (open) => {
    row.hidden = open;
    searchRow.hidden = !open;
  };
  const closeSearch = () => {
    search.value = '';
    showSearch(false);
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  // a search the browser kept over a reload is shown, not left filtering the lists out of sight
  showSearch(search.value !== '');
  find.addEventListener('click', () => {
    showSearch(true);
    search.focus();
  });
  closing.addEventListener('click', closeSearch);
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeSearch();
  });

  switching.addEventListener('click', () => onMode(otherList[mode].mode));

  /** @param {Event} press */
  const onPress = (press) => {
    if (press.target instanceof window.Node && (options.contains(press.target) || opening.contains(press.target))) return;
    showOptions(false);
  };
  /** @param {boolean} open */
  const showOptions = (open) => {
    options.hidden = !open;
    opening.setAttribute('aria-expanded', String(open));
    if (open) window.document.addEventListener('pointerdown', onPress, true);
    else window.document.removeEventListener('pointerdown', onPress, true);
  };
  showOptions(false);
  opening.addEventListener('click', () => showOptions(options.hidden));
  options.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    showOptions(false);
  });

  return {
    /**
     * The list shown now — and whether herdr is there to switch to.
     * @param {{ mode: SidebarMode, herdr: boolean }} state
     */
    show(state) {
      mode = state.mode;
      const other = otherList[mode];
      switching.hidden = !state.herdr;
      switching.title = other.title;
      switching.setAttribute('aria-label', other.name);
      switching.replaceChildren(icon(other.icon));
      opening.hidden = mode !== 'sessions';
      if (mode !== 'sessions') showOptions(false);
      newWorkspace.hidden = mode !== 'herdr';
    },
  };
}
