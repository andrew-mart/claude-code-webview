import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptTrust, trustDialogOf } from '../server/trust.js';

/** Claude Code 2's dialog, as a terminal shows it, the cursor on the answer given. */
const dialog = (/** @type {'no' | 'yes'} */ cursor) =>
  [
    ' Accessing workspace:',
    '',
    ' /home/ann',
    '',
    ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
    " Claude Code'll be able to read, edit, and execute files here.",
    '',
    ' Security guide',
    '',
    cursor === 'no' ? ' ❯ No, exit' : '   No, exit',
    cursor === 'yes' ? ' ❯ Yes, I trust this folder' : '   Yes, I trust this folder',
    '',
    ' Enter to confirm · Esc to cancel',
  ].join('\n');

// The question whether to trust the folder is told by its answers, and where the cursor stands — on no, as it opens, or
// on yes; older Claude Code asked it with "Yes, proceed"; Claude Code at work asks nothing
test('trustDialogOf_Should_FindQuestionAndWhereCursorStands', () => {
  assert.deepEqual(
    [dialog('no'), dialog('yes'), ' Do you trust the files in this folder?\n\n ❯ 1. Yes, proceed\n   2. No, exit\n', ' ✻ Welcome to Claude Code!\n\n > \n   ? for shortcuts'].map(trustDialogOf),
    [{ cursor: 'no' }, { cursor: 'yes' }, { cursor: 'yes' }, undefined],
  );
});

/**
 * A pane whose screen goes through these, one per look, the last staying; the keys sent to it are kept.
 * @param {readonly string[]} screens
 */
function paneShowing(screens) {
  /** @type {string[]} */
  const keys = [];
  let look = 0;
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  const run = async (args) => {
    if (args[1] === 'send-keys') {
      keys.push(args.slice(3).join(' '));
      return { ok: true, json: undefined, text: '' };
    }
    const screen = screens[Math.min(look, screens.length - 1)] ?? '';
    look++;
    return { ok: true, json: undefined, text: screen };
  };
  return { run, keys };
}

// Claude Code started by the viewer in a folder the user chose gets the answer yes — the cursor taken to it first —
// and Claude Code that asks nothing gets no keys at all
test('acceptTrust_Should_AnswerYes_When_ClaudeAsksToTrustFolder', async () => {
  const asked = paneShowing(['ann@box:~$ claude-god', dialog('no'), dialog('yes')]);
  const trusted = paneShowing(['ann@box:~$ claude-god', ' ✻ Welcome to Claude Code!\n\n > \n   ? for shortcuts']);
  const pace = { looks: 5, stepMs: 1 };

  const outcomes = [await acceptTrust(asked.run, 'w1:p2', pace), await acceptTrust(trusted.run, 'w1:p3', pace)];

  assert.deepEqual({ outcomes, asked: asked.keys, trusted: trusted.keys }, { outcomes: ['trusted', 'not-asked'], asked: ['down', 'enter'], trusted: [] });
});
