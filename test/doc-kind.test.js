import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docKindOfPath } from '../public/model/doc-kind.js';

// The panel shows a file by what it is, told by its extension in any case: a document drawn as a document, a picture,
// a table, text — anything else as code
test('docKindOfPath_Should_TellKindByExtension', () => {
  const paths = [
    'D:/dev/x/README.md', 'D:/dev/x/notes.MARKDOWN', 'D:/dev/x/a.mdown',
    'D:/dev/x/rates.csv', 'D:/dev/x/rates.tsv',
    'D:/dev/x/notes.txt', 'D:/dev/x/app.log',
    'D:/dev/x/page.html', 'D:/dev/x/page.HTM',
    'D:/dev/x/spec.pdf', 'D:/dev/x/brief.docx',
    'D:/dev/x/shot.png', 'D:/dev/x/photo.JPG',
    'D:/dev/x/App.cs', 'D:/dev/x/Makefile', 'D:/dev/x/old.doc',
  ];

  assert.deepEqual(paths.map(docKindOfPath), [
    'markdown', 'markdown', 'markdown',
    'csv', 'csv',
    'text', 'text',
    'html', 'html',
    'pdf', 'docx',
    'image', 'image',
    'code', 'code', 'code',
  ]);
});
