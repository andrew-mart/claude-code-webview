// @ts-check
// The service worker: the page opens even when the viewer is not reachable — the computer is off, a proxy in front of
// it answers with an error, there is no network. The page itself keeps the sessions to read (offline-store.js); here
// the page's own files are kept:
//   the page        — from the network, the copy saved last time when the network fails or the viewer is not there;
//   /b/<build>/...  — the page's files, never changing under one build: from the copy once saved;
//   images, whole entries of a transcript, uploaded files — never changing either: kept as they are fetched.
// Requests to the viewer's API go to the network as they are: the page tells offline from their failures. So does any
// other page opened — a download, VS Code in a tab of its own.

if (!(self instanceof ServiceWorkerGlobalScope)) throw new Error('sw.js runs as a service worker only');
const worker = self;

const pageCache = 'viewer-page';
const filesCache = 'viewer-files';
const dataCache = 'viewer-data';
/** A page file's address starts with its build: /b/<build>/app.js. */
const buildPrefix = /^\/b\/[0-9a-f]+\//;
/** Where the viewer serves the page. */
const pagePaths = new Set(['/', '/index.html']);
/**
 * The page waits this long for the viewer before it opens the saved copy — over a slow link it would show nothing all
 * that while. The copy opens with its own build's files, kept with it.
 */
const pageTimeoutMs = 3000;
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
  if (request.mode === 'navigate') {
    // only the page itself: a download answered here, Safari on iOS saved as a page — README.md as README.md.html; VS
    // Code's page, opened in a tab of its own, was kept as the page's copy
    if (pagePaths.has(url.pathname)) event.respondWith(openPage(request));
  } else if (url.pathname.startsWith('/b/')) event.respondWith(buildFile(request, url));
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
    const before = await cache.match('/');
    await cache.put('/', new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    await dropOtherBuilds(buildOf(html), before === undefined ? undefined : buildOf(await before.text()));
    return response;
  }
  // A proxy in front of the viewer answers for it while it is off (502, 503, 530…): the saved copy instead.
  if (response.status >= 500) return (await saved()) ?? response;
  return response;
}

/**
 * Only the files of the page's current build are kept, and of the build before it until the next update: the page of
 * a new build takes from those its files that have not changed (buildFile). Older builds' are not asked for again.
 * @param {string | undefined} build — the page's now
 * @param {string | undefined} before — the page's saved before it
 */
async function dropOtherBuilds(build, before) {
  if (build === undefined) return;
  const kept = [build, ...(before === undefined ? [] : [before])].map((one) => `/b/${one}/`);
  const cache = await caches.open(filesCache);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (!kept.some((prefix) => path.startsWith(prefix))) await cache.delete(request);
  }
}

/**
 * The build a page names in its files' paths: /b/<build>/.
 * @param {string} html
 * @returns {string | undefined}
 */
function buildOf(html) {
  return /\/b\/([0-9a-f]+)\//.exec(html)?.[1];
}

/**
 * A file of the page's build, kept for next time: the copy kept; else — the viewer updated, the file's address new — the
 * same file kept from the build before, if the viewer says it has not changed: asked by its tag, the answer is empty,
 * where a phone over a slow link would load the page's every file anew after every update; else the network's.
 * @param {Request} request
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function buildFile(request, url) {
  const cache = await caches.open(filesCache);
  const kept = await cache.match(request);
  if (kept !== undefined) return kept;
  const before = await keptFromBuildBefore(cache, url);
  const tag = before === undefined ? null : before.headers.get('ETag');
  if (before === undefined || tag === null) return fetchedAndKept(cache, request);
  const response = await fetch(url.href, { headers: { 'If-None-Match': tag } });
  if (response.status !== 304) {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }
  // a response of its own: the kept one's address would be the module's, its imports read from the build before
  const headers = new Headers(before.headers);
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  const same = new Response(await before.blob(), { headers });
  await cache.put(request, same.clone());
  return same;
}

/**
 * The same file of another build, kept.
 * @param {Cache} cache
 * @param {URL} url
 * @returns {Promise<Response | undefined>}
 */
async function keptFromBuildBefore(cache, url) {
  const file = url.pathname.replace(buildPrefix, '/');
  for (const key of await cache.keys()) {
    const other = new URL(key.url);
    if (other.pathname !== url.pathname && other.pathname.replace(buildPrefix, '/') === file && other.search === url.search) return cache.match(key);
  }
  return undefined;
}

/**
 * @param {Cache} cache
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function fetchedAndKept(cache, request) {
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
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
