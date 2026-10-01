import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGameServer } from '../../server/app.js';

test('production serves MP4/WebM with correct MIME, HEAD, and browser ranges', async t => {
  const distDir = await mkdtemp(join(tmpdir(), 'bau-cua-video-'));
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  await Promise.all(['mp4', 'webm'].map(ext => writeFile(join(distDir, `dragon.${ext}`), bytes)));
  const app = await createGameServer({ distDir });
  const address = await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); await rm(distDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${address.port}`;

  for (const ext of ['mp4', 'webm']) {
    const url = `${base}/dragon.${ext}`;
    const full = await fetch(url);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), `video/${ext}`);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);

    const head = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=0-1' } });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '256');
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    for (const [range, start, end] of [['bytes=0-1',0,1], ['bytes=100-',100,255], ['bytes=-8',248,255], ['bytes=250-999',250,255], ['bytes=-999',0,255]]) {
      const part = await fetch(url, { headers: { Range: range } });
      assert.equal(part.status, 206, range);
      assert.equal(part.headers.get('content-range'), `bytes ${start}-${end}/256`);
      assert.equal(Number(part.headers.get('content-length')), end - start + 1);
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(start, end + 1));
    }
    for (const range of ['bytes=256-', 'bytes=20-10', 'bytes=-0']) {
      const invalid = await fetch(url, { headers: { Range: range } });
      assert.equal(invalid.status, 416, range);
      assert.equal(invalid.headers.get('content-range'), 'bytes */256');
      assert.equal((await invalid.arrayBuffer()).byteLength, 0);
    }
    // Multi-range requests are deliberately ignored rather than mis-parsed.
    const multiple = await fetch(url, { headers: { Range: 'bytes=0-1,20-21' } });
    assert.equal(multiple.status, 200);
    assert.deepEqual(Buffer.from(await multiple.arrayBuffer()), bytes);
    const changed = await fetch(url, { headers: { Range: 'bytes=0-1', 'If-Range': '"stale-version"' } });
    assert.equal(changed.status, 200);
    assert.deepEqual(Buffer.from(await changed.arrayBuffer()), bytes);
  }
});
