// Vercel Function: mọi request /api/* được rewrite về đây (xem vercel.json)
import { handleApi, errorResponse, HttpError } from '../lib/api.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel đã parse JSON
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  let status = 200;
  let payload;
  try {
    const url = new URL(req.url, 'http://x');
    // Sau rewrite, đường dẫn gốc có thể nằm ở req.url hoặc ở ?path=
    let rest = url.pathname.replace(/^\/api\/?/, '');
    if (!rest) rest = [].concat(req.query?.path ?? url.searchParams.get('path') ?? '').join('/');
    const parts = rest.split('/').filter(Boolean);
    let body = {};
    if (req.method !== 'GET') {
      try { body = await readBody(req); } catch { throw new HttpError(400, 'JSON không hợp lệ'); }
    }
    payload = await handleApi({ method: req.method, parts, query: url.searchParams, body });
  } catch (e) {
    ({ status, body: payload } = errorResponse(e));
  }
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}
