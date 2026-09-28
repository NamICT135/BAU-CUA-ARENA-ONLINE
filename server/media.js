import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/** Serve a validated, public video path, including browser byte-range requests. */
export async function serveVideo(req, res, file, contentType) {
  const { size } = await stat(file);
  const headers = {
    'Content-Type': contentType,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  let start = 0;
  let end = size - 1;
  let status = 200;
  // Without a matching entity validator, If-Range must receive the full file.
  const range = req.method === 'GET' && !req.headers['if-range'] ? req.headers.range : undefined;
  const match = typeof range === 'string' && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match && (match[1] || match[2])) {
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    } else {
      const suffix = Number(match[2]);
      start = Number.isSafeInteger(suffix) ? Math.max(0, size - suffix) : NaN;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    status = 206;
    headers['Content-Length'] = end - start + 1;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  try {
    await pipeline(createReadStream(file, { start, end }), res);
  } catch (error) {
    // Browsers routinely cancel a range after seeking or leaving the lobby.
    if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE' && error.code !== 'ECONNRESET') throw error;
  }
}
