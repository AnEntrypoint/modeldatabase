#!/usr/bin/env node
// Minimal static server for ../modeldatabase.
// Serves only the HTML/runtime files, compact index, thumbs.pack routes,
// and proxies arbitrary CLIP text queries to the local Python service.
import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ThumbsPack} from '../src/thumbs-pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8712);
const host = process.env.HOST || '127.0.0.1';
const args = process.argv.slice(2);
const isolated = args.includes('--cross-origin-isolation');
const packArg = args.indexOf('--thumbs-pack');
const descriptor = JSON.parse(await readFile(path.join(root, 'thumbs-pack.json'), 'utf8'));
const packPath = packArg >= 0 ? path.resolve(args[packArg + 1]) : descriptor.source;
const pack = new ThumbsPack(packPath, descriptor);
await pack.open();
const clipTarget = process.env.CLIP_TEXT_SERVICE || 'http://127.0.0.1:8794/embed';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.br': 'application/jsonl; charset=utf-8',
  '.bin': 'application/octet-stream', '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp', '.wasm': 'application/wasm',
};

function baseHeaders(headers = {}) {
  if (isolated) {
    headers['cross-origin-opener-policy'] = 'same-origin';
    headers['cross-origin-embedder-policy'] = 'require-corp';
    headers['cross-origin-resource-policy'] = 'same-origin';
  }
  return headers;
}

function send(res, status, headers, body) {
  res.writeHead(status, baseHeaders(headers)).end(body);
}

function notFound(res) {
  send(res, 404, {'content-type': 'text/plain; charset=utf-8'}, 'not found');
}

async function serveClipEmbed(req, res, url) {
  if (url.pathname !== '/clip/embed') return false;
  if (req.method !== 'POST') {
    send(res, 405, {'content-type': 'application/json', 'allow': 'POST'}, JSON.stringify({ok: false, error: 'POST required'}));
    return true;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    const upstream = await fetch(clipTarget, {
      method: 'POST', headers: {'content-type': 'application/json'}, body: body || '{}',
    });
    const text = await upstream.text();
    send(res, upstream.status, {'content-type': 'application/json', 'cache-control': 'no-store'}, text);
  } catch (error) {
    send(res, 502, {'content-type': 'application/json'}, JSON.stringify({ok: false, error: String(error?.message || error), target: clipTarget}));
  }
  return true;
}

async function servePack(req, res, url) {
  const match = url.pathname.match(/^\/thumb\/pack\/([0-9a-f]{64})(?:\/([0-6]))?$/);
  if (!match) return false;
  const found = await pack.blob(match[1]);
  if (!found) { notFound(res); return true; }
  const headers = {
    'content-type': 'image/webp', 'content-length': found.bytes.length,
    'cache-control': 'no-store', 'x-thumbs-pack': descriptor.sha256.slice(0, 12),
  };
  if (match[2] !== undefined) {
    const view = Number(match[2]);
    const css = `background-size:${pack.header.grid_w * pack.header.tile}px ${pack.header.grid_h * pack.header.tile}px;` +
      `background-position:${-(view % pack.header.grid_w) * pack.header.tile}px -${Math.floor(view / pack.header.grid_w) * pack.header.tile}px`;
    headers['x-thumbs-view'] = String(view);
    headers['x-thumbs-css'] = css;
  }
  send(res, 200, headers, req.method === 'HEAD' ? undefined : found.bytes);
  return true;
}

function sendFile(req, res, full, info) {
  const volatile = full.endsWith('index.html') || full.includes(`${path.sep}assets${path.sep}`) ||
    /\.(js|mjs|html)$/.test(full);
  const headers = {
    'content-type': types[path.extname(full)] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': volatile ? 'no-store' : 'public, max-age=86400',
    'accept-ranges': 'bytes',
  };
  if (full.endsWith('.jsonl.br')) headers['content-encoding'] = 'br';
  if (full.endsWith('.jsonl.br')) headers['vary'] = 'accept-encoding';
  res.writeHead(200, baseHeaders(headers));
  if (req.method === 'HEAD') return res.end();
  createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${host}:${port}`);
    if (await serveClipEmbed(req, res, url)) return;
    if (url.pathname === '/thumbs-pack.json' || url.pathname === '/thumbs-pack') {
      const body = await readFile(path.join(root, 'thumbs-pack.json'));
      send(res, 200, {'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store'}, body);
      return;
    }
    if (url.pathname === '/thumb/pack/first') {
      const hash = await pack.firstHash();
      const body = Buffer.from(JSON.stringify({hash, sheet: `/thumb/pack/${hash}`, view0: `/thumb/pack/${hash}/0`, count: pack.header.count}));
      send(res, 200, {'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store'}, body);
      return;
    }
    if (url.pathname.startsWith('/thumb/pack/')) {
      if (await servePack(req, res, url)) return;
      notFound(res); return;
    }
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const full = path.resolve(root, `.${rel}`);
    if (!full.startsWith(root + path.sep) && full !== path.join(root, 'index.html')) {
      send(res, 403, {'content-type': 'text/plain; charset=utf-8'}, 'forbidden'); return;
    }
    const info = await stat(full);
    if (!info.isFile()) throw new Error('not a file');
    sendFile(req, res, full, info);
  } catch {
    notFound(res);
  }
});

server.listen(port, host, () => console.log(JSON.stringify({
  ready: true, url: `http://${host}:${port}/`, root,
  thumbs_pack: packPath, pack_models: pack.header.count,
  clip_text_service: clipTarget, cross_origin_isolation: isolated,
})));
