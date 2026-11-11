import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleGraph } from '../server/module-graph.js';

// The modules a page loads at its start: those its first one imports outright, and what they import, over and over —
// by a relative path, or by a name an import map gives — each read once; not one imported when asked, import(), nor
// one whose name leads nowhere the page loads
test('moduleGraph_Should_ReachTheModulesImportedOutright_OverAndOver_EachReadOnce', async () => {
  /** @type {Record<string, string>} */
  const files = {
    '/app.js': "import { feed } from './view/feed.js';\nimport { marked } from 'marked';\nimport { readFile } from 'node:fs';\nexport { feed, marked, readFile };\n",
    '/view/feed.js': "import {\n  format,\n} from '../model/format.js';\nimport { feed as again } from './feed.js';\nconst lazy = () => import('./lazy.js');\nexport const feed = () => format(lazy, again);\n",
    '/model/format.js': 'export const format = (x) => String(x);\n',
    '/view/lazy.js': 'export const lazy = 1;\n',
    '/vendor/marked.js': 'export const marked = (text) => text;\n',
  };
  /** @type {string[]} */
  const read = [];

  const graph = await moduleGraph(['/app.js'], {
    read: async (address) => {
      read.push(address);
      const text = files[address];
      if (text === undefined) throw new Error(`no module at ${address}`);
      return text;
    },
    follow: (specifier, importer) => (specifier.startsWith('.') ? new URL(specifier, `https://page.example${importer}`).pathname : specifier === 'marked' ? '/vendor/marked.js' : undefined),
  });

  assert.deepEqual({ reached: [...graph.keys()].sort(), readOnce: read.length === new Set(read).size, held: graph.get('/model/format.js') }, { reached: ['/app.js', '/model/format.js', '/vendor/marked.js', '/view/feed.js'], readOnce: true, held: 'export const format = (x) => String(x);\n' });
});
