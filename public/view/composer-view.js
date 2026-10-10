// @ts-check
// Prompt box under the feed: the prompt goes to the session terminal via herdr (server: /api/send, /api/interrupt).
import { composerState, outcomeMessage, parseLiveState, parseOutcome } from '../model/composer.js';
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
 * @returns {{ element: HTMLElement, dispose: () => void }}
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
  const form = h('form', { className: 'composer-box' }, [input, h('div', { className: 'composer-actions' }, [interrupt, send])]);
  const element = h('div', { className: 'composer' }, [form, h('div', { className: 'composer-footer' }, [hint, status])]);
  let enabled = false;
  let sending = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let noticeTimer;

  const fit = () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };
  const refreshButtons = () => {
    send.disabled = !enabled || sending || input.value.trim() === '';
    input.disabled = !enabled;
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
  /** @param {'/api/send' | '/api/interrupt'} path @param {Record<string, string>} payload */
  const post = async (path, payload) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
      body: JSON.stringify({ session: sessionId, ...payload }),
    }).catch(() => undefined);
    return response?.ok ? parseOutcome(await response.json().catch(() => undefined)) : undefined;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (send.disabled) return;
    sending = true;
    refreshButtons();
    void post('/api/send', { text: input.value }).then((outcome) => {
      sending = false;
      if (outcome?.ok === true) {
        input.value = '';
        writeDraft(draftKey, '');
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
  input.addEventListener('input', () => {
    writeDraft(draftKey, input.value);
    fit();
    refreshButtons();
  });
  interrupt.addEventListener('click', () => {
    void post('/api/interrupt', {}).then((outcome) => {
      say(outcome?.ok === true ? 'Esc sent — Claude will stop the current turn.' : outcome === undefined ? 'The viewer server did not answer.' : outcomeMessage(outcome), outcome?.ok === true ? 'ok' : 'error');
      void refreshLive();
    });
  });

  void refreshLive();
  const timer = setInterval(() => void refreshLive(), liveRefreshMs);
  // An empty box already has the height of one line; measuring it would make the browser lay out the whole page.
  if (input.value !== '') requestAnimationFrame(fit);
  return {
    element,
    dispose() {
      clearInterval(timer);
      clearTimeout(noticeTimer);
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
