// @ts-check
// Polls of replies the viewer tags (ETag): each asked with the tag of its last reply, so an unchanged one comes back as
// 304 with no body. A browser asks so on its own from its cache — but Safari does not for a page's fetch, and loaded the
// whole reply every few seconds. A tag sent by the page also takes the browser's cache out of the way: the 304 reaches
// the page as it is.

/**
 * @param {(url: string, init: RequestInit) => Promise<Response>} fetchReply
 * @returns {(url: string) => Promise<unknown>} — a poll of an address: its reply's JSON, the last one again when it has
 *   not changed; undefined — no answer, a failed one or not JSON
 */
export function revalidatedPolls(fetchReply) {
  /** @type {Map<string, { tag: string, json: unknown }>} */
  const last = new Map();
  return async (url) => {
    const known = last.get(url);
    const response = await fetchReply(url, known === undefined ? {} : { headers: { 'If-None-Match': known.tag } }).catch(() => undefined);
    if (response?.status === 304 && known !== undefined) return known.json;
    if (response === undefined || !response.ok) return undefined;
    const json = await response.json().catch(() => undefined);
    const tag = response.headers.get('x-viewer-tag');
    if (json !== undefined && tag !== null) last.set(url, { tag, json });
    return json;
  };
}
