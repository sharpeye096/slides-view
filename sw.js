// Invoco Zip Browser - Service Worker
// Intercepts /browse/view/* requests and serves files from an in-memory virtual filesystem.

const files = new Map(); // path -> { content: ArrayBuffer, mimeType: string }

const MIME_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
};

function getMimeType(path) {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = path.substring(dot).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  if (type === 'LOAD_FILES') {
    files.clear();
    for (const [path, content] of Object.entries(data)) {
      files.set(path, {
        content,
        mimeType: getMimeType(path),
      });
    }
    event.ports[0]?.postMessage({ type: 'LOADED', count: files.size });
  }

  if (type === 'CLEAR_FILES') {
    files.clear();
    event.ports[0]?.postMessage({ type: 'CLEARED' });
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const prefix = '/browse/view/';

  if (!url.pathname.startsWith(prefix)) return;

  const path = url.pathname.substring(prefix.length);

  const file = files.get(path);
  if (file) {
    event.respondWith(
      new Response(file.content, {
        status: 200,
        headers: {
          'Content-Type': file.mimeType,
          'Cache-Control': 'no-cache',
        },
      })
    );
  } else {
    event.respondWith(
      new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } })
    );
  }
});
