// @ts-check
// The language a file is written in, by its name, for the editor to colour it: its extension, or a name of its own.

/**
 * @typedef {'javascript' | 'jsx' | 'typescript' | 'tsx' | 'json' | 'python' | 'css' | 'html' | 'markdown' | 'sql' | 'xml' | 'yaml' | 'rust' | 'go' | 'java' | 'kotlin' | 'scala' | 'cpp' | 'csharp' | 'php' | 'shell' | 'powershell' | 'toml' | 'dockerfile' | 'properties' | 'lua' | 'ruby' | 'diff' | 'nginx'} CodeLanguage
 */

/** @type {Readonly<Record<string, CodeLanguage>>} */
const byExtension = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'json',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  xml: 'xml',
  xaml: 'xml',
  svg: 'xml',
  csproj: 'xml',
  fsproj: 'xml',
  vbproj: 'xml',
  props: 'xml',
  targets: 'xml',
  resx: 'xml',
  nuspec: 'xml',
  config: 'xml',
  plist: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hh: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  csx: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  toml: 'toml',
  dockerfile: 'dockerfile',
  ini: 'properties',
  cfg: 'properties',
  properties: 'properties',
  env: 'properties',
  editorconfig: 'properties',
  gitconfig: 'properties',
  lua: 'lua',
  rb: 'ruby',
  diff: 'diff',
  patch: 'diff',
};

/** Files a name of their own tells the language of. */
/** @type {Readonly<Record<string, CodeLanguage>>} */
const byName = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'shell',
  '.bashrc': 'shell',
  '.bash_profile': 'shell',
  '.profile': 'shell',
  '.zshrc': 'shell',
  gemfile: 'ruby',
  rakefile: 'ruby',
  'nginx.conf': 'nginx',
};

/** Names a code block's language goes by besides its files' extensions and its own name. */
/** @type {Readonly<Record<string, CodeLanguage>>} */
const byFenceName = {
  'c#': 'csharp',
  dotnet: 'csharp',
  'c++': 'cpp',
  c: 'cpp',
  js: 'javascript',
  node: 'javascript',
  py: 'python',
  python3: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  console: 'shell',
  pwsh: 'powershell',
  ps: 'powershell',
  yml: 'yaml',
  docker: 'dockerfile',
  rs: 'rust',
  golang: 'go',
  kt: 'kotlin',
  rb: 'ruby',
  patch: 'diff',
  ini: 'properties',
};

/** The languages by their own names. */
const languages = new Set(Object.values(byExtension));

/**
 * The language a code block's first line names after its ``` — its name, an alias, a file's extension; any case, what
 * follows a space left out.
 * @param {string} info — the words after the ```
 * @returns {CodeLanguage | undefined} — none: plain text, or a language not known
 */
export function languageOfFence(info) {
  const word = (info.trim().split(/\s+/)[0] ?? '').toLowerCase();
  if (Object.hasOwn(byFenceName, word)) return byFenceName[word];
  if (Object.hasOwn(byExtension, word)) return byExtension[word];
  return [...languages].find((language) => language === word);
}

/**
 * @param {string} path — a file's, either kind of slashes
 * @returns {CodeLanguage | undefined} — none: plain text
 */
export function languageOfPath(path) {
  const name = (path.split(/[\\/]/).pop() ?? path).toLowerCase();
  if (Object.hasOwn(byName, name)) return byName[name];
  // .env: a name that is all extension
  const extension = name.slice(name.lastIndexOf('.') + 1);
  return name.includes('.') && Object.hasOwn(byExtension, extension) ? byExtension[extension] : undefined;
}
