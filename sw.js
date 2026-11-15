self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.endsWith('/compact-index/models.meta.jsonl.br')) return;
  event.respondWith((async () => {
    const request = new Request(event.request, { headers: new Headers(event.request.headers), cache: 'no-store' });
    request.headers.set('Accept-Encoding', 'identity');
    const upstream = await fetch(request);
    const bytes = await upstream.arrayBuffer();
    const headers = new Headers(upstream.headers);
    headers.set('Content-Encoding', 'br');
    headers.set('Content-Type', 'application/jsonl');
    headers.set('Content-Length', String(bytes.byteLength));
    return new Response(bytes, { status: upstream.status, statusText: upstream.statusText, headers });
  })());
});
