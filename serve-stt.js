/**
 * serve-stt.js — lightweight static server for stt.html + stt.js
 *
 * Run with:  node serve-stt.js
 *            npm run stt:ui
 *
 * Opens at:  http://localhost:3002
 *
 * Serves every file in the project root directory.
 * Also exposes GET /api/config so the browser can pre-load the API key
 * from .env without you having to paste it manually.
 */

import http from 'node:http';
import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Read API key from environment or .env ──────────────────────────────────
let apiKey = process.env.ELEVENLABS_API_KEY || '';

if (!apiKey) {
  try {
    const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const raw of envText.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('ELEVENLABS_API_KEY=')) {
        apiKey = line.slice('ELEVENLABS_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
        break;
      }
    }
  } catch { /* .env not found — that's fine */ }
}

// ── MIME types ─────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const PORT = Number(process.env.STT_PORT) || 3002;

// ── Server ─────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors());
    res.end();
    return;
  }

  // Config endpoint — returns the API key so the UI can pre-fill it
  if (urlPath === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors() });
    res.end(JSON.stringify({ apiKey }));
    return;
  }

  // Static file serving
  const relativePath = urlPath === '/' ? 'stt.html' : urlPath.replace(/^\//, '');
  const filePath     = path.resolve(__dirname, relativePath);

  // Security: only serve files inside the project directory
  if (!filePath.startsWith(__dirname + path.sep) && filePath !== __dirname) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...cors() });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Not found: ${urlPath}`);
  }
});

function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n════════════════════════════════════════════════════');
  console.log(`  🎙️  ElevenLabs STT  →  http://localhost:${PORT}`);
  console.log(`  Open that URL in your browser to start transcribing.`);
  if (apiKey) {
    console.log('  🔑 API key loaded from .env (auto-filled in UI).');
  } else {
    console.log('  ⚠️  No ELEVENLABS_API_KEY in .env — enter it in the UI.');
  }
  console.log('════════════════════════════════════════════════════\n');
  console.log('Press Ctrl+C to stop the server.\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${PORT} is already in use.`);
    console.error(`    Try:  STT_PORT=3003 node serve-stt.js\n`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
