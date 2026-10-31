import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement });
const { createFileEditor } = await import('../public/view/file-editor.js');

/**
 * @typedef {{ text: string, line: number | undefined, typed: (text: string) => void }} FakeEditor — typed: as the user
 *   types the whole text over
 */

/**
 * A viewer serving files from a map of path → text, each with its version — the text's count of writes — and the
 * panel's editor over it, an editor that keeps its text as typed — written its own way as it takes the file, unless told
 * not to — with a code's tools, unless told it edits prose.
 * @param {Record<string, string>} files
 * @param {{ writes: (text: string) => string, tools: 'code' | 'prose' }} [kind]
 */
function editing(files, { writes, tools } = { writes: (same) => same, tools: 'code' }) {
  /** @type {Map<string, { text: string, version: number }>} */
  const disk = new Map(Object.entries(files).map(([path, text]) => [path, { text, version: 1 }]));
  /** @type {unknown[]} */
  const saves = [];
  /** @type {FakeEditor | undefined} */
  let editor;
  /** Every editor made, and whether it was let go of. @type {{ text: string, disposed: boolean }[]} */
  const madeEditors = [];
  /** The word at the editor's cursor. @type {string | undefined} */
  let word;
  /** The names looked for in the project: what for, the name, the file. @type {string[][]} */
  const named = [];
  /** @param {unknown} body @param {number} [status] */
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  /** @type {(url: string, init?: RequestInit) => Promise<Response>} */
  const fetchFile = async (url, init) => {
    const address = new URL(url, 'http://localhost/');
    if (address.pathname === '/api/file') {
      const file = disk.get(address.searchParams.get('path') ?? '');
      return file === undefined ? reply({ ok: false, error: 'not-found' }, 404) : reply({ ok: true, content: file.text, version: `v${file.version}` });
    }
    const body = JSON.parse(String(init?.body));
    saves.push({ body, headers: init?.headers });
    const file = disk.get(body.path);
    if (file === undefined) return reply({ ok: false, error: 'not-found' }, 404);
    if (body.version !== `v${file.version}`) return reply({ ok: false, error: 'changed', content: file.text, version: `v${file.version}` }, 409);
    disk.set(body.path, { text: body.content, version: file.version + 1 });
    return reply({ ok: true, version: `v${file.version + 1}` });
  };
  const files_ = createFileEditor({
    onName: (intent, name, path) => named.push([intent, name, path]),
    fetchFile,
    makeEditor: async (_host, { text, line, onChange }) => {
      const made = {
        text: writes(text),
        line,
        /** @param {string} typed */
        typed: (typed) => {
          made.text = typed;
          onChange();
        },
      };
      editor = made;
      const kept = { text, disposed: false };
      madeEditors.push(kept);
      return { tools, text: () => made.text, replace: (value) => (made.text = value), wordAtCursor: () => word, search: () => undefined, undo: () => undefined, redo: () => undefined, focus: () => undefined, dispose: () => (kept.disposed = true) };
    },
  });
  document.body.replaceChildren(files_.element);
  /** @param {string} label */
  const press = (label) => {
    const button = [...files_.element.querySelectorAll('button')].find((one) => one.textContent === label || one.title === label);
    assert.ok(button instanceof window.HTMLButtonElement, `no button ${label}`);
    button.click();
  };
  const status = () => files_.element.querySelector('.code-edit-status')?.textContent ?? '';
  /** Lets the page's promises settle. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** @param {string | undefined} at */
  const cursorOn = (at) => {
    word = at;
  };
  return { files: files_, disk, saves, editor: () => editor, editors: () => madeEditors, press, status, settle, named, cursorOn };
}

// A file opened for editing shows its text at the line asked for; what is typed is saved from the viewer's page with
// the version read, and the next save goes on from the version saved
test('fileEditor_Should_SaveTypedTextOverVersionRead_AndNextSaveFromVersionSaved', async () => {
  const page = editing({ 'D:/dev/shop/limits.ts': 'export const perSecond = 10;\n' });
  await page.files.open({ path: 'D:/dev/shop/limits.ts', line: 1, endLine: undefined });

  const shown = { text: page.editor()?.text, line: page.editor()?.line };
  page.editor()?.typed('export const perSecond = 20;\n');
  page.press('Save');
  await page.settle();
  const afterFirst = page.status();
  page.editor()?.typed('export const perSecond = 30;\n');
  page.press('Save');
  await page.settle();

  assert.deepEqual(
    { shown, saves: page.saves, afterFirst, disk: page.disk.get('D:/dev/shop/limits.ts') },
    {
      shown: { text: 'export const perSecond = 10;\n', line: 1 },
      saves: [
        { body: { path: 'D:/dev/shop/limits.ts', content: 'export const perSecond = 20;\n', version: 'v1' }, headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' } },
        { body: { path: 'D:/dev/shop/limits.ts', content: 'export const perSecond = 30;\n', version: 'v2' }, headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' } },
      ],
      afterFirst: 'Saved',
      disk: { text: 'export const perSecond = 30;\n', version: 3 },
    },
  );
});

// A markdown file in the notes' editor written its own way — Milkdown's list marks — is the file unchanged as it opens:
// nothing to save, nothing written over it, until it is typed into; then it is saved as the editor writes it
test('fileEditor_Should_TakeFileAsTheEditorWritesIt_ForUnchanged_UntilTypedInto', async () => {
  const page = editing({ 'D:/dev/shop/plan.md': '* one\n' }, { writes: (taken) => taken.replaceAll('* ', '- '), tools: 'prose' });
  await page.files.open({ path: 'D:/dev/shop/plan.md', line: undefined, endLine: undefined });
  const save = [...page.files.element.querySelectorAll('button')].find((one) => one.textContent === 'Save');
  assert.ok(save instanceof window.HTMLButtonElement);

  const opened = { status: page.status(), saving: !save.disabled };
  page.editor()?.typed('- one\n- two\n');
  page.press('Save');
  await page.settle();

  assert.deepEqual(
    { opened, saved: page.saves.map((one) => (one instanceof Object && 'body' in one ? one.body : one)) },
    { opened: { status: '', saving: false }, saved: [{ path: 'D:/dev/shop/plan.md', content: '- one\n- two\n', version: 'v1' }] },
  );
});

// A file of prose — markdown in the notes' editor — has no code's tools over it: no finding and replacing, no
// definitions or uses to look for; its Save, ↶ and ↷ stay
test('fileEditor_Should_LeaveCodesToolsOut_ForProse', async () => {
  const code = editing({ 'D:/dev/shop/limits.ts': 'export const perSecond = 10;\n' });
  const prose = editing({ 'D:/dev/shop/plan.md': '- one\n' }, { writes: (same) => same, tools: 'prose' });
  await code.files.open({ path: 'D:/dev/shop/limits.ts', line: undefined, endLine: undefined });
  await prose.files.open({ path: 'D:/dev/shop/plan.md', line: undefined, endLine: undefined });
  /** @param {ReturnType<typeof editing>} page */
  const tools = (page) => [...page.files.element.querySelectorAll('.code-edit-bar button')].flatMap((one) => (one instanceof window.HTMLButtonElement && !one.hidden ? [one.title] : []));

  assert.deepEqual(
    { code: tools(code), prose: tools(prose) },
    { code: ['Save (Ctrl+S)', 'Undo', 'Redo', 'Find and replace (Ctrl+F)', 'Go to definition', 'Find uses'], prose: ['Save (Ctrl+S)', 'Undo', 'Redo'] },
  );
});

// A file written meanwhile is not saved over: the panel says so, and taking the file's text puts it in the editor —
// nothing left unsaved — or keeping one's own saves it over the file with the next save
test('fileEditor_Should_OfferFilesTextOrOwn_When_FileChangedSinceRead', async () => {
  /** @param {'Take the file’s' | 'Keep mine'} choice */
  const choose = async (choice) => {
    const page = editing({ 'D:/dev/shop/limits.ts': 'export const perSecond = 10;\n' });
    await page.files.open({ path: 'D:/dev/shop/limits.ts', line: undefined, endLine: undefined });
    page.disk.set('D:/dev/shop/limits.ts', { text: 'export const perSecond = 15;\n', version: 2 });
    page.editor()?.typed('export const perSecond = 20;\n');
    page.press('Save');
    await page.settle();
    const said = page.files.element.querySelector('.code-edit-note span')?.textContent;
    page.press(choice);
    page.press('Save');
    await page.settle();
    return { said, editor: page.editor()?.text, disk: page.disk.get('D:/dev/shop/limits.ts')?.text, saves: page.saves.length };
  };

  assert.deepEqual(
    { taken: await choose('Take the file’s'), kept: await choose('Keep mine') },
    {
      taken: { said: 'The file changed since it was opened.', editor: 'export const perSecond = 15;\n', disk: 'export const perSecond = 15;\n', saves: 1 },
      kept: { said: 'The file changed since it was opened.', editor: 'export const perSecond = 20;\n', disk: 'export const perSecond = 20;\n', saves: 2 },
    },
  );
});

// Changes left unsaved — another file opened, the panel closed — are not lost: the file edited again shows them,
// unsaved, over the version they were made on
test('fileEditor_Should_KeepUnsavedChanges_When_LeftForAnotherFile', async () => {
  const page = editing({ 'D:/dev/shop/limits.ts': 'export const perSecond = 10;\n', 'D:/dev/shop/README.md': '# Shop\n' });
  await page.files.open({ path: 'D:/dev/shop/limits.ts', line: undefined, endLine: undefined });
  page.editor()?.typed('export const perSecond = 20;\n');
  await page.files.open({ path: 'D:/dev/shop/README.md', line: undefined, endLine: undefined });
  page.files.leave();

  await page.files.open({ path: 'D:/dev/shop/limits.ts', line: undefined, endLine: undefined });
  const shown = { text: page.editor()?.text, status: page.status() };
  page.press('Save');
  await page.settle();

  assert.deepEqual(
    { shown, saved: page.disk.get('D:/dev/shop/limits.ts') },
    { shown: { text: 'export const perSecond = 20;\n', status: 'Unsaved changes' }, saved: { text: 'export const perSecond = 20;\n', version: 2 } },
  );
});

// A name in the file — the word at the cursor — is looked for in the project: its definition gone to, or its uses
// found; with no name at the cursor the editor says where to put it
test('fileEditor_Should_LookForNameAtCursor_InProject', async () => {
  const page = editing({ 'D:/dev/shop/limits.ts': 'export const perSecond = 10;\n' });
  const files = page.files;
  await files.open({ path: 'D:/dev/shop/limits.ts', line: undefined, endLine: undefined });

  page.cursorOn('perSecond');
  page.press('Go to definition');
  page.press('Find uses');
  page.cursorOn(undefined);
  page.press('Find uses');

  assert.deepEqual(
    { asked: page.named, said: files.element.querySelector('.code-edit-note span')?.textContent },
    { asked: [['definition', 'perSecond', 'D:/dev/shop/limits.ts'], ['uses', 'perSecond', 'D:/dev/shop/limits.ts']], said: 'Put the cursor on a name first.' },
  );
});

// A file opened while another is still being opened takes its place: the first, read meanwhile, is not left editing
// under it
test('fileEditor_Should_EditOnlyTheFileOpenedLast_When_OpenedWhileAnotherOpens', async () => {
  const page = editing({ 'D:/dev/shop/a.ts': 'first', 'D:/dev/shop/b.ts': 'second' });

  await Promise.all([page.files.open({ path: 'D:/dev/shop/a.ts', line: undefined, endLine: undefined }), page.files.open({ path: 'D:/dev/shop/b.ts', line: undefined, endLine: undefined })]);
  await page.settle();

  assert.deepEqual(page.editors().filter((one) => !one.disposed).map((one) => one.text), ['second']);
});
