// @ts-check
// A PDF drawn in the right-hand panel by pdf.js (vendor/pdfjs): its pages as pictures fitted to the panel's width,
// the text over them invisible, to select and copy. The pages get their sizes at once — the scrollbar is right from
// the start — and are drawn as they come near and let go once far away: a long document would otherwise hold a
// canvas of megabytes for every page.
import { folderAddress } from '../model/doc-links.js';
import { isRecord } from '../model/narrow.js';
import { h } from './dom.js';

/**
 * The part of pdf.js the panel uses.
 * @typedef {{ width: number, height: number }} Viewport
 * @typedef {{ promise: Promise<unknown>, cancel: () => void }} RenderTask
 * @typedef {{ getViewport: (options: { scale: number }) => Viewport, render: (options: { canvasContext: CanvasRenderingContext2D, viewport: Viewport }) => RenderTask, streamTextContent: () => unknown }} PdfPage
 * @typedef {{ numPages: number, getPage: (number: number) => Promise<PdfPage> }} PdfDocument
 * @typedef {{ promise: Promise<PdfDocument>, destroy: () => Promise<void> }} LoadingTask
 * @typedef {{ render: () => Promise<unknown>, cancel: () => void }} TextLayer
 * @typedef {{ getDocument: (options: Record<string, unknown>) => LoadingTask, GlobalWorkerOptions: { workerSrc: string }, TextLayer: new (options: { textContentSource: unknown, container: HTMLElement, viewport: Viewport }) => TextLayer }} Pdfjs
 * @typedef {{ element: HTMLElement, page: PdfPage, viewport: Viewport, task: RenderTask | undefined, text: TextLayer | undefined }} PageSlot
 */

const vendor = new URL('../vendor/pdfjs/', import.meta.url);
/** Room around the pages, px: their width is the panel's less this on each side. */
const margin = 16;

/**
 * @param {string} path — the PDF's absolute path
 * @param {HTMLElement} scroller — the panel's body, which scrolls the pages
 * @returns {{ element: HTMLElement, dispose: () => void }} — dispose: lets go of the document when the panel shows
 *   something else
 */
export function renderPdf(path, scroller) {
  const element = h('div', { className: 'doc-pdf' }, [h('div', { className: 'panel-message', text: 'Loading…' })]);
  /** @type {LoadingTask | undefined} */
  let loading;
  /** @type {IntersectionObserver | undefined} */
  let watcher;
  let disposed = false;
  const say = (/** @type {string} */ message) => element.replaceChildren(h('div', { className: 'panel-message', text: message }));

  const start = async () => {
    const pdfjs = await import(new URL('pdf.mjs', vendor).href);
    if (!isPdfjs(pdfjs)) throw new Error('pdf.js is not what the panel knows');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', vendor).href;
    loading = pdfjs.getDocument({
      url: folderAddress(path, 'off'),
      cMapUrl: new URL('cmaps/', vendor).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', vendor).href,
      wasmUrl: new URL('wasm/', vendor).href,
      iccUrl: new URL('iccs/', vendor).href,
      // fonts are not compiled into code: a PDF is data from anywhere
      isEvalSupported: false,
    });
    const doc = await loading.promise;
    if (disposed) return;
    const slots = await pageSlots(doc, Math.max(240, scroller.clientWidth - 2 * margin));
    if (disposed) return;
    element.replaceChildren(h('div', { className: 'pdf-pages' }, slots.map((slot) => slot.element)));
    // a screen's height of pages ahead is drawn before it comes into view, and kept until that far behind
    watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slot = slots.find((one) => one.element === entry.target);
          if (slot === undefined) continue;
          if (entry.isIntersecting) draw(pdfjs, slot);
          else release(slot);
        }
      },
      { root: scroller, rootMargin: '100% 0px' },
    );
    for (const slot of slots) watcher.observe(slot.element);
  };

  void start().catch((/** @type {unknown} */ error) => {
    if (disposed) return;
    const locked = isRecord(error) && error.name === 'PasswordException';
    say(locked ? 'The PDF is locked with a password and is not shown.' : `The PDF is not shown: ${error instanceof Error ? error.message : String(error)}`);
  });

  return {
    element,
    dispose() {
      disposed = true;
      watcher?.disconnect();
      void loading?.destroy();
    },
  };
}

/**
 * A place for each page, at its size: the first page's width fitted to the panel sets the scale for all.
 * @param {PdfDocument} doc
 * @param {number} width — px
 * @returns {Promise<PageSlot[]>}
 */
async function pageSlots(doc, width) {
  const first = await doc.getPage(1);
  const scale = width / first.getViewport({ scale: 1 }).width;
  /** @type {PageSlot[]} */
  const slots = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = number === 1 ? first : await doc.getPage(number);
    const viewport = page.getViewport({ scale });
    const element = h('div', { className: 'pdf-page', attrs: { 'data-page': String(number) } });
    element.style.width = `${Math.round(viewport.width)}px`;
    element.style.height = `${Math.round(viewport.height)}px`;
    // the text layer measures itself and its lines by it (style.css, .pdf-page)
    element.style.setProperty('--scale-factor', String(scale));
    slots.push({ element, page, viewport, task: undefined, text: undefined });
  }
  return slots;
}

/**
 * The page as a picture at the screen's density, and its text over it, invisible, to select and copy.
 * @param {Pdfjs} pdfjs
 * @param {PageSlot} slot
 */
function draw(pdfjs, slot) {
  if (slot.task !== undefined) return;
  const ratio = window.devicePixelRatio;
  const canvas = h('canvas', { attrs: { width: String(Math.round(slot.viewport.width * ratio)), height: String(Math.round(slot.viewport.height * ratio)) } });
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.scale(ratio, ratio);
  const layer = h('div', { className: 'textLayer' });
  slot.element.replaceChildren(canvas, layer);
  slot.task = slot.page.render({ canvasContext: context, viewport: slot.viewport });
  slot.text = new pdfjs.TextLayer({ textContentSource: slot.page.streamTextContent(), container: layer, viewport: slot.viewport });
  void Promise.all([slot.task.promise, slot.text.render()]).catch((/** @type {unknown} */ error) => {
    // a page let go while it was being drawn is no failure
    if (isRecord(error) && (error.name === 'RenderingCancelledException' || error.name === 'AbortException')) return;
    slot.element.replaceChildren(h('div', { className: 'panel-message', text: `This page is not drawn: ${error instanceof Error ? error.message : String(error)}` }));
  });
}

/**
 * The picture and text of a page far out of view go; its place, at its size, stays — nothing on screen moves.
 * @param {PageSlot} slot
 */
function release(slot) {
  if (slot.task === undefined) return;
  slot.task.cancel();
  slot.text?.cancel();
  slot.task = undefined;
  slot.text = undefined;
  slot.element.replaceChildren();
}

/**
 * @param {unknown} value
 * @returns {value is Pdfjs}
 */
function isPdfjs(value) {
  // GlobalWorkerOptions is a class: its settings are static fields
  return isRecord(value) && typeof value.getDocument === 'function' && typeof value.TextLayer === 'function' && typeof value.GlobalWorkerOptions === 'function';
}
