// @ts-check
// What a session's feed tells — its details, its status, its prompts — passed on to what shows it now: the header and
// the outline. A session kept out of sight and shown again is shown by a new header and outline: they are told all of
// it again first, then what comes.

/**
 * @typedef {import('./session-view.js').SessionListener} SessionListener
 * @typedef {import('./session-view.js').SessionMeta} SessionMeta
 * @typedef {import('./session-view.js').SessionStatus} SessionStatus
 * @typedef {import('./session-view.js').Anchor} Anchor
 */

/**
 * @returns {{ listener: SessionListener, attach: (target: SessionListener) => void, detach: () => void }} — listener:
 *   the feed's; attach: what shows the session now, told all of it first; detach: none shows it
 */
export function createSessionRelay() {
  /** @type {SessionListener | undefined} */
  let target;
  /** @type {SessionMeta} */
  let meta = {};
  /** @type {SessionStatus} */
  let status = 'connecting';
  /** The prompts since the feed last started over. @type {Anchor[]} */
  let prompts = [];
  return {
    listener: {
      onMeta(next) {
        meta = next;
        target?.onMeta(next);
      },
      onStatus(next) {
        status = next;
        target?.onStatus(next);
      },
      onPrompt(prompt) {
        prompts.push(prompt);
        target?.onPrompt(prompt);
      },
      onReset() {
        prompts = [];
        target?.onReset();
      },
    },
    attach(next) {
      target = next;
      next.onReset();
      next.onMeta(meta);
      next.onStatus(status);
      for (const prompt of prompts) next.onPrompt(prompt);
    },
    detach() {
      target = undefined;
    },
  };
}
