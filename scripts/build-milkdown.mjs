// Milkdown's Crepe — the notes' editor with blocks, as Notion has them (public/view/note-editor-blocks.js) — bundled into
// one module, and its styles into one file, under public/lib/milkdown. The bundle is kept in the repository: the viewer
// has no build step, and its installs — npm ci --omit=dev, npx — get no dev dependencies. Only the features the notes
// use go in: code blocks, lists, links, the block handle and "/", the toolbar, tables, the placeholder — no formulas,
// pictures or AI. Run after updating @milkdown/crepe or esbuild:
//   node scripts/build-milkdown.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../public/lib/milkdown/', import.meta.url));
/** Each feature's folder in the package, and the name it is exported by. */
const features = [
  ['code-mirror', 'codeMirror'],
  ['list-item', 'listItem'],
  ['link-tooltip', 'linkTooltip'],
  ['cursor', 'cursor'],
  ['block-edit', 'blockEdit'],
  ['toolbar', 'toolbar'],
  ['placeholder', 'placeholder'],
  ['table', 'table'],
];

await build({
  stdin: {
    contents: [
      "export { CrepeBuilder } from '@milkdown/crepe/builder';",
      ...features.map(([folder, name]) => `export { ${name} } from '@milkdown/crepe/feature/${folder}';`),
      "export { replaceAll } from '@milkdown/kit/utils';",
      "export { editorViewCtx } from '@milkdown/kit/core';",
    ].join('\n'),
    resolveDir: root,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  outfile: `${out}crepe.js`,
  logLevel: 'warning',
});

await build({
  stdin: {
    contents: ['prosemirror', 'reset', ...features.map(([folder]) => folder)].map((sheet) => `@import '@milkdown/crepe/theme/common/${sheet}.css';`).join('\n'),
    resolveDir: root,
    loader: 'css',
  },
  bundle: true,
  minify: true,
  outfile: `${out}crepe.css`,
  logLevel: 'warning',
});
console.log(`Built ${out}crepe.js and crepe.css`);
