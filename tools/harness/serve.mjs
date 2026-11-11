// Static server for the build output, plus GET /log.gz (the file from --log).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

export const serve = ({ out, log, port = 4173 }) => {
  const root = path.resolve(out);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
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
  await serve({
    out: arg('out', '/tmp/rf-harness-out'),
    log: arg('log'),
    port,
  });
  console.log(`http://127.0.0.1:${port}/?entry=logs-explorer`);
}
