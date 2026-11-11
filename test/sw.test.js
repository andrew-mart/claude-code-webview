import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://viewer.example';

/**
 * @typedef {{ method: string, url: string, mode: string }} AskedRequest
 * @typedef {{ request: AskedRequest, respondWith: (answer: Promise<Response>) => void, waitUntil: (work: Promise<unknown>) => void }} FetchEvent
 * @typedef {{ body: string, etag: string | undefined }} Kept
 */

/** What a service worker runs in, as much of it as sw.js asks for. */
class ServiceWorkerGlobalScope {
  location = new URL(`${origin}/sw.js`);
  /** @type {((event: FetchEvent) => void) | undefined} */
  onfetch = undefined;
}

/**
 * The browser's caches, as much of them as sw.js asks for: what each holds, by address.
 * @param {Record<string, Record<string, Kept>>} held — by cache name, by path
 */
function cachesHolding(held) {
  /** @type {Map<string, Map<string, Kept>>} */
  const stores = new Map(Object.entries(held).map(([name, files]) => [name, new Map(Object.entries(files).map(([path, kept]) => [`${origin}${path}`, kept]))]));
  /** @param {string | { url: string }} request */
  const addressOf = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  /** @param {string} name */
  const storeOf = (name) => {
    const there = stores.get(name);
    if (there !== undefined) return there;
    /** @type {Map<string, Kept>} */
    const made = new Map();
    stores.set(name, made);
    return made;
  };
  return {
    caches: {
      /** @param {string} name */
      open: async (name) => {
        const store = storeOf(name);
        return {
          /** @param {string | { url: string }} request */
          match: async (request) => {
            const kept = store.get(addressOf(request));
            return kept === undefined ? undefined : new Response(kept.body, { headers: kept.etag === undefined ? {} : { ETag: kept.etag } });
          },
          /** @param {string | { url: string }} request @param {Response} response */
          put: async (request, response) => {
            store.set(addressOf(request), { body: await response.text(), etag: response.headers.get('ETag') ?? undefined });
          },
          keys: async () => [...store.keys()].map((url) => ({ url })),
          /** @param {string | { url: string }} request */
          delete: async (request) => store.delete(addressOf(request)),
        };
      },
    },
    /** @param {string} name — what the cache holds, by path */
    held: (name) => [...storeOf(name).keys()].map((address) => new URL(address).pathname).sort(),
  };
}

/**
 * The page's service worker, running against a viewer that serves these files with their tags — answering "not
 * changed" to a request that names the tag a file still has — and the browser's caches holding what is given.
 * @param {{ files: Record<string, { body: string, etag: string, type?: string }>, held: Record<string, Record<string, Kept>> }} world
 */
function startWorker({ files, held }) {
  /** @type {string[]} */
  const asked = [];
  const kept = cachesHolding(held);
  const worker = new ServiceWorkerGlobalScope();
  vm.runInContext(
    source,
    vm.createContext({
      self: worker,
      ServiceWorkerGlobalScope,
      URL,
      Response,
      Headers,
      /** @param {string | { url: string }} input @param {{ headers?: Record<string, string> }} [init] */
      fetch: async (input, init) => {
        const path = new URL(typeof input === 'string' ? input : input.url, origin).pathname;
        const tag = init?.headers?.['If-None-Match'];
        asked.push(tag === undefined ? path : `${path} if not ${tag}`);
        const file = files[path];
        if (file === undefined) return new Response('Not found', { status: 404 });
        if (tag === file.etag) return new Response(null, { status: 304, headers: { ETag: file.etag } });
        return new Response(file.body, { headers: { ETag: file.etag, 'Content-Type': file.type ?? 'text/javascript' } });
      },
      caches: kept.caches,
      setTimeout: () => 0,
    }),
  );
  if (worker.onfetch === undefined) throw new Error('sw.js handles no requests');
  const onfetch = worker.onfetch;
  /**
   * The worker's answer to a request, if it gives one.
   * @param {string} path @param {string} mode
   * @returns {Promise<Response | undefined>}
   */
  const ask = (path, mode) =>
    new Promise((resolve, reject) => {
      let answered = false;
      onfetch({
        request: { method: 'GET', url: `${origin}${path}`, mode },
        respondWith: (answer) => {
          answered = true;
          answer.then(resolve, reject);
        },
        waitUntil: () => undefined,
      });
      if (!answered) resolve(undefined);
    });
  return { ask, asked, held: kept.held };
}

test('serviceWorker_Should_AnswerThePageItself_AndLeaveADownloadOrVsCodeOpenedAsAPageToTheNetwork', async () => {
  const addresses = ['/', '/index.html', '/api/file/download?path=%2Fhome%2Fana%2Fnotes.md', '/api/folder/download?path=%2Fhome%2Fana%2Fatlas', '/vscode/?folder=%2Fhome%2Fana%2Fatlas'];
  const answered = [];
  for (const address of addresses) {
    const { ask } = startWorker({ files: {}, held: {} });
    answered.push([address, (await ask(address, 'navigate')) !== undefined]);
  }

  assert.deepEqual(answered, [
    ['/', true],
    ['/index.html', true],
    ['/api/file/download?path=%2Fhome%2Fana%2Fnotes.md', false],
    ['/api/folder/download?path=%2Fhome%2Fana%2Fatlas', false],
    ['/vscode/?folder=%2Fhome%2Fana%2Fatlas', false],
  ]);
});

// After an update of the viewer the page's files have new addresses, most of them unchanged: one the build before kept
// is the kept one — the viewer only asked whether it changed, by its tag — and one that changed comes anew; each kept
// under its new address
test('serviceWorker_Should_TakeAFileOfANewBuildFromTheBuildBefore_WhenTheViewerSaysItHasNotChanged', async () => {
  const { ask, asked, held } = startWorker({
    files: {
      '/b/c0ffee/view/feed.js': { body: 'export const feed = 1;', etag: 'W/"22-100"' },
      '/b/c0ffee/view/list.js': { body: 'export const list = 2;', etag: 'W/"22-300"' },
    },
    held: {
      'viewer-files': {
        '/b/beef01/view/feed.js': { body: 'export const feed = 1;', etag: 'W/"22-100"' },
        '/b/beef01/view/list.js': { body: 'export const list = 1;', etag: 'W/"22-200"' },
      },
    },
  });

  const answers = await Promise.all(['/b/c0ffee/view/feed.js', '/b/c0ffee/view/list.js'].map((path) => ask(path, 'cors')));
  const bodies = await Promise.all(answers.map((answer) => answer?.text()));

  assert.deepEqual(
    { asked, bodies, held: held('viewer-files') },
    {
      asked: ['/b/c0ffee/view/feed.js if not W/"22-100"', '/b/c0ffee/view/list.js if not W/"22-200"'],
      bodies: ['export const feed = 1;', 'export const list = 2;'],
      held: ['/b/beef01/view/feed.js', '/b/beef01/view/list.js', '/b/c0ffee/view/feed.js', '/b/c0ffee/view/list.js'],
    },
  );
});

// The page of a new build keeps the files of the build it follows — the page asks for its own after it, the unchanged
// ones taken from those — and lets go of older builds' files
test('serviceWorker_Should_KeepTheBuildBefore_WhenThePageOfANewBuildOpens_LettingOlderOnesGo', async () => {
  const { ask, held } = startWorker({
    files: { '/': { body: '<script type="module" src="/b/c0ffee/app.js"></script>', etag: 'W/"60-500"', type: 'text/html; charset=utf-8' } },
    held: {
      'viewer-page': { '/': { body: '<script type="module" src="/b/beef01/app.js"></script>', etag: undefined } },
      'viewer-files': {
        '/b/beef01/app.js': { body: 'export {};', etag: 'W/"10-200"' },
        '/b/0dd0dd/app.js': { body: 'export {};', etag: 'W/"10-100"' },
      },
    },
  });

  await ask('/', 'navigate');

  assert.deepEqual(held('viewer-files'), ['/b/beef01/app.js']);
});
