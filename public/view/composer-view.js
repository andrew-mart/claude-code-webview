// @ts-check
// Prompt box under the feed: the prompt goes to the session terminal via herdr (server: /api/send, /api/interrupt).
// "/btw …" asks aside, as in the terminal (/api/btw): the answer shows above the box and never joins the feed. A choice
// Claude Code waits for — its AskUserQuestion dialog — shows above the box too, and is answered from there (/api/dialog).
// A command typed — a slash first — has the session's commands and skills offered over the box (command-menu.js).
import { askerNames, btwMessage, composerState, outcomeMessage, parseBtwReply, parseLiveState, parseOutcome, parseStopOutcome, promptForBox, sideQuestionOf, stopMessage } from '../model/composer.js';
import { parseDialogReply } from '../model/dialog.js';
import { parseNewTab } from '../model/herdr.js';
import { answerBlocks } from '../model/side-answer.js';
import { completeCommand, parseCommands } from '../model/command-suggest.js';
import { createAttachmentPicker } from './attachment-picker.js';
import { createCommandMenu } from './command-menu.js';
import { createDialogCard } from './dialog-card.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { createLaterStore } from './later-store.js';
import { createLaterList } from './later-view.js';

/** How often to check whether the session is running and busy. */
const liveRefreshMs = 4000;
/** A side question's answer whose request was lost is asked for again this long after, at most this many times: a viewer
 * restarting takes a few seconds, a network a while longer. */
const askAgainMs = 3000;
const askAgainTimes = 40;
/** A box taller than this — about three lines — can be folded to it, px. */
const foldedHeightPx = 80;
/** After an answer to Claude Code's dialog the terminal redraws: the next question, or the box again. */
const redrawMs = 400;
/** How long the success notice stays visible. */
const noticeMs = 4000;

/** @type {import('../model/composer.js').ComposerView} */
const serverSilent = { shown: true, enabled: false, canInterrupt: false, canReopen: false, placeholder: 'Sending is unavailable', hint: 'The viewer server did not report whether the session is running.' };

/**
 * @typedef {{ workspace: string, tab: string | undefined, runningNow: { id: string, title: string, agent: import('../model/composer.js').Agent } | undefined }} Ran — where
 *   a session ran in herdr: its workspace, its tab's name — when it had one; runningNow: the conversation its tab went
 *   on with — /clear, /new or /resume typed there — while it runs, and whose it is
 */

/**
 * @param {string} sessionId
 * @param {{ agent: import('../model/composer.js').Agent, focusBox: 'when-ready' | 'no', placeOf: () => Ran | undefined, asides: import('./aside-store.js').AsideStore, onSent: (text: string) => void }} options —
 *   agent: whose session; focusBox when-ready: the user opened the session, so the box takes the focus once the session can be written to; no:
 *   following the active session switched to it. placeOf: where the session ran in herdr, if known. asides:
 *   the side questions and answers of the page's sessions — one outlives the box it was asked in. onSent: a prompt the
 *   session's terminal took — the feed shows it until Claude Code writes it down
 * @returns {{ element: HTMLElement, say: (message: string, tone: 'ok' | 'error') => void, fill: (text: string) => void, stop: () => boolean, sendQueue: () => void, dispose: () => void }} — stop: Claude stopped if it was working
 */
export function createComposer(sessionId, { agent, focusBox, placeOf, asides, onSent }) {
  /** @type {import('../model/composer.js').Keyboard} */
  const keyboard = matchMedia('(pointer: coarse)').matches ? 'touch' : 'physical';
  const draftKey = `viewer.draft.${sessionId}`;
  const input = h('textarea', { className: 'composer-input', attrs: { rows: '1', 'aria-label': 'Prompt for Claude' } });
  input.value = readDraft(draftKey);
  const interrupt = h('button', { className: 'composer-stop', title: 'Stop — press Esc in the session terminal', attrs: { type: 'button', hidden: '', 'aria-label': 'Stop' } }, [icon('stop')]);
  const send = h('button', { className: 'composer-send', title: keyboard === 'touch' ? 'Send' : 'Send (Enter)', attrs: { type: 'submit', 'aria-label': 'Send' } }, [icon('send')]);
  // what comes to mind while the agent works is set aside rather than sent: in its queue it would break into the turn
  const setAsideButton = h('button', { className: 'icon-button composer-later', title: keyboard === 'touch' ? 'Set aside for later' : 'Set aside for later (Alt+Enter)', attrs: { type: 'button', 'aria-label': 'Set aside for later' } }, [icon('later')]);
  const hint = h('div', { className: 'composer-hint' });
  // a session that is not running is opened again in herdr — where it ran — and the box comes to life when it starts
  const reopen = h('button', { className: 'composer-reopen', attrs: { type: 'button' } });
  // one whose tab went on with another conversation goes back to it there too: /resume typed into that one
  const resumeHere = h('button', { className: 'composer-resume-here', text: 'Resume here', title: "Back to this conversation in its tab: /resume typed into the one it runs now, which stays in the tab's history", attrs: { type: 'button', hidden: '' } });
  const resumeWhere = h('span', { className: 'composer-resume-where' });
  // in the box's place while the session is not running: where it ran, and the buttons that open it there again
  const resume = h('div', { className: 'composer-resume', attrs: { hidden: '' } }, [h('div', { className: 'composer-resume-text' }, [h('span', { className: 'composer-resume-state', text: 'Not running' }), resumeWhere]), h('div', { className: 'composer-resume-actions' }, [resumeHere, reopen])]);
  /** What the card shows, to draw it again only when that changes: it is looked at every few seconds. */
  let ranShown = '';
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
  // the session's commands and skills, asked of the viewer each time the list opens
  const commandMenu = createCommandMenu({
    load: () =>
      fetch(`/api/commands?session=${encodeURIComponent(sessionId)}`)
        .then((response) => (response.ok ? response.json() : undefined))
        .then(parseCommands, () => []),
    onPick: (name) => {
      const done = completeCommand(input.value, input.selectionStart ?? input.value.length, name);
      input.value = done.text;
      input.setSelectionRange(done.caret, done.caret);
      writeDraft(draftKey, input.value);
      fit();
      refreshButtons();
      input.focus();
    },
  });
  const form = h('form', { className: 'composer-box' }, [commandMenu.element, fold, attachments.list, attachments.button, input, h('div', { className: 'composer-actions' }, [setAsideButton, interrupt, send])]);
  const aside = h('section', { className: 'side-answer', attrs: { hidden: '', 'aria-label': 'Side question', 'aria-live': 'polite' } });
  const closeAside = h('button', { className: 'icon-button side-answer-close', title: 'Close', attrs: { type: 'button', 'aria-label': 'Close' } }, [icon('cross')]);
  closeAside.addEventListener('click', () => asides.set(sessionId, undefined));
  const dialogCard = createDialogCard({
    asker: askerNames[agent],
    answer: async (steps) => {
      const reply = parseDialogReply(await post('/api/dialog', { steps }));
      setTimeout(() => void refreshLive(), redrawMs);
      return reply;
    },
  });
  // what Codex queued to send next — Claude Code's queue shows in the feed
  const queuedList = h('ul', { className: 'composer-queued-items' });
  const queued = h('section', { className: 'composer-queued', attrs: { hidden: '', 'aria-label': 'Queued' } }, [h('div', { className: 'composer-queued-note', text: 'Codex sends these next, once its turn is over.' }), queuedList]);
  /** @param {readonly string[]} items */
  const showQueued = (items) => {
    queued.hidden = items.length === 0;
    queuedList.replaceChildren(...items.map((item) => h('li', { text: item })));
  };
  const laterList = createLaterList({
    // into the box to be edited, after what the box holds
    intoBox: (prompt) => {
      input.value = input.value.trim() === '' ? prompt.text : `${input.value.trimEnd()}\n\n${prompt.text}`;
      writeDraft(draftKey, input.value);
      later.remove(prompt.id);
      fit();
      refreshButtons();
      if (keyboard === 'physical') input.focus();
    },
    // sent as the box sends it, from the box — an empty one: words written meanwhile are neither sent with it nor lost.
    // Should the terminal not take it, it stays in the box
    send: (prompt) => {
      if (input.value.trim() !== '' || attachments.images().length > 0) return;
      input.value = prompt.text;
      writeDraft(draftKey, input.value);
      later.remove(prompt.id);
      fit();
      refreshButtons();
      submitPrompt('queued');
    },
    remove: (prompt) => later.remove(prompt.id),
  });
  const later = createLaterStore(sessionId, (prompts) => laterList.show(prompts));
  const element = h('div', { className: 'composer' }, [dialogCard.element, aside, queued, laterList.element, resume, form, h('div', { className: 'composer-footer' }, [hint, status]), attachments.input]);

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
    setAsideButton.disabled = !enabled || input.value.trim() === '';
    laterList.allowSend(enabled && input.value.trim() === '' && attachments.images().length === 0);
    input.disabled = !enabled;
    attachments.button.disabled = !enabled;
  };
  const say = (/** @type {string} */ message, /** @type {'ok' | 'busy' | 'error'} */ tone) => {
    clearTimeout(noticeTimer);
    status.textContent = message;
    status.dataset.tone = tone;
    if (tone === 'ok') noticeTimer = setTimeout(() => (status.textContent = ''), noticeMs);
  };
  const refreshLive = async () => {
    const response = await fetch(`/api/live?session=${encodeURIComponent(sessionId)}`).catch(() => undefined);
    const live = response?.ok ? parseLiveState(await response.json().catch(() => undefined)) : undefined;
    const view = live === undefined ? serverSilent : composerState(live, { id: sessionId, agent }, keyboard);
    element.hidden = !view.shown;
    enabled = view.enabled;
    input.placeholder = view.placeholder;
    hint.textContent = view.hint;
    interrupt.hidden = !view.canInterrupt;
    busy = view.canInterrupt;
    resume.hidden = !view.canReopen;
    form.hidden = view.canReopen;
    if (view.canReopen) showRan(placeOf());
    dialogCard.show(live?.state === 'live' ? live.dialog : undefined);
    showQueued(live?.state === 'live' ? live.queued : []);
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
   * Where the session ran, in the card in the box's place: the conversation its tab runs now, to go to, and the ways
   * back to this one — in that tab for Claude Code's, and in a new one — or the workspace and tab a new tab opens in.
   * @param {Ran | undefined} place
   */
  const showRan = (place) => {
    const runningNow = place?.runningNow;
    const look = JSON.stringify([place, agent]);
    if (look === ranShown) return;
    ranShown = look;
    if (runningNow !== undefined) resumeWhere.replaceChildren('Its tab went on with ', h('a', { text: runningNow.title, attrs: { href: `#/${runningNow.id}` } }));
    else resumeWhere.textContent = place === undefined ? 'Opens in herdr in a new workspace named after its folder' : [place.workspace, place.tab].filter((part) => part !== undefined).join(' · ');
    // /resume is Claude Code's, typed into Claude Code
    resumeHere.hidden = runningNow === undefined || agent !== 'claude' || runningNow.agent !== 'claude';
    reopen.textContent = runningNow === undefined ? 'Open in herdr' : 'New tab';
    reopen.title = runningNow === undefined ? 'A tab of the workspace it ran in, named as before; Claude Code resumes the session there' : 'A copy of its tab in the workspace; Claude Code resumes the session there';
  };
  /**
   * @param {'/api/send' | '/api/interrupt' | '/api/btw' | '/api/dialog' | '/api/history/reopen'} path
   * @param {{ text?: string, images?: readonly import('./attachment-picker.js').AttachedImage[], now?: true, question?: string, resume?: true, steps?: readonly import('../model/dialog.js').DialogStep[] }} payload — now: past
   *   Claude Code's queue; resume: a side question's answer asked for again, the question not asked anew
   * @param {string} [session] - whose: the box's session unless another
   * @returns {Promise<unknown>} — the reply's JSON; undefined if the server did not answer
   */
  const post = async (path, payload, session = sessionId) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
      body: JSON.stringify({ session, ...payload }),
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
      // the request lost — the viewer restarted, the network dropped — while Claude answers in the terminal
      if (reply === undefined) setTimeout(() => askAgain(question, asked, askAgainTimes), askAgainMs);
      else answered(question, asked, reply);
    });
  };
  /**
   * The answer of a side question asked before, asked for again — the question not asked anew — until the viewer
   * answers, a little later each time it does not.
   * @param {string} question
   * @param {string} asked — what the box held: it comes back there if the question is not answered
   * @param {number} left — how many times more
   */
  const askAgain = (question, asked, left) => {
    void post('/api/btw', { question, resume: true }).then((json) => {
      const reply = parseBtwReply(json);
      if (reply === undefined && left > 1) setTimeout(() => askAgain(question, asked, left - 1), askAgainMs);
      else answered(question, asked, reply);
    });
  };
  /**
   * The side question's answer shown over the box; refused — or the viewer not answering at all — the question back in
   * the box, to be asked again.
   * @param {string} question @param {string} asked
   * @param {import('../model/composer.js').BtwReply | undefined} reply
   */
  const answered = (question, asked, reply) => {
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
  // Claude Code in the tab goes back to this conversation once it takes /resume — after its turn, if it works: the box
  // comes to life then
  resumeHere.addEventListener('click', () => {
    const runningNow = placeOf()?.runningNow;
    if (runningNow === undefined) return;
    resumeHere.disabled = true;
    say('Sending /resume to its tab…', 'busy');
    void post('/api/send', { text: `/resume ${sessionId}` }, runningNow.id).then((json) => {
      const outcome = parseOutcome(json);
      resumeHere.disabled = false;
      say(outcome?.ok === true ? 'Sent — Claude Code goes back to this conversation in its tab, once its turn is over if it is working.' : 'Its tab did not take /resume — open the conversation in a new tab instead.', outcome?.ok === true ? 'ok' : 'error');
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
    // at once: under a heavy load the terminal may take a while to take it
    say(images.length > 0 ? `Sending ${images.length === 1 ? 'the image' : `${images.length} images`} to the terminal…` : 'Sending to the terminal…', 'busy');
    const text = input.value;
    void post('/api/send', { text, images, ...(now ? { now: true } : {}) }).then((json) => {
      const outcome = parseOutcome(json);
      sending = false;
      if (outcome?.ok === true) {
        onSent(text);
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
  /** The box's words set aside for later, the box free again; its images stay in it. */
  const setAside = () => {
    const text = input.value.trim();
    if (!enabled || text === '') return;
    later.add(text);
    input.value = '';
    writeDraft(draftKey, '');
    fit();
    refreshButtons();
  };
  setAsideButton.addEventListener('click', setAside);
  input.addEventListener('keydown', (event) => {
    // the commands offered take ↑, ↓, Enter, Tab and Esc while they show
    if (commandMenu.key(event)) return;
    // Esc stops Claude, as it does in the terminal
    if (event.key === 'Escape' && stop()) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && event.altKey && !event.isComposing) {
      event.preventDefault();
      setAside();
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
    commandMenu.update(input.value, input.selectionStart ?? input.value.length);
  });
  // the caret moved out of the command's name, or the box left: the commands go
  const followCaret = () => commandMenu.update(input.value, input.selectionStart ?? input.value.length);
  input.addEventListener('click', followCaret);
  input.addEventListener('keyup', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) followCaret();
  });
  input.addEventListener('blur', () => commandMenu.hide());
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
      say(outcome === undefined ? 'The viewer server did not answer.' : stopMessage(outcome, agent), outcome?.ok === true ? 'ok' : 'error');
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
  // a question being answered when the page reloaded: its answer asked for again
  const leftAsking = asides.leftAsking(sessionId);
  if (leftAsking !== undefined) {
    asides.set(sessionId, { question: leftAsking, answer: undefined });
    askAgain(leftAsking, `/btw ${leftAsking}`, askAgainTimes);
  }

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
      later.dispose();
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
