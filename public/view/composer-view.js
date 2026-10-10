// @ts-check
// Prompt box under the feed: the prompt goes to the session terminal via herdr (server: /api/send, /api/interrupt).
import { composerState, outcomeMessage, parseLiveState, parseOutcome, parseStopOutcome, promptForBox, stopMessage } from '../model/composer.js';
import { createAttachmentPicker } from './attachment-picker.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/** How often to check whether the session is running and busy. */
const liveRefreshMs = 4000;
/** How long the success notice stays visible. */
const noticeMs = 4000;

/** @type {import('../model/composer.js').ComposerView} */
const serverSilent = { shown: true, enabled: false, canInterrupt: false, placeholder: 'Sending is unavailable', hint: 'The viewer server did not report whether the session is running.' };

/**
 * @param {string} sessionId
 * @returns {{ element: HTMLElement, say: (message: string, tone: 'ok' | 'error') => void, fill: (text: string) => void, dispose: () => void }}
 */
export function createComposer(sessionId) {
  /** @type {import('../model/composer.js').Keyboard} */
  const keyboard = matchMedia('(pointer: coarse)').matches ? 'touch' : 'physical';
  const draftKey = `viewer.draft.${sessionId}`;
  const input = h('textarea', { className: 'composer-input', attrs: { rows: '1', 'aria-label': 'Prompt for Claude' } });
  input.value = readDraft(draftKey);
  const interrupt = h('button', { className: 'composer-stop', title: 'Stop — press Esc in the session terminal', attrs: { type: 'button', hidden: '' } }, [icon('stop'), h('span', { text: 'Stop' })]);
  const send = h('button', { className: 'composer-send', title: keyboard === 'touch' ? 'Send' : 'Send (Enter)', attrs: { type: 'submit', 'aria-label': 'Send' } }, [icon('send')]);
  const hint = h('div', { className: 'composer-hint' });
  const status = h('div', { className: 'composer-status', attrs: { role: 'status' } });
  let enabled = false;
  let sending = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let noticeTimer;
  const attachments = createAttachmentPicker({ onChange: () => refreshButtons(), onError: (message) => say(message, 'error') });
  const form = h('form', { className: 'composer-box' }, [attachments.list, attachments.button, input, h('div', { className: 'composer-actions' }, [interrupt, send])]);
  const element = h('div', { className: 'composer' }, [form, h('div', { className: 'composer-footer' }, [hint, status]), attachments.input]);

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
    refreshButtons();
  };
  /**
   * @param {'/api/send' | '/api/interrupt'} path
   * @param {{ text?: string, images?: readonly import('./attachment-picker.js').AttachedImage[] }} payload
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

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (send.disabled) return;
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
    const otherField = target instanceof HTMLElement && target !== input && (target.isContentEditable || target.matches('input, textarea, select'));
    if (otherField || !enabled || element.hidden) return;
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
