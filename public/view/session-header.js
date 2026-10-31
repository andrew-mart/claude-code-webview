// @ts-check
// The session header. The title and the status on top; under the title the session's facts at a glance — folder,
// branch, model and effort, how full the context window is, cost, the session's id — which open into details with the
// full values, and the rows the page adds there — what the session can be asked to do, such as restarting it.
// The view buttons stand in a row on a wide screen and fold into a menu on a narrow one; those used rarely stand in the
// menu, behind ⋯, even on a wide screen.
import { formatTokens } from '../model/format.js';
import { contextGauge, modelName } from '../model/session-facts.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {import('./session-view.js').SessionMeta} SessionMeta
 * @typedef {import('./session-view.js').SessionStatus} SessionStatus
 * @typedef {{ title: string | undefined, cwd: string | undefined }} SessionPlace
 * @typedef {import('../model/session-facts.js').ContextGauge} ContextGauge
 * How the session's tables are shown: as the viewer-wide setting says, fitted to the width, or wide.
 * @typedef {'default' | 'fit' | 'wide'} TablesChoice
 * @typedef {{ value: () => TablesChoice, choose: (choice: TablesChoice) => void }} SessionTables
 */

/**
 * The session's status as an icon; the words are in its tooltip.
 * @type {Readonly<Record<SessionStatus, { label: string, glyph: () => HTMLElement }>>}
 */
const statusLooks = {
  connecting: { label: 'Loading…', glyph: () => icon('reload') },
  missing: { label: 'Nothing written down yet — or the transcript is gone', glyph: () => icon('alert') },
  idle: { label: 'Waiting for input', glyph: () => icon('message') },
  working: { label: 'Working', glyph: () => h('span', { className: 'spark', text: '✻' }) },
};

/** The branch can change in the terminal at any moment; the header looks again this often. */
const branchRefreshMs = 15_000;

/**
 * @param {{ sessionId: string, place: SessionPlace | undefined, currentBranch: () => Promise<string | undefined>, tables: SessionTables, leading: HTMLElement, navigation: readonly HTMLElement[], folds: readonly HTMLElement[], tools: readonly HTMLElement[], rare: readonly HTMLElement[], rareOpeners: readonly HTMLElement[], details: readonly HTMLElement[] }} parts
 *   sessionId — the agent's id of the session, as its transcript is named;
 *   currentBranch — the branch checked out in the session's folder now (the transcript keeps the one it saw first);
 *   tables — how this session shows its tables, chosen in the details;
 *   leading — before the title (the session list's drawer button); navigation — buttons that always stay in view;
 *   folds — those of navigation's buttons used less on a narrow screen: there they fold into the view menu, as its first
 *   group, for the title to have room, and come back to their places on a wide one; tools — the view settings, folded
 *   into a menu on a narrow screen; rare — view settings used rarely: in the menu, its last group, even on a wide
 *   screen; rareOpeners — buttons used rarely that open something elsewhere, VS Code: first in that group, the menu put
 *   away once one is pressed; details — rows of the page's own at the end of the details, each a dt and its dd in one element, the same
 *   ones as the details are drawn anew
 */
export function createSessionHeader({ sessionId, place, currentBranch, tables, leading, navigation, folds, tools, rare, rareOpeners, details: ownRows }) {
  const title = h('h1', { className: 'title' });
  const facts = h('button', { className: 'head-facts', attrs: { type: 'button', 'aria-expanded': 'false', title: 'Show session details' } });
  const details = h('dl', { className: 'head-details', attrs: { hidden: '' } });
  const status = h('span', { className: 'status', attrs: { role: 'status' } });
  const folded = h('span', { className: 'head-group head-folded' });
  const toolbox = h('div', { className: 'head-tools', attrs: { role: 'group', 'aria-label': 'View' } }, [folded, ...tools, h('span', { className: 'head-group head-rare' }, [...rareOpeners, ...rare])]);
  const more = h('button', { className: 'icon-button head-more', title: 'View settings', attrs: { type: 'button', 'aria-label': 'View settings', 'aria-expanded': 'false' } }, [icon('more')]);
  const actions = h('div', { className: 'head-actions' }, [status, ...navigation, toolbox, more]);
  const element = h('header', { className: 'session-head' }, [leading, title, facts, actions, details]);
  /** @type {SessionMeta} */
  let meta = {};
  let where = place;
  /** @type {string | undefined} */
  let branch;

  const render = () => {
    title.textContent = meta.customTitle ?? meta.title ?? where?.title ?? 'Session';
    document.title = `${title.textContent} — Claude Code`;
    const gauge = meta.model === undefined || meta.contextTokens === undefined ? undefined : contextGauge({ model: meta.model, tokens: meta.contextTokens, extended: meta.extendedContext === true, window: meta.contextWindow });
    facts.replaceChildren(...factChips({ sessionId, cwd: where?.cwd, branch, meta, gauge }), h('span', { className: 'facts-toggle' }, [icon('chevron')]));
    details.replaceChildren(...detailRows({ sessionId, cwd: where?.cwd, branch, meta, gauge }), ...tablesRow(tables, render), ...ownRows);
  };

  const setOpen = (/** @type {HTMLButtonElement} */ button, /** @type {boolean} */ open) => button.setAttribute('aria-expanded', String(open));
  facts.addEventListener('click', () => {
    const open = facts.getAttribute('aria-expanded') !== 'true';
    setOpen(facts, open);
    details.hidden = !open;
  });
  more.addEventListener('click', () => {
    const open = more.getAttribute('aria-expanded') !== 'true';
    setOpen(more, open);
    toolbox.classList.toggle('open', open);
  });
  // The menu closes on a click elsewhere or Esc; a click on one of its buttons keeps it open — the theme or the font
  // is often toggled more than once.
  const closeMenu = () => {
    setOpen(more, false);
    toolbox.classList.remove('open');
  };
  const onPointer = (/** @type {PointerEvent} */ event) => {
    if (event.target instanceof Node && !toolbox.contains(event.target) && !more.contains(event.target)) closeMenu();
  };
  const onKey = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape') closeMenu();
  };
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('keydown', onKey);
  // where each button that folds stands on a wide screen: put back there the last first, each before what followed it
  const homes = folds.map((button) => ({ button, parent: button.parentNode, next: button.nextSibling }));
  const narrowScreen = window.matchMedia('(max-width: 820px)');
  const fold = (/** @type {{ matches: boolean }} */ screen) => {
    if (screen.matches) folded.append(...folds);
    else for (const { button, parent, next } of [...homes].reverse()) parent?.insertBefore(button, next);
  };
  narrowScreen.addEventListener('change', fold);
  fold(narrowScreen);
  // a folded button opens what takes the screen — a panel, another window: the menu goes
  folded.addEventListener('click', (event) => {
    if (event.target instanceof window.Element && event.target.closest('button') !== null) closeMenu();
  });
  for (const opener of rareOpeners) opener.addEventListener('click', closeMenu);
  const lookAtBranch = async () => {
    const next = await currentBranch();
    if (next === branch) return;
    branch = next;
    render();
  };
  void lookAtBranch();
  const branchTimer = setInterval(() => void lookAtBranch(), branchRefreshMs);
  render();

  return {
    element,
    /** @param {SessionMeta} next */
    onMeta(next) {
      meta = next;
      render();
    },
    /** @param {SessionStatus} next */
    onStatus(next) {
      const look = statusLooks[next];
      status.dataset.status = next;
      status.title = look.label;
      status.setAttribute('aria-label', look.label);
      status.replaceChildren(look.glyph());
    },
    /** @param {SessionPlace} next */
    updatePlace(next) {
      where = next;
      render();
    },
    dispose() {
      clearInterval(branchTimer);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      narrowScreen.removeEventListener('change', fold);
    },
  };
}

/**
 * @typedef {{ sessionId: string, cwd: string | undefined, branch: string | undefined, meta: SessionMeta, gauge: ContextGauge | undefined }} Facts
 */

/**
 * The facts in one line: each short, the full values are in the details.
 * @param {Facts} facts
 * @returns {HTMLElement[]}
 */
function factChips({ sessionId, cwd, branch, meta, gauge }) {
  const chips = [];
  if (cwd !== undefined) chips.push(chip('folder', 'fact-folder', [h('span', { text: folderName(cwd) })], cwd));
  if (branch !== undefined) chips.push(chip('branch', 'fact-branch', [h('span', { text: branch })], `Branch ${branch}`));
  if (meta.model !== undefined) chips.push(chip('model', 'fact-model', [h('span', { text: modelName(meta.model) }), ...effortTag(meta.effort)], meta.model));
  if (gauge !== undefined) chips.push(contextChip(gauge));
  if (meta.costUsd !== undefined) chips.push(h('span', { className: 'fact fact-cost', text: `$${meta.costUsd.toFixed(2)}`, title: 'Cost of the session' }));
  // its first characters tell it from the others, as a commit's short hash does
  chips.push(h('span', { className: 'fact fact-session', title: `Session ${sessionId}` }, [h('span', { text: sessionId.slice(0, 8) })]));
  return chips;
}

/**
 * @param {string} iconName
 * @param {string} className
 * @param {readonly HTMLElement[]} content
 * @param {string} tooltip
 */
function chip(iconName, className, content, tooltip) {
  return h('span', { className: `fact ${className}`, title: tooltip }, [icon(iconName), ...content]);
}

/** @param {string | undefined} effort */
function effortTag(effort) {
  return effort === undefined ? [] : [h('span', { className: 'fact-dim', text: effort })];
}

/**
 * A ring that fills as the context grows, and the size: "412k/1M"; just the size when the window is unknown.
 * @param {ContextGauge} gauge
 */
function contextChip(gauge) {
  if (gauge.window === undefined) return h('span', { className: 'fact fact-context', title: 'Context size' }, [h('span', { text: formatContextTokens(gauge.tokens) })]);
  const tooltip = `Context: ${formatContextTokens(gauge.tokens)} of ${formatContextTokens(gauge.window)} — ${formatContextTokens(gauge.left)} left`;
  return h('span', { className: 'fact fact-context', title: tooltip, attrs: { 'data-level': gauge.level } }, [
    ring(gauge.share),
    h('span', { text: formatContextTokens(gauge.tokens) }),
    h('span', { className: 'fact-dim', text: `/${formatContextTokens(gauge.window)}` }),
  ]);
}

/** @param {number} tokens */
function formatContextTokens(tokens) {
  return tokens >= 1_000_000 ? `${Number((tokens / 1_000_000).toFixed(2))}M` : formatTokens(tokens);
}

/**
 * @param {number} share — 0…1
 * @returns {SVGSVGElement}
 */
function ring(share) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'context-ring');
  svg.setAttribute('aria-hidden', 'true');
  for (const [className, length] of [['ring-track', 100], ['ring-fill', Math.max(share * 100, 2)]]) {
    const circle = document.createElementNS(svgNs, 'circle');
    circle.setAttribute('class', String(className));
    circle.setAttribute('cx', '8');
    circle.setAttribute('cy', '8');
    circle.setAttribute('r', '6');
    circle.setAttribute('pathLength', '100');
    circle.setAttribute('stroke-dasharray', `${length} 100`);
    svg.append(circle);
  }
  return svg;
}

/**
 * The details: full path, branch, model, context used and left, cost, the session's id.
 * @param {Facts} facts
 * @returns {HTMLElement[]}
 */
function detailRows({ sessionId, cwd, branch, meta, gauge }) {
  /** @type {[string, (string | HTMLElement)[]][]} */
  const rows = [];
  if (cwd !== undefined) rows.push(['Folder', [h('code', { text: cwd })]]);
  if (branch !== undefined) rows.push(['Branch', [h('code', { text: branch })]]);
  if (meta.model !== undefined) rows.push(['Model', [`${modelName(meta.model)}${meta.effort === undefined ? '' : ` · effort ${meta.effort}`}`]]);
  if (gauge !== undefined) rows.push(['Context', contextDetail(gauge)]);
  if (meta.costUsd !== undefined) rows.push(['Cost', [`$${meta.costUsd.toFixed(2)}`]]);
  rows.push(['Session', [h('code', { text: sessionId }), copyIdButton(sessionId)]]);
  return rows.flatMap(([label, value]) => [h('dt', { text: label }), h('dd', {}, value)]);
}

/**
 * Copies the session's id; a tick for a moment once it is copied.
 * @param {string} sessionId
 */
function copyIdButton(sessionId) {
  const button = h('button', { className: 'icon-button head-copy', title: 'Copy the session id', attrs: { type: 'button', 'aria-label': 'Copy the session id' } }, [icon('copy')]);
  button.addEventListener('click', () => {
    void navigator.clipboard.writeText(sessionId).then(() => {
      button.replaceChildren(icon('check'));
      setTimeout(() => button.replaceChildren(icon('copy')), 1500);
    });
  });
  return button;
}

/** @param {ContextGauge} gauge @returns {(string | HTMLElement)[]} */
function contextDetail(gauge) {
  if (gauge.window === undefined) return [`${formatContextTokens(gauge.tokens)} — the window of this model is not known`];
  const bar = h('span', { className: 'context-bar', attrs: { 'data-level': gauge.level } }, [h('span', { className: 'context-bar-fill' })]);
  bar.style.setProperty('--share', String(gauge.share));
  return [bar, h('span', { text: `${formatContextTokens(gauge.tokens)} used · ${formatContextTokens(gauge.left)} left of ${formatContextTokens(gauge.window)}` })];
}

/** @type {readonly [TablesChoice, string][]} */
const tablesLabels = [
  ['default', 'As everywhere'],
  ['fit', 'Fit the width'],
  ['wide', 'Wide'],
];

/**
 * The details' row that sets how this session shows its tables; a table's own button still overrides it.
 * @param {SessionTables} tables
 * @param {() => void} rerender
 * @returns {HTMLElement[]}
 */
function tablesRow(tables, rerender) {
  const current = tables.value();
  const buttons = tablesLabels.map(([choice, label]) => {
    const button = h('button', { className: 'segment', text: label, attrs: { type: 'button', 'aria-pressed': String(choice === current) } });
    button.addEventListener('click', () => {
      tables.choose(choice);
      rerender();
    });
    return button;
  });
  return [h('dt', { text: 'Tables' }), h('dd', {}, [h('span', { className: 'segments', attrs: { role: 'group', 'aria-label': 'Tables in this session' } }, buttons)])];
}

/**
 * The folder's own name: the last part of the path.
 * @param {string} path
 */
function folderName(path) {
  return path.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? path;
}
