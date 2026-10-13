// @ts-check
// What a file is, for the right-hand panel to show it as such: by its extension, in any case.
import { imageTypeOfPath } from './file-ref.js';

/**
 * @typedef {'markdown' | 'csv' | 'text' | 'html' | 'pdf' | 'docx' | 'image' | 'code'} DocKind — code: any other file,
 *   its text shown as it is
 */

/** @type {ReadonlyMap<string, DocKind>} */
const kindByExtension = new Map([
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['mdown', 'markdown'],
  ['csv', 'csv'],
  ['tsv', 'csv'],
  ['txt', 'text'],
  ['log', 'text'],
  ['html', 'html'],
  ['htm', 'html'],
  ['pdf', 'pdf'],
  ['docx', 'docx'],
]);

/**
 * @param {string} path
 * @returns {DocKind}
 */
export function docKindOfPath(path) {
  if (imageTypeOfPath(path) !== undefined) return 'image';
  const extension = /\.(\w+)$/.exec(path)?.[1]?.toLowerCase();
  return (extension === undefined ? undefined : kindByExtension.get(extension)) ?? 'code';
}
