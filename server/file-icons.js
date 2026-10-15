// @ts-check
// File icons for the page — Material Icon Theme's, as VS Code shows them — from the package installed beside the
// viewer: its choices, the manifest without the icons' own paths (/vendor/file-icons/theme.json), and each icon it
// names (/vendor/file-icons/<name>.svg). Nothing else of the package is served.
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../public/model/narrow.js';

export const fileIconsPrefix = '/vendor/file-icons/';
/** The theme's manifest, for the page's fingerprint. */
export const fileIconsManifest = fileURLToPath(import.meta.resolve('material-icon-theme/dist/material-icons.json'));

/**
 * The theme read once, when it is first asked for.
 * @returns {() => Promise<{ theme: string, icons: ReadonlyMap<string, string> }>} — theme: the page's choices as JSON;
 *   icons: each icon's file, by its name
 */
export function createFileIcons() {
  /** @type {Promise<{ theme: string, icons: ReadonlyMap<string, string> }> | undefined} */
  let read;
  return () => {
    read ??= readTheme();
    return read;
  };
}

/**
 * What an address under the prefix answers: the theme, an icon's file, or nothing.
 * @param {() => Promise<{ theme: string, icons: ReadonlyMap<string, string> }>} icons
 * @param {string} rest — the address past the prefix
 * @returns {Promise<{ kind: 'theme', json: string } | { kind: 'icon', file: string } | undefined>}
 */
export async function fileIconAnswer(icons, rest) {
  const known = await icons();
  if (rest === 'theme.json') return { kind: 'theme', json: known.theme };
  const name = /^([\w.-]+)\.svg$/.exec(rest)?.[1];
  const file = name === undefined ? undefined : known.icons.get(name);
  return file === undefined ? undefined : { kind: 'icon', file };
}

async function readTheme() {
  /** @type {unknown} */
  const manifest = JSON.parse(await readFile(fileIconsManifest, 'utf8'));
  if (!isRecord(manifest) || !isRecord(manifest.iconDefinitions)) throw new Error(`Not an icon theme: ${fileIconsManifest}`);
  // each icon's file, kept inside the package's icons
  const iconsDir = resolve(dirname(fileIconsManifest), '..', 'icons');
  /** @type {Map<string, string>} */
  const icons = new Map();
  for (const [name, definition] of Object.entries(manifest.iconDefinitions)) {
    const path = isRecord(definition) && typeof definition.iconPath === 'string' ? resolve(dirname(fileIconsManifest), definition.iconPath) : undefined;
    if (path !== undefined && path.startsWith(iconsDir + sep) && path.endsWith('.svg')) icons.set(name, path);
  }
  const light = isRecord(manifest.light) ? manifest.light : {};
  const theme = {
    file: manifest.file,
    folder: manifest.folder,
    folderExpanded: manifest.folderExpanded,
    fileNames: manifest.fileNames,
    fileExtensions: manifest.fileExtensions,
    languageIds: manifest.languageIds,
    folderNames: manifest.folderNames,
    folderNamesExpanded: manifest.folderNamesExpanded,
    light: { fileNames: light.fileNames ?? {}, fileExtensions: light.fileExtensions ?? {}, folderNames: light.folderNames ?? {}, folderNamesExpanded: light.folderNamesExpanded ?? {} },
  };
  return { theme: JSON.stringify(theme), icons };
}
