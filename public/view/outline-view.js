// @ts-check
// Outline to the right of the feed: bookmarks and the user's prompts; a click jumps to the message.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {import('../model/bookmarks.js').Bookmark} Bookmark
 * @typedef {{ id: string, label: string, at: string }} PromptEntry
 * @typedef {{ addPrompt: (prompt: PromptEntry) => void, setBookmarks: (bookmarks: readonly Bookmark[]) => void, setCurrent: (index: number) => void, clear: () => void }} OutlineView
 */

/** @type {Readonly<Record<Bookmark['kind'], string>>} */
const kindNames = { prompt: 'prompt', answer: 'answer', report: 'report' };

/**
 * @param {{ element: HTMLElement, onJump: (id: string) => void, onRemove: (bookmark: Bookmark) => void }} options
 * @returns {OutlineView}
 */
export function createOutline({ element, onJump, onRemove }) {
  const bookmarkCount = h('span', { className: 'outline-count' });
  const bookmarkList = h('div', { className: 'outline-list' });
  const promptCount = h('span', { className: 'outline-count' });
  const promptList = h('div', { className: 'outline-list' });
  element.replaceChildren(
    h('section', { className: 'outline-section' }, [h('div', { className: 'outline-title' }, [h('span', { text: 'Bookmarks' }), bookmarkCount]), bookmarkList]),
    h('section', { className: 'outline-section' }, [h('div', { className: 'outline-title' }, [h('span', { text: 'My prompts' }), promptCount]), promptList]),
  );
  /** @type {HTMLElement[]} */
  const promptItems = [];
  let current = -1;

  const jumpItem = (/** @type {string} */ id, /** @type {HTMLElement[]} */ children, /** @type {string} */ className) => {
    const item = h('div', { className: `outline-item ${className}`, attrs: { role: 'button', tabindex: '0' } }, children);
    item.addEventListener('click', () => onJump(id));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') onJump(id);
    });
    return item;
  };

  const api = {
    /** @param {PromptEntry} prompt */
    addPrompt(prompt) {
      const time = new Date(prompt.at);
      const item = jumpItem(
        prompt.id,
        [
          h('span', { className: 'outline-number', text: String(promptItems.length + 1) }),
          h('span', { className: 'outline-label', text: prompt.label === '' ? 'Image only' : prompt.label, title: prompt.label }),
          h('span', { className: 'outline-time', text: time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), title: time.toLocaleString() }),
        ],
        'prompt',
      );
      promptItems.push(item);
      promptList.append(item);
      promptCount.textContent = String(promptItems.length);
    },
    /** @param {readonly Bookmark[]} bookmarks */
    setBookmarks(bookmarks) {
      bookmarkCount.textContent = bookmarks.length === 0 ? '' : String(bookmarks.length);
      if (bookmarks.length === 0) {
        bookmarkList.replaceChildren(h('div', { className: 'outline-empty', text: 'Hover a message in the feed and click the flag on its right to bookmark it.' }));
        return;
      }
      bookmarkList.replaceChildren(
        ...bookmarks.map((bookmark) => {
          const remove = h('button', { className: 'outline-remove', title: 'Remove bookmark', attrs: { type: 'button' } }, [icon('cross')]);
          remove.addEventListener('click', (event) => {
            event.stopPropagation();
            onRemove(bookmark);
          });
          const item = jumpItem(
            bookmark.id,
            [icon('bookmark'), h('span', { className: 'outline-label', text: bookmark.label, title: `${kindNames[bookmark.kind]}: ${bookmark.label}` }), remove],
            'bookmark',
          );
          item.dataset.kind = bookmark.kind;
          return item;
        }),
      );
    },
    /** @param {number} index — the prompt being read now; -1 means above the first one */
    setCurrent(index) {
      if (index === current) return;
      promptItems[current]?.classList.remove('current');
      current = index;
      const item = promptItems[current];
      item?.classList.add('current');
      item?.scrollIntoView({ block: 'nearest' });
    },
    clear() {
      promptItems.length = 0;
      current = -1;
      promptList.replaceChildren();
      promptCount.textContent = '';
    },
  };
  api.setBookmarks([]);
  return api;
}
