// A stand-in for VS Code's `code serve-web`: it takes the same options, answers under its base path only with its
// connection token, tells what a request carried, and on a WebSocket echoes what it gets. /…/exit stops it; /…/page
// answers as VS Code's page does: the address it tells the page to connect to, and the cookies it leaves.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { parseArgs } from 'node:util';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    host: { type: 'string' },
    port: { type: 'string' },
    'connection-token-file': { type: 'string' },
    'server-base-path': { type: 'string' },
    'accept-server-license-terms': { type: 'boolean' },
    'disable-telemetry': { type: 'boolean' },
  },
});
if (positionals[0] !== 'serve-web') process.exit(2);
const token = readFileSync(values['connection-token-file'] ?? '', 'utf8').trim();
const basePath = values['server-base-path'] ?? '/';
const tokenOf = (/** @type {http.IncomingMessage} */ request) => /(?:^|;\s*)vscode-tkn=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];

const server = http.createServer((request, response) => {
  if (tokenOf(request) !== token) return void response.writeHead(403).end('Forbidden');
  if (!(request.url ?? '').startsWith(`${basePath}/`)) return void response.writeHead(404).end();
  if (request.url === `${basePath}/page`) {
    // VS Code's own rule: the forwarded host, else the host asked
    const remoteAuthority = request.headers['x-forwarded-host'] ?? request.headers.host;
    const cookies = [`vscode-tkn=${token}; Max-Age=604800; SameSite=Lax`, 'vscode-secret-key-path=/vscode/_vscode-cli/mint-key; SameSite=Strict; Path=/'];
    return void response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': cookies }).end(JSON.stringify({ remoteAuthority }));
  }
  if (request.url === `${basePath}/exit`) {
    response.end('bye');
    process.exit(0);
  }
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ method: request.method, url: request.url, host: request.headers.host, origin: request.headers.origin, body }));
  });
});
server.on('upgrade', (request, socket) => {
  if (tokenOf(request) !== token) return void socket.destroy();
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Seen-Origin: ${request.headers.origin ?? '-'}\r\nX-Seen-Host: ${request.headers.host ?? '-'}\r\n\r\n`);
  socket.on('data', (chunk) => socket.write(chunk));
});
server.listen(Number(values.port), values.host, () => console.log(`Web UI available at http://${values.host}:${values.port}${basePath}`));
