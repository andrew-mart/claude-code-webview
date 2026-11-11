import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createDeskFiles, deskPathIn } from '../server/desk-files.js';
import { createDesks } from '../server/desks.js';
import { moveToDesks } from '../server/desk-migration.js';

/** @param {string} id @param {string} text */
const note = (id, text) => ({ id, text, at: '2026-10-20T09:00:00.000Z', shown: 'inline' });
/** @param {string} path */
const pin = (path) => ({ path, at: '2026-10-20T09:01:00.000Z' });

/**
 * The viewer's files as they were before desks — notes.json, notes-history.json, pins.json in its state folder — under
 * the keys of these folders: shop, its Claude Code project; blog, a Codex session's folder; and a project whose sessions
 * are gone. Shop's sessions run in herdr's "shop" workspace, beside one started in shop's parent.
 */
async function before() {
  const root = tempDir('desk-move-');
  const state = join(root, 'state');
  const shop = join(root, 'dev', 'shop');
  const blog = join(root, 'dev', 'blog');
  for (const folder of [state, shop, blog]) await mkdir(folder, { recursive: true });
  const shopKey = 'D--dev-shop';
  const blogKey = blog.replace(/[^a-zA-Z0-9]/g, '-');
  const goneKey = 'D--dev-gone';
  const files = { notes: join(state, 'notes.json'), history: join(state, 'notes-history.json'), pins: join(state, 'pins.json') };
  /** @type {Record<string, { path: string, at: string }[]>} */
  const pinsKept = { [`folder:${shopKey}`]: [pin(join(shop, 'spec.md'))], 'session:abc': [pin(join(shop, 'own.md'))], [`folder:${goneKey}`]: [pin(join(root, 'dev', 'gone', 'x.md'))] };
  const kept = {
    notes: { [shopKey]: [note('n1', 'Rate limits'), note('n2', 'Release list')], [blogKey]: [note('n3', 'Post ideas')] },
    history: { [shopKey]: [{ id: 's1', at: '2026-10-20T09:00:00.000Z', action: 'add', after: note('n1', 'Rate limits') }] },
    pins: pinsKept,
  };
  await writeFile(files.notes, JSON.stringify(kept.notes));
  await writeFile(files.history, JSON.stringify(kept.history));
  await writeFile(files.pins, JSON.stringify(kept.pins));
  /** @type {readonly import('../server/desk-migration.js').KnownSession[]} */
  const sessions = [
    { id: 'a', agent: 'claude', project: shopKey, cwd: join(shop, 'src'), startedIn: shop },
    { id: 'b', agent: 'claude', project: shopKey, cwd: shop, startedIn: shop },
    { id: 'c', agent: 'codex', project: 'codex', cwd: blog, startedIn: blog },
    { id: 'd', agent: 'claude', project: 'D--dev', cwd: join(root, 'dev'), startedIn: join(root, 'dev') },
  ];
  /** @type {Record<string, string>} */
  const workspaces = { a: 'shop', b: 'shop', d: 'shop' };
  const deskFiles = createDeskFiles();
  /** @type {Record<string, import('../server/desks.js').SessionPlace>} */
  const places = { a: { startedIn: shop, workspace: 'shop' }, d: { startedIn: join(root, 'dev'), workspace: 'shop' }, c: { startedIn: blog, workspace: undefined } };
  const desks = createDesks({ registry: join(state, 'desks.json'), files: deskFiles, limit: 200, place: async (id) => places[id] });
  /** One run of the move, as the viewer does it on starting. */
  const move = () => moveToDesks({ ...files, report: join(state, 'desks-moved.json'), orphans: join(state, 'orphaned'), files: deskFiles, desks, sessions, workspaceOf: (id) => workspaces[id] });
  return { root, state, shop, blog, goneKey, files, kept, desks, deskFiles, move };
}

// Every folder's notes, their history and the files pinned to it go onto a desk in that very folder — a Codex session's
// folder found by its key, a folder whose sessions are gone onto a desk kept by the viewer — nothing lost and counted
// in the report; the files pinned to a session alone stay as they are, and the old files are left untouched
test('moveToDesks_Should_PutEveryFoldersNotesHistoryAndPins_OnDeskInThatFolder_NothingLost', async () => {
  const { state, shop, blog, goneKey, files, kept, deskFiles, move } = await before();

  const report = await move();

  const shopDesk = await deskFiles.read(deskPathIn(shop, 'shop'));
  const blogDesk = await deskFiles.read(deskPathIn(blog, 'blog'));
  const goneDesk = await deskFiles.read(deskPathIn(join(state, 'orphaned', goneKey), goneKey));
  assert.deepEqual(
    {
      shop: { notes: shopDesk?.notes.map((one) => one.text), pins: shopDesk?.pins, steps: shopDesk?.history.length },
      blog: blogDesk?.notes.map((one) => one.text),
      gone: goneDesk?.pins.map((one) => one.path),
      counted: report.moved && report.desks.map(({ notes, pins, steps }) => ({ notes, pins, steps })),
      untouched: [JSON.parse(await readFile(files.notes, 'utf8')), JSON.parse(await readFile(files.pins, 'utf8'))],
    },
    {
      shop: { notes: ['Rate limits', 'Release list'], pins: kept.pins['folder:D--dev-shop'], steps: 1 },
      blog: ['Post ideas'],
      gone: kept.pins[`folder:${goneKey}`]?.map((one) => one.path),
      counted: [
        { notes: 2, pins: 1, steps: 1 },
        { notes: 1, pins: 0, steps: 0 },
        { notes: 0, pins: 1, steps: 0 },
      ],
      untouched: [kept.notes, kept.pins],
    },
  );
});

// After the move, sessions are at the desks of their folders — a herdr workspace at the desk of its sessions with most
// on it, so one started in a folder above sees the same; offered beside a session's own, of those moved only the desks
// kept by the viewer — the others are found in their folders; moved once, the move does not run again, and a run cut short
// and made again adds nothing twice
test('moveToDesks_Should_PutSessionsAtTheirDesks_AndMoveOnceWithoutDoubling', async () => {
  const { shop, blog, deskFiles, desks, move, state } = await before();

  await move();
  const again = await move();
  // cut short: the desks written, the report not
  await rm(join(state, 'desks-moved.json'));
  await move();

  assert.deepEqual(
    {
      shopSession: (await desks.current('a'))?.path,
      aboveInWorkspace: (await desks.current('d'))?.path,
      codex: (await desks.current('c'))?.path,
      codexOffered: (await desks.offered('c')).map((desk) => desk.name),
      again: again.moved,
      notOnceMore: (await deskFiles.read(deskPathIn(shop, 'shop')))?.notes.length,
      pinsNotOnceMore: (await deskFiles.read(deskPathIn(shop, 'shop')))?.pins.length,
    },
    { shopSession: deskPathIn(shop, 'shop'), aboveInWorkspace: deskPathIn(shop, 'shop'), codex: deskPathIn(blog, 'blog'), codexOffered: ['blog', 'D--dev-gone'], again: false, notOnceMore: 2, pinsNotOnceMore: 1 },
  );
});
