// Chỉ dùng khi chạy ở máy: `npm start` → http://localhost:3000
// (Trên Vercel: public/ là trang tĩnh, api/index.js là function — file này không được deploy.)
// Dữ liệu lưu ở database/truc-nhat.sqlite (hoặc Turso nếu đặt TURSO_DATABASE_URL).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import apiHandler from '../api/index.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return apiHandler(req, res);
  try {
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '') || 'index.html';
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) throw new Error('forbidden');
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`Lịch trực nhật: http://localhost:${PORT}`));
