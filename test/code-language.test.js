import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageOfPath } from '../public/model/code-language.js';

// The editor colours a file by the language its name tells — its extension, or a name of its own — on either kind of
// path, in any case; a file whose name tells none is plain text, a name like an object's own property too
test('languageOfPath_Should_TellLanguageByExtensionOrName', () => {
  const paths = [
    'D:\\dev\\shop\\src\\Orders.cs',
    '/home/ann/shop/src/limits.ts',
    '/home/ann/shop/src/Page.tsx',
    '/home/ann/shop/bin/run.mjs',
    'D:/dev/shop/README.MD',
    '/home/ann/shop/Dockerfile',
    '/home/ann/shop/deploy/api.dockerfile',
    '/home/ann/shop/.env',
    '/home/ann/shop/scripts/deploy.ps1',
    '/home/ann/shop/scripts/build.sh',
    '/home/ann/shop/.bashrc',
    '/home/ann/shop/Cargo.toml',
    '/home/ann/shop/Shop.csproj',
    '/home/ann/shop/docker-compose.yml',
    '/home/ann/shop/src/main.py',
    '/home/ann/shop/Gemfile',
    '/home/ann/shop/LICENSE',
    '/home/ann/shop/odd.constructor',
  ];

  assert.deepEqual(paths.map(languageOfPath), [
    'csharp',
    'typescript',
    'tsx',
    'javascript',
    'markdown',
    'dockerfile',
    'dockerfile',
    'properties',
    'powershell',
    'shell',
    'shell',
    'toml',
    'xml',
    'yaml',
    'python',
    'ruby',
    undefined,
    undefined,
  ]);
});
