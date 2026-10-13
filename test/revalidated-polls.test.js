import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revalidatedPolls } from '../public/view/revalidated-polls.js';

/**
 * A viewer that gives these replies in turn, and what each poll was asked with.
 * @param {(Response | Error)[]} replies
 */
function viewerGiving(replies) {
  /** @type {(string | null)[]} */
  const askedWith = [];
  const poll = revalidatedPolls(async (_url, init) => {
    askedWith.push(new Headers(init.headers).get('if-none-match'));
    const reply = replies.shift();
    if (reply === undefined || reply instanceof Error) throw reply ?? new Error('no more replies');
    return reply;
  });
  return { poll, askedWith };
}
// the tag in the viewer's own header: Cloudflare does not pass ETag on to Safari
const tagged = (/** @type {string} */ json, /** @type {string} */ tag) => new Response(json, { status: 200, headers: { 'X-Viewer-Tag': tag } });
const unchanged = () => new Response(null, { status: 304 });

// A poll is asked with the tag of the last reply — Safari does not ask so itself for a page's fetch, and loaded the whole
// reply every few seconds — and an unchanged reply, 304 with no body, gives the last one again; a changed one takes its
// place
test('revalidatedPolls_Should_AskWithLastTag_And_GiveLastReplyAgain_When_Unchanged', async () => {
  const { poll, askedWith } = viewerGiving([tagged('{"tabs":1}', 'W/"a"'), unchanged(), tagged('{"tabs":2}', 'W/"b"'), unchanged()]);

  const got = [await poll('/api/herdr'), await poll('/api/herdr'), await poll('/api/herdr'), await poll('/api/herdr')];

  assert.deepEqual({ got, askedWith }, { got: [{ tabs: 1 }, { tabs: 1 }, { tabs: 2 }, { tabs: 2 }], askedWith: [null, 'W/"a"', 'W/"a"', 'W/"b"'] });
});

// Each address is asked with the tag of its own last reply; a poll with no answer gives nothing
test('revalidatedPolls_Should_KeepTagOfEachAddress_And_GiveNothing_When_NoAnswer', async () => {
  const { poll, askedWith } = viewerGiving([tagged('{"herdr":1}', 'W/"h"'), tagged('{"workspaces":1}', 'W/"w"'), new Error('offline'), unchanged()]);

  const got = [await poll('/api/herdr'), await poll('/api/workspaces'), await poll('/api/herdr'), await poll('/api/workspaces')];

  assert.deepEqual({ got, askedWith }, { got: [{ herdr: 1 }, { workspaces: 1 }, undefined, { workspaces: 1 }], askedWith: [null, null, 'W/"h"', 'W/"w"'] });
});
