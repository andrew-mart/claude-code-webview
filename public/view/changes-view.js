// @ts-check
// A branch's changes in the side panel: against which base — the branch it was made from, or one chosen — its commits,
// and its files, each with its status and lines added and removed; a file opened shows its diff, asked for only then:
// a long branch's diffs at once would be megabytes.
import { diffTable } from './diff-table.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { languageOfPath } from './markdown.js';

/**
 * @typedef {import('../model/branch-changes.js').BranchChanges} BranchChanges
 * @typedef {import('../model/branch-changes.js').ChangedFile} ChangedFile
 * @typedef {import('../model/branch-changes.js').FileDiff} FileDiff
 * @typedef {{ load: (base: string | undefined) => Promise<BranchChanges | undefined>, loadDiff: (base: string, file: ChangedFile) => Promise<FileDiff | undefined>, openFile: (path: string) => void }} ChangesSource
 *   — load: the changes against a base chosen, or the one the branch was made from; loadDiff: one file's diff since the
 *   base; openFile: a changed file into the panel, by its full path
 */

/** A file's diff drawn at most this many rows: a larger one is cut and says so. */
const drawnRows = 3000;

/** @type {Readonly<Record<import('../model/branch-changes.js').ChangeStatus, string>>} */
const letters = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', 'type-changed': 'T', untracked: 'U' };

/** @type {Readonly<Record<'not-a-repository' | 'no-git', string>>} */
const refusals = {
  'not-a-repository': "The session's folder is not in a git repository.",
  'no-git': 'git is not installed on the viewer\'s computer.',
};

/**
 * @param {ChangesSource} source
 * @returns {{ element: HTMLElement, reload: () => Promise<void>, summary: () => string | undefined }} — reload: the
 *   changes read again, against the base chosen last; summary: the branch against its base, for the panel's header
 */
export function createChangesView({ load, loadDiff, openFile }) {
  const element = h('div', { className: 'changes' });
  /** @type {string | undefined} */
  let chosen;
  /** @type {BranchChanges | undefined} */
  let shown;

  const reload = async () => {
    const changes = await load(chosen);
    shown = changes;
    if (changes === undefined) {
      element.replaceChildren(message("Could not get the branch's changes from the viewer."));
      return;
    }
    if (!changes.ok) {
      element.replaceChildren(message(refusals[changes.error]));
      return;
    }
    const base = baseChoice(changes);
    base.addEventListener('change', () => {
      chosen = base.value;
      void reload();
    });
    element.replaceChildren(
      h('div', { className: 'changes-head' }, [h('span', { className: 'changes-branch', text: changes.branch ?? 'HEAD' }), h('span', { className: 'changes-against', text: 'since' }), base]),
      h('div', { className: 'changes-facts', text: factsOf(changes) }),
      ...commitList(changes),
      h(
        'ul',
        { className: 'changes-files' },
        changes.files.map((file) => h('li', {}, [fileRow(file, changes, { loadDiff, openFile })])),
      ),
    );
  };

  return {
    element,
    reload,
    summary: () => (shown?.ok === true ? `${shown.branch ?? 'HEAD'} since ${shown.base.name}` : undefined),
  };
}

/**
 * The base to count from, chosen among the repository's branches but the one checked out.
 * @param {Extract<BranchChanges, { ok: true }>} changes
 * @returns {HTMLSelectElement}
 */
function baseChoice(changes) {
  const names = changes.branches.filter((name) => name !== changes.branch);
  const choices = names.includes(changes.base.name) ? names : [changes.base.name, ...names];
  const select = h('select', { className: 'changes-base', title: 'Compare with', attrs: { 'aria-label': 'Compare with' } }, choices.map((name) => h('option', { text: name, attrs: { value: name } })));
  select.value = changes.base.name;
  return select;
}

/**
 * "3 commits · 12 files · +120 −30"
 * @param {Extract<BranchChanges, { ok: true }>} changes
 */
function factsOf(changes) {
  const added = changes.files.reduce((sum, file) => sum + (file.added ?? 0), 0);
  const removed = changes.files.reduce((sum, file) => sum + (file.removed ?? 0), 0);
  return [plural(changes.commits.length, 'commit'), plural(changes.files.length, 'file'), `+${added} −${removed}`].join(' · ');
}

/**
 * The branch's commits, folded; none when it has none — only what is not committed yet.
 * @param {Extract<BranchChanges, { ok: true }>} changes
 * @returns {HTMLElement[]}
 */
function commitList(changes) {
  if (changes.commits.length === 0) return [];
  return [
    h('details', { className: 'changes-commits' }, [
      h('summary', { text: 'Commits' }),
      h(
        'ol',
        {},
        changes.commits.map((commit) => h('li', {}, [h('code', { text: commit.sha.slice(0, 7) }), h('span', { text: commit.subject })])),
      ),
    ]),
  ];
}

/**
 * A changed file: its status, path and lines; opened, its diff since the base.
 * @param {ChangedFile} file
 * @param {Extract<BranchChanges, { ok: true }>} changes
 * @param {Pick<ChangesSource, 'loadDiff' | 'openFile'>} source
 * @returns {HTMLElement}
 */
function fileRow(file, changes, { loadDiff, openFile }) {
  const slash = file.path.lastIndexOf('/');
  const open = h('button', { className: 'icon-button change-open', title: 'Open the file', attrs: { type: 'button' } }, [icon('read')]);
  open.hidden = file.status === 'deleted';
  open.addEventListener('click', (event) => {
    // the button sits in the row's summary: it opens the file, not the diff
    event.preventDefault();
    openFile(`${changes.root}/${file.path}`);
  });
  const row = h('details', { className: `change change-${file.status}` }, [
    h('summary', { title: file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}` }, [
      h('span', { className: 'change-status', text: letters[file.status] }),
      h('span', { className: 'change-path' }, [h('span', { className: 'change-dir', text: file.path.slice(0, slash + 1) }), h('span', { className: 'change-name', text: file.path.slice(slash + 1) })]),
      h('span', { className: 'change-lines', text: file.added === undefined ? '' : `+${file.added} −${file.removed ?? 0}` }),
      open,
    ]),
  ]);
  let asked = false;
  row.addEventListener('toggle', () => {
    if (!row.open || asked) return;
    asked = true;
    row.append(message('Loading…'));
    void loadDiff(changes.base.sha, file).then((diff) => {
      row.lastElementChild?.remove();
      row.append(diffBody(diff, file.path));
    });
  });
  return row;
}

/**
 * @param {FileDiff | undefined} diff
 * @param {string} path
 * @returns {HTMLElement}
 */
function diffBody(diff, path) {
  if (diff === undefined || !diff.ok) return message('Could not get the diff from the viewer.');
  if (diff.binary) return message('A binary file: no lines to show.');
  if (diff.rows.length === 0) return message('No lines changed.');
  const table = diffTable(diff.rows, languageOfPath(path), drawnRows);
  return diff.rows.length > drawnRows ? h('div', {}, [table, message(`${diff.rows.length - drawnRows} more lines are not shown.`)]) : table;
}

/**
 * @param {number} count
 * @param {string} noun
 */
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** @param {string} text */
function message(text) {
  return h('div', { className: 'panel-message', text });
}
