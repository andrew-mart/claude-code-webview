// @ts-check
// Libraries that come as one script setting a global of the page — mermaid, docx-preview — loaded the first time they
// are needed.
import { h } from './dom.js';

/**
 * The library, loaded once for the page by a <script> tag; a load that failed is tried again the next time.
 * @param {string} name — the global it sets
 * @param {string} file — its file under vendor/ (server/app.js)
 * @returns {Promise<unknown>}
 */
export function loadLibrary(name, file) {
  const loaded = Reflect.get(window, name);
  if (loaded !== undefined) return Promise.resolve(loaded);
  const id = `library-${name}`;
  const known = document.getElementById(id);
  const script = known instanceof HTMLScriptElement ? known : h('script', { attrs: { id, src: new URL(`../vendor/${file}`, import.meta.url).href } });
  if (script !== known) document.head.append(script);
  return new Promise((resolve, reject) => {
    script.addEventListener('load', () => resolve(Reflect.get(window, name)));
    script.addEventListener('error', () => {
      script.remove();
      reject(new Error(`${name} did not load`));
    });
  });
}
