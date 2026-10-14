// @ts-check
// What is selected in the feed, as markdown — the way the answers were written — rather than the page's plain text:
// headings, emphasis, code, links, lists, quotes, code blocks with their language and tables come back with their marks;
// the page's own parts — copy buttons, labels, line numbers — are left out.

/** The page's own parts inside an answer, not the answer's. */
const notTheAnswer = 'button, svg, .code-bar, .gutter, .icon, .bookmark-flag, .table-tools, [aria-hidden="true"]';

/**
 * @param {Node} root — an answer, or a part of the feed the reader selected (a Range's contents)
 * @returns {string}
 */
export function markdownOf(root) {
  return blocks(root, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The block-level markdown of a node's children, each line led by the prefix (a quote's "> ").
 * @param {Node} node
 * @param {string} prefix
 * @returns {string}
 */
function blocks(node, prefix) {
  let out = '';
  let inline = '';
  const flush = () => {
    const text = inline.trim();
    if (text !== '') out += `${text}\n\n`;
    inline = '';
  };
  for (const child of node.childNodes) {
    if (!(child instanceof Element)) {
      inline += child.textContent ?? '';
      continue;
    }
    if (child.matches(notTheAnswer)) continue;
    const block = blockOf(child);
    if (block === undefined) {
      inline += inlineOf(child);
      continue;
    }
    flush();
    out += block;
  }
  flush();
  return prefix === '' ? out : out.trimEnd().replace(/^(?=.)/gm, prefix).replace(/^$/gm, prefix.trimEnd());
}

/**
 * @param {Element} element
 * @returns {string | undefined} — none for an element that flows in a line
 */
function blockOf(element) {
  const tag = element.tagName;
  const heading = /^H([1-6])$/.exec(tag)?.[1];
  if (heading !== undefined) return `${'#'.repeat(Number(heading))} ${inlineOf(element).trim()}\n\n`;
  switch (tag) {
    case 'P':
      return `${inlineOf(element).trim()}\n\n`;
    case 'UL':
    case 'OL':
      return `${listOf(element, 0)}\n`;
    case 'BLOCKQUOTE':
      return `${blocks(element, '> ').trimEnd()}\n\n`;
    case 'PRE':
      return codeBlockOf(element);
    case 'TABLE':
      return tableOf(element);
    case 'HR':
      return '---\n\n';
    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
      return blocks(element, '');
    default:
      return undefined;
  }
}

/**
 * @param {Node} node
 * @returns {string}
 */
function inlineOf(node) {
  if (!(node instanceof Element)) return node.textContent ?? '';
  if (node.matches(notTheAnswer)) return '';
  const inner = () => [...node.childNodes].map(inlineOf).join('');
  switch (node.tagName) {
    case 'STRONG':
    case 'B':
      return wrap('**', inner());
    case 'EM':
    case 'I':
      return wrap('*', inner());
    case 'DEL':
    case 'S':
      return wrap('~~', inner());
    case 'CODE': {
      const text = node.textContent ?? '';
      const ticks = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length)) + 1);
      return text === '' ? '' : `${ticks}${ticks.length > 1 ? ' ' : ''}${text}${ticks.length > 1 ? ' ' : ''}${ticks}`;
    }
    case 'A': {
      const text = inner();
      const href = node.getAttribute('href') ?? '';
      // a path the page made a link of is written as the path
      if (node.classList.contains('file-link') || href === '' || href === text) return text;
      return `[${text}](${href})`;
    }
    case 'BR':
      return '\n';
    case 'IMG':
      return `![${node.getAttribute('alt') ?? ''}](${node.getAttribute('src') ?? ''})`;
    default:
      return inner();
  }
}

/**
 * Marks around a text, outside its spaces: "** bold **" would not be bold.
 * @param {string} mark
 * @param {string} text
 */
function wrap(mark, text) {
  const inside = text.trim();
  if (inside === '') return text;
  const before = text.slice(0, text.indexOf(inside));
  const after = text.slice(text.indexOf(inside) + inside.length);
  return `${before}${mark}${inside}${mark}${after}`;
}

/**
 * @param {Element} list — UL or OL
 * @param {number} depth
 * @returns {string}
 */
function listOf(list, depth) {
  const ordered = list.tagName === 'OL';
  const start = Number(list.getAttribute('start') ?? '1');
  const indent = '  '.repeat(depth);
  return [...list.children]
    .filter((item) => item.tagName === 'LI')
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : '- ';
      const nested = [...item.children].filter((child) => child.tagName === 'UL' || child.tagName === 'OL');
      const own = [...item.childNodes].filter((child) => !(child instanceof Element && nested.includes(child)));
      const text = own.map(inlineOf).join('').trim();
      return [`${indent}${marker}${text}`, ...nested.map((child) => listOf(child, depth + 1).trimEnd())].join('\n');
    })
    .join('\n')
    .concat('\n');
}

/**
 * @param {Element} pre
 * @returns {string}
 */
function codeBlockOf(pre) {
  const code = pre.querySelector('code') ?? pre;
  const language = /(?:^|\s)language-([\w+#-]+)/.exec(code.className)?.[1] ?? '';
  const parts = [...code.childNodes].filter((child) => !(child instanceof Element && child.matches(notTheAnswer)));
  const text = parts.map((child) => child.textContent ?? '').join('').replace(/\n$/, '');
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`{3,}/g)].map((run) => run[0].length + 1)));
  return `${fence}${language}\n${text}\n${fence}\n\n`;
}

/**
 * @param {Element} table
 * @returns {string}
 */
function tableOf(table) {
  const rows = [...table.querySelectorAll('tr')].map((row) => [...row.children].map((cell) => inlineOf(cell).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')));
  const [head, ...body] = rows;
  if (head === undefined) return '';
  const line = (/** @type {string[]} */ cells) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n').concat('\n\n');
}

/**
 * A copy of what is selected in the feed or a side answer goes as markdown — the formatting as well, for a paste that
 * takes it — when asked for; anywhere else the browser copies as it does.
 * @param {{ clipboardData: Pick<DataTransfer, 'setData'> | null, preventDefault: () => void }} event — the copy event
 * @param {'markdown' | 'plain'} as
 */
export function copySelection(event, as) {
  if (as === 'plain') return;
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0 || event.clipboardData === null) return;
  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const within = common instanceof Element ? common : common.parentElement;
  if (within === null || within.closest('input, textarea') !== null || within.closest('.thread, .side-answer') === null) return;
  const holder = document.createElement('div');
  holder.append(range.cloneContents());
  event.clipboardData.setData('text/plain', markdownOf(holder));
  event.clipboardData.setData('text/html', holder.innerHTML);
  event.preventDefault();
}

/**
 * Copies from the feed: Ctrl+C (Cmd+C) as the reader set it — the browser's own copy unless markdown was asked for —
 * and Ctrl+Shift+C (Cmd+Shift+C) as markdown whatever the setting. The key is told by its place, so a Cyrillic layout's
 * С is C as well; in a text field the shortcut is the field's.
 * @param {Document} page
 * @param {() => 'markdown' | 'plain'} setting — the reader's choice (view-settings.js, copy)
 */
export function listenForCopies(page, setting) {
  /** The copy under way was asked for by the shortcut. */
  let shortcut = false;
  page.addEventListener('copy', (event) => copySelection(event, shortcut ? 'markdown' : setting()));
  page.addEventListener('keydown', (event) => {
    const asMarkdown = (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.code === 'KeyC';
    const inField = event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]') !== null;
    if (!asMarkdown || inField) return;
    // also keeps the browser's own Ctrl+Shift+C — its developer tools' element picker — from opening
    event.preventDefault();
    shortcut = true;
    try {
      // the browser's copy, run at once: its copy event gets the selection as markdown
      page.execCommand('copy');
    } finally {
      shortcut = false;
    }
  });
}
