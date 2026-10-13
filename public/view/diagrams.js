// @ts-check
// Mermaid diagrams in a document drawn as pictures. The library (vendor/mermaid.js, large) loads the first time a
// diagram is met. A diagram goes in as an SVG picture, not as markup: a picture runs no script, whatever the diagram's
// text holds — the page beside it can send prompts to Claude. A diagram the library cannot read keeps its text, the
// reason under it.
import { h } from './dom.js';
import { isRecord } from '../model/narrow.js';

/**
 * @typedef {{ initialize: (config: Record<string, unknown>) => void, render: (id: string, text: string) => Promise<unknown> }} Mermaid
 */

const libraryId = 'mermaid-library';

/**
 * Draws the document's mermaid blocks, one after another: the library draws in a scratch node of the page, and two at
 * once would get in each other's way.
 * @param {HTMLElement} doc
 */
export async function drawDiagrams(doc) {
  const sources = [...doc.querySelectorAll('pre > code.language-mermaid')];
  if (sources.length === 0) return;
  const frames = sources.map((code) => ({ code, frame: code.closest('.code-frame') ?? code }));
  const mermaid = await loadMermaid().catch((/** @type {unknown} */ error) => error);
  if (!isMermaid(mermaid)) {
    for (const { frame } of frames) failed(frame, mermaid);
    return;
  }
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: isDark() ? 'dark' : 'default' });
  for (const { code, frame } of frames) {
    try {
      const drawn = await mermaid.render(`diagram-${crypto.randomUUID()}`, code.textContent ?? '');
      if (!isRecord(drawn) || typeof drawn.svg !== 'string') throw new Error('mermaid gave no picture');
      const picture = h('img', { attrs: { alt: 'Diagram', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNaturalSize(drawn.svg))}` } });
      frame.replaceWith(h('div', { className: 'diagram' }, [picture]));
    } catch (error) {
      failed(frame, error);
    }
  }
}

/**
 * The library, loaded once for the page: a load that failed is tried again the next time.
 * @returns {Promise<unknown>}
 */
function loadMermaid() {
  const loaded = Reflect.get(window, 'mermaid');
  if (loaded !== undefined) return Promise.resolve(loaded);
  const known = document.getElementById(libraryId);
  const script = known instanceof HTMLScriptElement ? known : h('script', { attrs: { id: libraryId, src: new URL('../vendor/mermaid.js', import.meta.url).href } });
  if (script !== known) document.head.append(script);
  return new Promise((resolve, reject) => {
    script.addEventListener('load', () => resolve(Reflect.get(window, 'mermaid')));
    script.addEventListener('error', () => {
      script.remove();
      reject(new Error('the diagram library did not load'));
    });
  });
}

/**
 * @param {unknown} value
 * @returns {value is Mermaid}
 */
function isMermaid(value) {
  return isRecord(value) && typeof value.initialize === 'function' && typeof value.render === 'function';
}

/**
 * The block stays as text, with why it is not drawn under it.
 * @param {Element} frame
 * @param {unknown} error
 */
function failed(frame, error) {
  frame.after(h('p', { className: 'diagram-error', text: `The diagram is not drawn: ${error instanceof Error ? error.message : String(error)}` }));
}

/** The page's theme: the one chosen, else the system's. */
function isDark() {
  const theme = document.documentElement.dataset.theme;
  return theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/**
 * The SVG at its own size, from its viewBox: mermaid sets width="100%", and a picture without a size of its own would
 * stretch to the column; at its own size its words read, a wide one scrolling sideways. DOMParser runs nothing.
 * @param {string} svg
 */
function withNaturalSize(svg) {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const box = root instanceof SVGSVGElement ? root.viewBox.baseVal : undefined;
  if (box !== undefined && box.width > 0 && box.height > 0) {
    root.setAttribute('width', String(Math.ceil(box.width)));
    root.setAttribute('height', String(Math.ceil(box.height)));
  }
  return new XMLSerializer().serializeToString(root);
}
