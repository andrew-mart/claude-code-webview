// @ts-check
// What of a Word document the panel keeps. docx-preview builds the document's styles and links from the file as they
// are: a font name such as x;}body{…}.z{ leaves its rule, and a document's styles could hide the viewer's page,
// probe it, or fetch from a server; a link's address could be a script. The panel draws the document in its own page —
// beside the box that sends prompts to Claude — so it keeps only rules that start at an element of the document, only
// addresses inside it, and links to places in it, to the web and to mail.

/** A class of an element of the document: docx, docx-wrapper, docx_heading1, docx-num-1-0. */
const docxClass = /\.docx(?:[-_][\w-]*)?(?![\w-])/;

/** Functions that take an address as a string — and so from a var() too. */
const stringUrlFunctions = /(?:image-set|image|cross-fade|src)\(/i;

/** Where a kept link may go. */
const linkProtocols = new Set(['http:', 'https:', 'mailto:']);

/**
 * Whether a rule of the document's styles stays: each selector of its list starts at an element of the document, from
 * where it goes down to the document's parts and on to their next siblings, never up to the viewer's page.
 * @param {string} selector — one, or a list with commas
 * @returns {boolean}
 */
export function keepsDocxSelector(selector) {
  return splitTopLevel(selector, (char) => char === ',').every((one) => {
    const first = splitTopLevel(one.trim(), (char) => /[\s>~+]/.test(char))[0] ?? '';
    return docxClass.test(withoutBrackets(first));
  });
}

/**
 * Whether a property's value names only addresses inside the document: its pictures and fonts come as data: and blob:
 * addresses; any other would tell a server the document is open. A variable inside a function that takes an address
 * as a string is an unknown address.
 * @param {string} value
 * @returns {boolean}
 */
export function localUrlsOnly(value) {
  if (stringUrlFunctions.test(value) && /var\(/i.test(value)) return false;
  return referencesOf(value).every((reference) => /^\s*(?:data|blob):/i.test(reference));
}

/**
 * Whether a link of the document keeps its address: a place in the document — how Word marks its table of
 * contents — a page on the web, a mail. The scheme is read as the browser reads it: an address that looks like
 * https: but starts with an invisible sign is, to the browser, a path on the viewer's own page.
 * @param {string | undefined} href — the attribute as it is
 * @returns {boolean}
 */
export function keepsDocxLink(href) {
  if (href === undefined) return false;
  if (href.startsWith('#')) return true;
  return URL.canParse(href) && linkProtocols.has(new URL(href).protocol);
}

/**
 * The text cut at each sign `cut` of its top level: outside (), [] and quotes.
 * @param {string} text
 * @param {(char: string) => boolean} cut
 * @returns {string[]}
 */
function splitTopLevel(text, cut) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let quote = '';
  let from = 0;
  [...text].forEach((char, index) => {
    if (quote !== '') {
      if (char === quote) quote = '';
      return;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (depth === 0 && cut(char)) {
      parts.push(text.slice(from, index));
      from = index + 1;
    }
  });
  parts.push(text.slice(from));
  return parts;
}

/**
 * The text without what is inside () and []: a class in :not(…) or in an attribute is no element of the document.
 * @param {string} text
 */
function withoutBrackets(text) {
  return text.replace(/\([^]*?\)|\[[^]*?\]/g, '');
}

/**
 * The addresses in a value: url(…) arguments, and strings in functions that take an address as a string.
 * @param {string} value
 * @returns {string[]}
 */
function referencesOf(value) {
  const urls = [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((match) => match[2] ?? '');
  const strings = stringUrlFunctions.test(value) ? [...value.matchAll(/(['"])(.*?)\1/g)].map((match) => match[2] ?? '') : [];
  return [...urls, ...strings];
}
