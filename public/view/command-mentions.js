// @ts-check
// A slash command an answer names — /clear, /opsx:propose — made a button: pressed, it goes into the prompt box
// (app.js), to be sent from there. One in the answer's words is a word of its own — not a part of a path (D:/dev,
// /home/ann/shop) or of an address, nor an address after its HTTP method (POST /score) — and gives the command alone;
// one in code of its own (`/opsx:propose service-deploy`) gives all the code: the command with the words after it — not
// a comparison (`/ready == 200`). Code blocks and links are left as they are.
import { h } from './dom.js';

/** A command's name after its slash: a letter, then letters, digits, - and _; a plugin's command after a colon. */
const name = '[a-z][a-z0-9_-]*(?::[a-z0-9_-]+)*';
/**
 * A command in the answer's words: after the start, a space or an opening mark; before the end, a space, a closing
 * mark, or a stop with a space after it — not before a slash or a dot of a path.
 */
const inWords = new RegExp(`(^|[\\s(«"'“])(\\/${name})(?=$|[\\s)»"'”,;!?]|[.:](?:\\s|$))`, 'g');
/**
 * Code of its own a command opens: the command, then nothing more, or a space and what it takes — words, not a
 * comparison of an address's answer (`/ready == 200`).
 */
const inCode = new RegExp(`^\\/${name}(?:$|\\s+[\\p{L}\\p{N}"'«-])`, 'u');
/** An address after its HTTP method (POST /score) is no command. */
const afterMethod = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+$/;
/** Where an answer's words are not its own words: code, links, and the page's buttons. */
const notWords = 'pre, code, a, button';

/**
 * The slash commands an answer names made buttons.
 * @param {Element} root — an answer as the feed shows it
 */
export function markCommands(root) {
  for (const code of root.querySelectorAll('code')) {
    const text = (code.textContent ?? '').trim();
    if (code.closest('pre, a, button') !== null || !inCode.test(text)) continue;
    const button = commandButton(text);
    code.replaceWith(button);
    button.append(code);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  /** @type {Text[]} */
  const words = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node instanceof Text && node.parentElement?.closest(notWords) === null) words.push(node);
  for (const node of words) markWords(node);
}

/**
 * The command a button made of one gives.
 * @param {Element} button
 * @returns {string | undefined} — none for any other element
 */
export function commandOf(button) {
  return button.getAttribute('data-command') ?? undefined;
}

/**
 * The commands in a run of an answer's words made buttons, the words around them kept.
 * @param {Text} node
 */
function markWords(node) {
  const found = [...node.data.matchAll(inWords)];
  if (found.length === 0) return;
  /** @type {(Text | HTMLButtonElement)[]} */
  const parts = [];
  let from = 0;
  for (const match of found) {
    const command = match[2] ?? '';
    const start = match.index + (match[1] ?? '').length;
    if (afterMethod.test(node.data.slice(0, start))) continue;
    parts.push(document.createTextNode(node.data.slice(from, start)), commandButton(command, command));
    from = start + command.length;
  }
  parts.push(document.createTextNode(node.data.slice(from)));
  node.replaceWith(...parts);
}

/**
 * @param {string} command — what it gives for the prompt box
 * @param {string} [shown] - its words, for one in the answer's words; one of code holds the code
 * @returns {HTMLButtonElement}
 */
function commandButton(command, shown) {
  const label = `Put ${command} into the prompt box`;
  return h('button', { className: 'command-mention', ...(shown === undefined ? {} : { text: shown }), title: label, attrs: { type: 'button', 'aria-label': label, 'data-command': command } });
}
