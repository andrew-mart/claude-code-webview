// @ts-check
// The service worker: the page opens even when the viewer is not reachable — the computer is off, a proxy in front of
// it answers with an error, there is no network. The page itself keeps the sessions to read (offline-store.js); here
// the page's own files are kept:
//   the page        — from the network, the copy saved last time when the network fails or the viewer is not there;
//   /b/<build>/...  — the page's files, never changing under one build: from the copy once saved;
//   images, whole entries of a transcript, uploaded files — never changing either: kept as they are fetched.
// Requests to the viewer's API go to the network as they are: the page tells offline from their failures.

if (!(self instanceof ServiceWorkerGlobalScope)) throw new Error('sw.js runs as a service worker only');
const worker = self;

const pageCache = 'viewer-page';
const filesCache = 'viewer-files';
const dataCache = 'viewer-data';
/** The page waits this long for the viewer before it opens the saved copy. */
const pageTimeoutMs = 6000;
/** Images and entries kept at most; the ones kept longest go first. */
const dataLimit = 400;

worker.oninstall = () => {
  void worker.skipWaiting();
};

worker.onactivate = (/** @type {ExtendableEvent} */ event) => {
  event.waitUntil(worker.clients.claim());
};

worker.onfetch = (/** @type {FetchEvent} */ event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (request.mode === 'navigate') event.respondWith(openPage(request));
  else if (url.pathname.startsWith('/b/')) event.respondWith(keptOrFetched(filesCache, request, undefined));
  else if (url.pathname === '/api/image' || url.pathname === '/api/entry' || url.pathname.startsWith('/api/upload/')) event.respondWith(keptOrFetched(dataCache, request, dataLimit));
};

/**
 * The page from the viewer; when it does not answer, the copy saved the last time it did.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function openPage(request) {
  const response = await Promise.race([fetch(request).catch(() => undefined), delay(pageTimeoutMs)]);
  const saved = () => caches.open(pageCache).then((cache) => cache.match('/'));
  if (response === undefined) return (await saved()) ?? new Response('The viewer is not reachable, and no copy of the page is saved yet.', { status: 503 });
  if (response.ok && (response.headers.get('Content-Type') ?? '').startsWith('text/html')) {
    const html = await response.clone().text();
    const cache = await caches.open(pageCache);
    await cache.put('/', new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    await dropOtherBuilds(html);
    return response;
  }
  // A proxy in front of the viewer answers for it while it is off (502, 503, 530…): the saved copy instead.
  if (response.status >= 500) return (await saved()) ?? response;
  return response;
}

/**
 * Only the files of the page's current build are kept: the earlier builds' are not asked for again.
 * @param {string} html — the page, naming its build in its file paths: /b/<build>/
 */
async function dropOtherBuilds(html) {
  const build = /\/b\/([0-9a-f]+)\//.exec(html)?.[1];
  if (build === undefined) return;
  const cache = await caches.open(filesCache);
  for (const request of await cache.keys()) {
    if (!new URL(request.url).pathname.startsWith(`/b/${build}/`)) await cache.delete(request);
  }
}

/**
 * A response that never changes: the kept copy, or the network's, kept for next time.
 * @param {string} name — the cache
 * @param {Request} request
 * @param {number | undefined} limit — how many responses the cache keeps at most
 * @returns {Promise<Response>}
 */
async function keptOrFetched(name, request, limit) {
  const cache = await caches.open(name);
  const kept = await cache.match(request);
  if (kept !== undefined) return kept;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (limit !== undefined) await trim(cache, limit);
  }
  return response;
}

/**
 * @param {Cache} cache
 * @param {number} limit
 */
async function trim(cache, limit) {
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(keys.length - limit, 0))) await cache.delete(request);
}

/**
 * @param {number} ms
 * @returns {Promise<undefined>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
}
