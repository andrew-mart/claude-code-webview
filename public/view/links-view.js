// @ts-check
// A file's links in the side panel: what it imports — each import's path as written, and the file it leads to, or that
// it is a package's, or a file not there — and the files that import it, at the line of the import. Each opens in the
// panel.
import { h } from './dom.js';

/**
 * @typedef {import('../model/project.js').FileLinks} FileLinks
 * @typedef {import('./file-links.js').FileTarget} FileTarget
 * @typedef {{ path: string, root: string, load: () => Promise<FileLinks | undefined>, openFile: (target: FileTarget) => void, iconOf: import('./file-icons.js').IconOf }} LinksSource
 *   — path: the file's; root: its project's folder, the paths shown are from it; iconOf: a file's icon
 */

/** @type {Readonly<Record<string, string>>} */
const refusals = {
  'not-absolute': 'The path is not absolute.',
  'not-found': 'The file is not there: deleted, or renamed.',
  'too-large': 'The file is larger than 2 MB: its imports are not read.',
  'not-a-folder': "The project's folder is not there.",
};

/**
 * @param {LinksSource} source
 * @returns {{ element: HTMLElement, reload: () => Promise<void>, summary: () => string | undefined }}
 */
export function createLinksView({ path, root, load, openFile, iconOf }) {
  /** @param {string} file */
  const iconOfFile = (file) => iconOf(file.split(/[\\/]/).pop() ?? file, 'file', false);
  const element = h('div', { className: 'links' }, [h('div', { className: 'project-note', text: 'Reading the links…' })]);
  const reload = async () => {
    const links = await load();
    if (links === undefined || !links.ok) {
      element.replaceChildren(h('div', { className: 'project-note', text: links === undefined ? 'Could not get the links from the viewer.' : refusals[links.error] ?? '' }));
      return;
    }
    // a file imported again further on — a type's import of it — is listed once, at its first import
    const firsts = links.imports.filter((link, index) => links.imports.findIndex((other) => other.spec === link.spec) === index);
    const imports = firsts.map((link) => {
      const row = h('button', { className: 'links-row', attrs: { type: 'button' } }, [
        h('span', { className: 'project-line', text: String(link.line) }),
        h('span', { className: 'links-spec', text: link.spec }),
        link.path === undefined
          ? h('span', { className: 'links-target none', text: /^[./]/.test(link.spec) ? 'not found' : 'package' })
          : h('span', { className: 'links-target' }, [iconOfFile(link.path), relativeTo(root, link.path)]),
      ]);
      const target = link.path;
      if (target === undefined) row.disabled = true;
      else row.addEventListener('click', () => openFile({ path: target, line: undefined, endLine: undefined }));
      return row;
    });
    const importers = links.importedBy.map((link) => {
      const row = h('button', { className: 'links-row', title: `${link.path}:${link.line}`, attrs: { type: 'button' } }, [
        h('span', { className: 'links-file' }, [iconOfFile(link.path), relativeTo(root, link.path)]),
        h('span', { className: 'project-line', text: String(link.line) }),
        h('span', { className: 'links-text', text: link.text.trim() }),
      ]);
      row.addEventListener('click', () => openFile({ path: link.path, line: link.line, endLine: undefined }));
      return row;
    });
    element.replaceChildren(
      section('Imports', imports.length === 0 ? [h('div', { className: 'project-note', text: 'None.' })] : imports),
      section('Imported by', [
        ...(importers.length === 0 ? [h('div', { className: 'project-note', text: 'No file of the project imports it.' })] : importers),
        ...(links.more ? [h('div', { className: 'project-note', text: 'The search stopped short: there may be more.' })] : []),
      ]),
    );
  };
  return { element, reload, summary: () => relativeTo(root, path) };
}

/**
 * @param {string} title
 * @param {readonly HTMLElement[]} content
 * @returns {HTMLElement}
 */
function section(title, content) {
  return h('section', { className: 'links-section' }, [h('div', { className: 'project-section-title', text: title }), ...content]);
}

/**
 * @param {string} root
 * @param {string} path
 */
function relativeTo(root, path) {
  return path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]/, '') : path;
}
