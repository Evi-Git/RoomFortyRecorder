// Static server for the build output, plus:
//   GET  /log.gz           the file from --log (the single-page smoke test)
//   POST /ipc/pullDesk     the app's pullDesk IPC, answered by the app's own
//                          PullDesk.handle() against the local guild server
//                          (backend.mjs) when one is given; fixtures first
//                          for what needs the outside world (fixtures.mjs).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureAnswer } from './fixtures.mjs';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

const readJson = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};

const ipcPullDesk = async (req, res, backend) => {
  if (!backend) {
    res.writeHead(404).end('no backend');
    return;
  }
  const request = await readJson(req);
  const real = (r) => backend.desk.handle(r);
  const answer = (await fixtureAnswer(request, real)) ?? (await real(request));
  // A full log is bytes: send them as is, not as a JSON number array.
  if (request.action === 'fullLog' && answer.ok) {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(Buffer.from(answer.data.bytes));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(answer));
};

export const serve = ({ out, log, port = 4173, backend }) => {
  const root = path.resolve(out);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/ipc/pullDesk' && req.method === 'POST') {
      ipcPullDesk(req, res, backend).catch((e) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      });
      return;
    }
    if (url.pathname === '/log.gz') {
      if (!log || !fs.existsSync(log)) {
        res.writeHead(404).end('no --log given');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      fs.createReadStream(log).pipe(res);
      return;
    }
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(root, path.normalize(rel));
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    ) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve(server)),
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > -1 ? process.argv[i + 1] : d;
  };
  const port = Number(arg('port', 4173));
  const out = arg('out', '/tmp/rf-harness-out');
  let backend;
  if (arg('logs')) {
    const { startBackend } = await import('./backend.mjs');
    backend = await startBackend({ out, logsDir: arg('logs'), keep: arg('keep') });
  }
  await serve({ out, log: arg('log'), port, backend });
  console.log(`http://127.0.0.1:${port}/?entry=${backend ? 'app' : 'logs-explorer'}`);
}
