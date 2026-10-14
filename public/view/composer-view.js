// @ts-check
// Prompt box under the feed: the prompt goes to the session terminal via herdr (server: /api/send, /api/interrupt).
// "/btw …" asks aside, as in the terminal (/api/btw): the answer shows above the box and never joins the feed. A choice
// Claude Code waits for — its AskUserQuestion dialog — shows above the box too, and is answered from there (/api/dialog).
import { btwMessage, composerState, outcomeMessage, parseBtwReply, parseLiveState, parseOutcome, parseStopOutcome, promptForBox, sideQuestionOf, stopMessage } from '../model/composer.js';
import { parseDialogReply } from '../model/dialog.js';
import { parseNewTab } from '../model/herdr.js';
import { answerBlocks } from '../model/side-answer.js';
import { createAttachmentPicker } from './attachment-picker.js';
import { createDialogCard } from './dialog-card.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/** How often to check whether the session is running and busy. */
const liveRefreshMs = 4000;
/** A box taller than this — about three lines — can be folded to it, px. */
const foldedHeightPx = 80;
/** After an answer to Claude Code's dialog the terminal redraws: the next question, or the box again. */
const redrawMs = 400;
/** How long the success notice stays visible. */
const noticeMs = 4000;

/** @type {import('../model/composer.js').ComposerView} */
const serverSilent = { shown: true, enabled: false, canInterrupt: false, canReopen: false, placeholder: 'Sending is unavailable', hint: 'The viewer server did not report whether the session is running.' };

/**
 * @param {string} sessionId
 * @param {{ focusBox: 'when-ready' | 'no', placeOf: () => { workspace: string, tab: string | undefined } | undefined, asides: import('./aside-store.js').AsideStore }} options —
 *   focusBox when-ready: the user opened the session, so the box takes the focus once the session can be written to; no:
 *   following the active session switched to it. placeOf: the herdr workspace and tab the session ran in, if known. asides:
 *   the side questions and answers of the page's sessions — one outlives the box it was asked in
 * @returns {{ element: HTMLElement, say: (message: string, tone: 'ok' | 'error') => void, fill: (text: string) => void, stop: () => boolean, sendQueue: () => void, dispose: () => void }} — stop: Claude stopped if it was working
 */
export function createComposer(sessionId, { focusBox, placeOf, asides }) {
  /** @type {import('../model/composer.js').Keyboard} */
  const keyboard = matchMedia('(pointer: coarse)').matches ? 'touch' : 'physical';
  const draftKey = `viewer.draft.${sessionId}`;
  const input = h('textarea', { className: 'composer-input', attrs: { rows: '1', 'aria-label': 'Prompt for Claude' } });
  input.value = readDraft(draftKey);
  const interrupt = h('button', { className: 'composer-stop', title: 'Stop — press Esc in the session terminal', attrs: { type: 'button', hidden: '', 'aria-label': 'Stop' } }, [icon('stop')]);
  const send = h('button', { className: 'composer-send', title: keyboard === 'touch' ? 'Send' : 'Send (Enter)', attrs: { type: 'submit', 'aria-label': 'Send' } }, [icon('send')]);
  const hint = h('div', { className: 'composer-hint' });
  // a session that is not running is opened again in herdr — where it ran — and the box comes to life when it starts
  const reopen = h('button', { className: 'composer-reopen', text: 'Open in herdr', title: 'A tab of the workspace it ran in, named as before; Claude Code resumes the session there', attrs: { type: 'button' } });
  const resumeWhere = h('span', { className: 'composer-resume-where' });
  // in the box's place while the session is not running: where it ran, and the button that opens it there again
  const resume = h('div', { className: 'composer-resume', attrs: { hidden: '' } }, [h('div', { className: 'composer-resume-text' }, [h('span', { className: 'composer-resume-state', text: 'Not running' }), resumeWhere]), reopen]);
  const status = h('div', { className: 'composer-status', attrs: { role: 'status' } });
  let enabled = false;
  let sending = false;
  /** The session's side question is being answered: the box waits. */
  let asking = false;
  /** Claude works: a prompt waits in Claude Code's queue, unless sent now. */
  let busy = false;
  // A phone's keyboard would cover the feed: there the box waits for a tap.
  let focusPending = focusBox === 'when-ready' && keyboard === 'physical';
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let noticeTimer;
  const attachments = createAttachmentPicker({ onChange: () => refreshButtons(), onError: (message) => say(message, 'error') });
  // a box taller than a few lines folds to them: a long text pasted in need not cover the conversation
  const fold = h('button', { className: 'icon-button composer-fold', attrs: { type: 'button', hidden: '' } });
  let folded = false;
  const form = h('form', { className: 'composer-box' }, [fold, attachments.list, attachments.button, input, h('div', { className: 'composer-actions' }, [interrupt, send])]);
  const aside = h('section', { className: 'side-answer', attrs: { hidden: '', 'aria-label': 'Side question', 'aria-live': 'polite' } });
  const closeAside = h('button', { className: 'icon-button side-answer-close', title: 'Close', attrs: { type: 'button', 'aria-label': 'Close' } }, [icon('cross')]);
  closeAside.addEventListener('click', () => asides.set(sessionId, undefined));
  const dialogCard = createDialogCard({
    answer: async (steps) => {
      const reply = parseDialogReply(await post('/api/dialog', { steps }));
      setTimeout(() => void refreshLive(), redrawMs);
      return reply;
    },
  });
  const element = h('div', { className: 'composer' }, [dialogCard.element, aside, resume, form, h('div', { className: 'composer-footer' }, [hint, status]), attachments.input]);

  const fit = () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
    showFold();
  };
  /** The fold button for a box taller than a few lines; a box that is not, unfolded. */
  const showFold = () => {
    const tall = input.scrollHeight > foldedHeightPx;
    if (!tall) folded = false;
    fold.hidden = !tall;
    form.classList.toggle('folded', folded);
    fold.title = folded ? 'Unfold the box' : 'Fold the box to a few lines, to read the conversation';
    fold.setAttribute('aria-label', fold.title);
    fold.replaceChildren(icon(folded ? 'unfold' : 'fold'));
  };
  const refreshButtons = () => {
    send.disabled = !enabled || sending || asking || (input.value.trim() === '' && attachments.images().length === 0);
    input.disabled = !enabled;
    attachments.button.disabled = !enabled;
  };
  const say = (/** @type {string} */ message, /** @type {'ok' | 'error'} */ tone) => {
    clearTimeout(noticeTimer);
    status.textContent = message;
    status.dataset.tone = tone;
    if (tone === 'ok') noticeTimer = setTimeout(() => (status.textContent = ''), noticeMs);
  };
  const refreshLive = async () => {
    const response = await fetch(`/api/live?session=${encodeURIComponent(sessionId)}`).catch(() => undefined);
    const live = response?.ok ? parseLiveState(await response.json().catch(() => undefined)) : undefined;
    const view = live === undefined ? serverSilent : composerState(live, sessionId, keyboard);
    element.hidden = !view.shown;
    enabled = view.enabled;
    input.placeholder = view.placeholder;
    hint.textContent = view.hint;
    interrupt.hidden = !view.canInterrupt;
    busy = view.canInterrupt;
    resume.hidden = !view.canReopen;
    form.hidden = view.canReopen;
    if (view.canReopen) {
      const place = placeOf();
      resumeWhere.textContent = place === undefined ? 'Opens in herdr in a new workspace named after its folder' : [place.workspace, place.tab].filter((part) => part !== undefined).join(' · ');
    }
    dialogCard.show(live?.state === 'live' ? live.dialog : undefined);
    refreshButtons();
    if (focusPending) {
      focusPending = false;
      if (enabled && !isOtherField(document.activeElement, input)) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  };
  /**
   * @param {'/api/send' | '/api/interrupt' | '/api/btw' | '/api/dialog' | '/api/history/reopen'} path
   * @param {{ text?: string, images?: readonly import('./attachment-picker.js').AttachedImage[], now?: true, question?: string, steps?: readonly import('../model/dialog.js').DialogStep[] }} payload — now: past Claude Code's queue
   * @returns {Promise<unknown>} — the reply's JSON; undefined if the server did not answer
   */
  const post = async (path, payload) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
      body: JSON.stringify({ session: sessionId, ...payload }),
    }).catch(() => undefined);
    return response?.ok ? response.json().catch(() => undefined) : undefined;
  };
  /**
   * The images of a prompt that came back, attached again: the viewer still has them.
   * @param {readonly string[]} urls
   */
  const reattach = async (urls) => {
    const files = await Promise.all(
      urls.map(async (url) => {
        const response = await fetch(url).catch(() => undefined);
        const blob = response?.ok ? await response.blob().catch(() => undefined) : undefined;
        return blob === undefined ? undefined : new File([blob], url.slice(url.lastIndexOf('/') + 1), { type: blob.type });
      }),
    );
    const loaded = files.filter((file) => file !== undefined);
    if (loaded.length < urls.length) say('Some images of the message could not be loaded again.', 'error');
    if (loaded.length > 0) await attachments.add(loaded);
  };
  /**
   * A prompt that came back — stopped before Claude started on it, or rewound — goes into the box for editing, as the
   * terminal does.
   * @param {string} prompt
   */
  const fill = (prompt) => {
    const restored = promptForBox(prompt, input.value);
    input.value = restored.text;
    writeDraft(draftKey, restored.text);
    fit();
    refreshButtons();
    if (keyboard === 'physical') input.focus();
    void reattach(restored.images);
  };

  /**
   * The side question and, once Claude has answered it, the answer, as the terminal's side panel shows it.
   * @param {string} question
   * @param {string | undefined} answer
   */
  const showAside = (question, answer) => {
    aside.replaceChildren(
      h('header', { className: 'side-answer-head' }, [h('span', { className: 'side-answer-label', text: 'By the way' }), h('span', { className: 'side-answer-question', text: question }), closeAside]),
      h('div', { className: 'side-answer-text' }, answer === undefined ? [h('p', { className: 'side-answer-paragraph', text: 'Answering…' })] : answerBlocks(answer).map(answerBlock)),
    );
    aside.classList.toggle('answering', answer === undefined);
    aside.hidden = false;
  };
  /**
   * The box waits while Claude answers: the terminal's side panel would take the keys of the next prompt.
   * @param {string} question
   */
  const askAside = (question) => {
    if (question === '') return say(btwMessage('empty'), 'error');
    if (attachments.images().length > 0) return say('A side question takes no images.', 'error');
    // the session keeps the question and its answer, whichever box shows it when the answer comes
    asides.set(sessionId, { question, answer: undefined });
    say('', 'ok');
    // the question leaves the box — it shows over it while Claude answers — and comes back if it is not answered
    const asked = input.value;
    input.value = '';
    writeDraft(draftKey, '');
    fit();
    void post('/api/btw', { question }).then((json) => {
      const reply = parseBtwReply(json);
      if (reply?.ok === true) {
        asides.set(sessionId, { question, answer: reply.answer });
        return;
      }
      asides.set(sessionId, undefined);
      if (input.value === '') {
        input.value = asked;
        writeDraft(draftKey, asked);
        fit();
        refreshButtons();
      }
      say(reply === undefined ? 'The viewer server did not answer. The question is back in the box.' : btwMessage(reply.error), 'error');
    });
  };

  reopen.addEventListener('click', () => {
    reopen.disabled = true;
    say('Opening in herdr…', 'ok');
    void post('/api/history/reopen', {}).then((json) => {
      const opened = parseNewTab(json);
      reopen.disabled = false;
      say(opened.ok ? 'Opened in herdr — Claude Code is resuming the session.' : 'herdr did not open the session.', opened.ok ? 'ok' : 'error');
      // Claude Code takes a few seconds to start: the box follows it
      for (const delayMs of [2000, 5000, 9000]) setTimeout(() => void refreshLive(), delayMs);
    });
  });
  /**
   * The box's prompt to the session: queued while Claude works, as Enter does in the terminal — or now, past the queue,
   * as its Ctrl+Enter does, an empty box sending what waits there.
   * @param {'queued' | 'now'} when
   */
  const submitPrompt = (when) => {
    const now = when === 'now' && busy;
    if (now ? !enabled || sending || asking : send.disabled) return;
    const question = sideQuestionOf(input.value);
    if (question !== undefined) return askAside(question);
    sending = true;
    refreshButtons();
    const images = attachments.images();
    if (images.length > 0) say(`Sending ${images.length === 1 ? 'the image' : `${images.length} images`}…`, 'ok');
    void post('/api/send', { text: input.value, images, ...(now ? { now: true } : {}) }).then((json) => {
      const outcome = parseOutcome(json);
      sending = false;
      if (outcome?.ok === true) {
        input.value = '';
        writeDraft(draftKey, '');
        attachments.clear();
        fit();
      }
      say(outcome === undefined ? 'The viewer server did not answer. The text stays in the box.' : outcomeMessage(outcome), outcome?.ok === true ? 'ok' : 'error');
      refreshButtons();
      void refreshLive();
    });
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitPrompt('queued');
  });
  input.addEventListener('keydown', (event) => {
    // Esc stops Claude, as it does in the terminal
    if (event.key === 'Escape' && stop()) {
      event.preventDefault();
      return;
    }
    // Enter sends, Shift+Enter inserts a new line; while composing with an IME, Enter confirms the word.
    // A phone keyboard has no Shift+Enter: there Enter always starts a new line and the button sends.
    if (keyboard === 'physical' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      // Ctrl+Enter sends now, past the queue, as in the terminal; with no queue it sends as Enter does
      submitPrompt(event.ctrlKey || event.metaKey ? 'now' : 'queued');
    }
  });
  // A screenshot pasted from the clipboard or images dropped on the box are attached like picked ones.
  // Ctrl+V with an image works anywhere on the page, not only in the box; another field (the session search)
  // keeps its ordinary paste.
  /** @param {ClipboardEvent} event */
  const onPaste = (event) => {
    const target = event.target;
    if ((target instanceof Element && isOtherField(target, input)) || !enabled || element.hidden) return;
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    void attachments.add(files);
    if (keyboard === 'physical') input.focus();
  };
  document.addEventListener('paste', onPaste);
  form.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  form.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    event.preventDefault();
    if (enabled) void attachments.add(files);
  });
  fold.addEventListener('click', () => {
    folded = !folded;
    showFold();
  });
  input.addEventListener('input', () => {
    writeDraft(draftKey, input.value);
    fit();
    refreshButtons();
  });
  // A prompt Claude had not started on comes back into the box, as Esc in the terminal does. Watching for it takes a
  // moment: the button waits, so a second press does not reach the terminal as a second Esc.
  /**
   * Stops Claude, as Esc in its terminal does — if it is working.
   * @returns {boolean} — whether there was anything to stop
   */
  const stop = () => {
    if (interrupt.hidden || interrupt.disabled) return false;
    interrupt.click();
    return true;
  };
  interrupt.addEventListener('click', () => {
    interrupt.disabled = true;
    say('Stopping…', 'ok');
    void post('/api/interrupt', {}).then((json) => {
      const outcome = parseStopOutcome(json);
      interrupt.disabled = false;
      if (outcome?.ok === true && outcome.prompt !== undefined) fill(outcome.prompt);
      say(outcome === undefined ? 'The viewer server did not answer.' : stopMessage(outcome), outcome?.ok === true ? 'ok' : 'error');
      void refreshLive();
    });
  });

  /**
   * The session's side question as it stands: answering — the box waits, the terminal's side panel would take the keys of
   * the next prompt — answered, its question out of the box, or closed.
   * @param {import('./aside-store.js').Aside | undefined} asked
   */
  const showAsked = (asked) => {
    asking = asked !== undefined && asked.answer === undefined;
    if (asked === undefined) aside.hidden = true;
    else showAside(asked.question, asked.answer);
    if (asked?.answer !== undefined && sideQuestionOf(input.value) === asked.question) {
      input.value = '';
      fit();
    }
    refreshButtons();
  };
  showAsked(asides.get(sessionId));
  const unwatchAsides = asides.watch(sessionId, showAsked);

  void refreshLive();
  const timer = setInterval(() => void refreshLive(), liveRefreshMs);
  // An empty box already has the height of one line; measuring it would make the browser lay out the whole page.
  if (input.value !== '') requestAnimationFrame(fit);
  return {
    element,
    say,
    fill,
    stop,
    /** What waits in Claude Code's queue, sent now — ⏩ on a waiting message, as Ctrl+Enter in the terminal. */
    sendQueue: () => {
      say('Sending the queue now…', 'ok');
      void post('/api/send', { text: '', images: [], now: true }).then((json) => {
        const outcome = parseOutcome(json);
        say(outcome === undefined ? 'The viewer server did not answer.' : outcomeMessage(outcome), outcome?.ok === true ? 'ok' : 'error');
        void refreshLive();
      });
    },
    dispose() {
      clearInterval(timer);
      clearTimeout(noticeTimer);
      unwatchAsides();
      document.removeEventListener('paste', onPaste);
    },
  };
}

/** @param {string} key */
function readDraft(key) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return ''; // storage is unavailable — no draft
  }
}

/** @param {string} key @param {string} value */
function writeDraft(key, value) {
  try {
    if (value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage is unavailable — the draft will not survive a reload
  }
}

/**
 * A field the user may be typing in, other than the box: the session search, for one.
 * @param {Element | null} element
 * @param {HTMLTextAreaElement} box
 */
function isOtherField(element, box) {
  return element instanceof HTMLElement && element !== box && (element.isContentEditable || element.matches('input, textarea, select'));
}

/**
 * A block of a side answer: text with its line breaks, a table drawn in the terminal as a table again, box lines that
 * make no table as drawn.
 * @param {import('../model/side-answer.js').AnswerBlock} block
 * @returns {HTMLElement}
 */
function answerBlock(block) {
  switch (block.kind) {
    case 'text':
      return h('p', { className: 'side-answer-paragraph', text: block.text });
    case 'preformatted':
      return h('pre', { className: 'side-answer-box', text: block.text });
    case 'table': {
      const [head = [], ...body] = block.rows;
      const table = h('table', {}, [h('thead', {}, [h('tr', {}, head.map((cell) => h('th', { text: cell })))]), h('tbody', {}, body.map((row) => h('tr', {}, row.map((cell) => h('td', { text: cell })))))]);
      // the feed's tables look the same
      return h('div', { className: 'md side-answer-table' }, [h('div', { className: 'table-scroll' }, [table])]);
    }
    default:
      return unexpected(block);
  }
}

/**
 * @param {never} value
 * @returns {never}
 */
function unexpected(value) {
  throw new Error(`Unexpected side answer block ${JSON.stringify(value)}`);
}
