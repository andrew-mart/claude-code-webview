// @ts-check
// What the page keeps to read with the viewer out of reach: the session list and copies of sessions' feeds, in the
// browser's IndexedDB. Without IndexedDB (a private window) nothing is kept and nothing is found.

/**
 * @typedef {{ entries: unknown[], earlier: number, lastActivity: number | undefined, savedAt: number }} SavedFeed
 *   entries — as the server sent them; earlier — how many came before them; lastActivity — the last prompt or answer
 * @typedef {{ lastActivity: number | undefined, savedAt: number }} SavedMark — that a session's feed is kept, and how fresh
 * @typedef {{ sessions: unknown, savedAt: number }} SavedList — the session list as the server sent it
 * @typedef {{
 *   readList: () => Promise<SavedList | undefined>,
 *   saveList: (sessions: unknown) => Promise<void>,
 *   readFeed: (sessionId: string) => Promise<SavedFeed | undefined>,
 *   saveFeed: (sessionId: string, feed: SavedFeed) => Promise<void>,
 *   marks: () => Promise<Map<string, SavedMark>>,
 * }} OfflineStore
 */

const databaseName = 'claude-code-webview';
/** Feeds kept at most: the ones saved longest ago go first. */
const keptFeeds = 24;

/** @returns {OfflineStore} */
export function openOfflineStore() {
  const database = openDatabase().catch(() => undefined);

  /**
   * @template T
   * @param {readonly string[]} stores
   * @param {'readonly' | 'readwrite'} mode
   * @param {(transaction: IDBTransaction) => Promise<T>} work
   * @param {T} otherwise — what there is without IndexedDB
   * @returns {Promise<T>}
   */
  const using = async (stores, mode, work, otherwise) => {
    const db = await database;
    if (db === undefined) return otherwise;
    try {
      return await work(db.transaction(stores, mode));
    } catch {
      return otherwise; // the browser refused (storage full, cleared meanwhile): the page goes on without the copy
    }
  };

  return {
    readList: () =>
      using(['list'], 'readonly', async (transaction) => {
        const value = await result(transaction.objectStore('list').get('sessions'));
        return isSavedList(value) ? value : undefined;
      }, undefined),
    saveList: (sessions) =>
      using(['list'], 'readwrite', async (transaction) => {
        await result(transaction.objectStore('list').put({ sessions, savedAt: Date.now() }, 'sessions'));
      }, undefined),
    readFeed: (sessionId) =>
      using(['feeds'], 'readonly', async (transaction) => {
        const value = await result(transaction.objectStore('feeds').get(sessionId));
        return isSavedFeed(value) ? value : undefined;
      }, undefined),
    saveFeed: (sessionId, feed) =>
      using(['feeds', 'marks'], 'readwrite', async (transaction) => {
        const feeds = transaction.objectStore('feeds');
        const marks = transaction.objectStore('marks');
        await result(feeds.put(feed, sessionId));
        await result(marks.put({ lastActivity: feed.lastActivity, savedAt: feed.savedAt }, sessionId));
        const kept = await readMarks(marks);
        const oldest = [...kept].sort(([, a], [, b]) => b.savedAt - a.savedAt).slice(keptFeeds);
        for (const [id] of oldest) {
          await result(feeds.delete(id));
          await result(marks.delete(id));
        }
      }, undefined),
    marks: () => using(['marks'], 'readonly', (transaction) => readMarks(transaction.objectStore('marks')), new Map()),
  };
}

/** @returns {Promise<IDBDatabase>} */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of ['list', 'feeds', 'marks']) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${databaseName} did not open`));
  });
}

/**
 * @param {IDBObjectStore} store
 * @returns {Promise<Map<string, SavedMark>>}
 */
async function readMarks(store) {
  const [keys, values] = await Promise.all([result(store.getAllKeys()), result(store.getAll())]);
  return new Map(keys.flatMap((key, index) => (typeof key === 'string' && isSavedMark(values[index]) ? [[key, values[index]]] : [])));
}

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('An IndexedDB request failed'));
  });
}

/**
 * @param {unknown} value
 * @returns {value is SavedList}
 */
function isSavedList(value) {
  return typeof value === 'object' && value !== null && 'savedAt' in value && typeof value.savedAt === 'number' && 'sessions' in value;
}

/**
 * @param {unknown} value
 * @returns {value is SavedFeed}
 */
function isSavedFeed(value) {
  return isSavedMark(value) && 'entries' in value && Array.isArray(value.entries) && 'earlier' in value && typeof value.earlier === 'number';
}

/**
 * @param {unknown} value
 * @returns {value is SavedMark}
 */
function isSavedMark(value) {
  return typeof value === 'object' && value !== null && 'savedAt' in value && typeof value.savedAt === 'number' && 'lastActivity' in value && (value.lastActivity === undefined || typeof value.lastActivity === 'number');
}
