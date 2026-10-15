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
