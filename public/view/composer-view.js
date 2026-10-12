// @ts-check
// Prompt box under the feed: the prompt goes to the session terminal via herdr (server: /api/send, /api/interrupt).
// "/btw …" asks aside, as in the terminal (/api/btw): the answer shows above the box and never joins the feed. A choice
// Claude Code waits for — its AskUserQuestion dialog — shows above the box too, and is answered from there (/api/dialog).
import { btwMessage, composerState, outcomeMessage, parseBtwReply, parseLiveState, parseOutcome, parseStopOutcome, promptForBox, sideQuestionOf, stopMessage } from '../model/composer.js';
import { parseDialogReply } from '../model/dialog.js';
import { answerBlocks } from '../model/side-answer.js';
import { createAttachmentPicker } from './attachment-picker.js';
import { createDialogCard } from './dialog-card.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/** How often to check whether the session is running and busy. */
const liveRefreshMs = 4000;
/** After an answer to Claude Code's dialog the terminal redraws: the next question, or the box again. */
const redrawMs = 400;
/** How long the success notice stays visible. */
const noticeMs = 4000;

/** @type {import('../model/composer.js').ComposerView} */
const serverSilent = { shown: true, enabled: false, canInterrupt: false, placeholder: 'Sending is unavailable', hint: 'The viewer server did not report whether the session is running.' };

/**
 * @param {string} sessionId
 * @param {{ focusBox: 'when-ready' | 'no' }} options — when-ready: the user opened the session, so the box takes the
 *   focus once the session can be written to; no: following the active session switched to it
 * @returns {{ element: HTMLElement, say: (message: string, tone: 'ok' | 'error') => void, fill: (text: string) => void, dispose: () => void }}
 */
export function createComposer(sessionId, { focusBox }) {
  /** @type {import('../model/composer.js').Keyboard} */
  const keyboard = matchMedia('(pointer: coarse)').matches ? 'touch' : 'physical';
  const draftKey = `viewer.draft.${sessionId}`;
  const input = h('textarea', { className: 'composer-input', attrs: { rows: '1', 'aria-label': 'Prompt for Claude' } });
  input.value = readDraft(draftKey);
  const interrupt = h('button', { className: 'composer-stop', title: 'Stop — press Esc in the session terminal', attrs: { type: 'button', hidden: '', 'aria-label': 'Stop' } }, [icon('stop')]);
  const send = h('button', { className: 'composer-send', title: keyboard === 'touch' ? 'Send' : 'Send (Enter)', attrs: { type: 'submit', 'aria-label': 'Send' } }, [icon('send')]);
  const hint = h('div', { className: 'composer-hint' });
  const status = h('div', { className: 'composer-status', attrs: { role: 'status' } });
  let enabled = false;
  let sending = false;
  // A phone's keyboard would cover the feed: there the box waits for a tap.
  let focusPending = focusBox === 'when-ready' && keyboard === 'physical';
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let noticeTimer;
  const attachments = createAttachmentPicker({ onChange: () => refreshButtons(), onError: (message) => say(message, 'error') });
  const form = h('form', { className: 'composer-box' }, [attachments.list, attachments.button, input, h('div', { className: 'composer-actions' }, [interrupt, send])]);
  const aside = h('section', { className: 'side-answer', attrs: { hidden: '', 'aria-label': 'Side question', 'aria-live': 'polite' } });
  const closeAside = h('button', { className: 'icon-button side-answer-close', title: 'Close', attrs: { type: 'button', 'aria-label': 'Close' } }, [icon('cross')]);
  closeAside.addEventListener('click', () => (aside.hidden = true));
  const dialogCard = createDialogCard({
    answer: async (steps) => {
      const reply = parseDialogReply(await post('/api/dialog', { steps }));
      setTimeout(() => void refreshLive(), redrawMs);
      return reply;
    },
  });
  const element = h('div', { className: 'composer' }, [dialogCard.element, aside, form, h('div', { className: 'composer-footer' }, [hint, status]), attachments.input]);

  const fit = () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };
  const refreshButtons = () => {
    send.disabled = !enabled || sending || (input.value.trim() === '' && attachments.images().length === 0);
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
   * @param {'/api/send' | '/api/interrupt' | '/api/btw' | '/api/dialog'} path
   * @param {{ text?: string, images?: readonly import('./attachment-picker.js').AttachedImage[], question?: string, steps?: readonly import('../model/dialog.js').DialogStep[] }} payload
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
    sending = true;
    refreshButtons();
    showAside(question, undefined);
    say('', 'ok');
    void post('/api/btw', { question }).then((json) => {
      const reply = parseBtwReply(json);
      sending = false;
      if (reply?.ok === true) {
        input.value = '';
        writeDraft(draftKey, '');
        fit();
        showAside(question, reply.answer);
      } else {
        aside.hidden = true;
        say(reply === undefined ? 'The viewer server did not answer. The question stays in the box.' : btwMessage(reply.error), 'error');
      }
      refreshButtons();
    });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (send.disabled) return;
    const question = sideQuestionOf(input.value);
    if (question !== undefined) return askAside(question);
    sending = true;
    refreshButtons();
    const images = attachments.images();
    if (images.length > 0) say(`Sending ${images.length === 1 ? 'the image' : `${images.length} images`}…`, 'ok');
    void post('/api/send', { text: input.value, images }).then((json) => {
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
  });
  input.addEventListener('keydown', (event) => {
    // Enter sends, Shift+Enter inserts a new line; while composing with an IME, Enter confirms the word.
    // A phone keyboard has no Shift+Enter: there Enter always starts a new line and the button sends.
    if (keyboard === 'physical' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
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
  input.addEventListener('input', () => {
    writeDraft(draftKey, input.value);
    fit();
    refreshButtons();
  });
  // A prompt Claude had not started on comes back into the box, as Esc in the terminal does. Watching for it takes a
  // moment: the button waits, so a second press does not reach the terminal as a second Esc.
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

  void refreshLive();
  const timer = setInterval(() => void refreshLive(), liveRefreshMs);
  // An empty box already has the height of one line; measuring it would make the browser lay out the whole page.
  if (input.value !== '') requestAnimationFrame(fit);
  return {
    element,
    say,
    fill,
    dispose() {
      clearInterval(timer);
      clearTimeout(noticeTimer);
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
