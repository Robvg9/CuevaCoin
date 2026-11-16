import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = 'https://cuevacoin.robvg9.workers.dev';
const files = [
  { local: 'index.html', remote: '/' },
  { local: 'service-worker.js', remote: '/service-worker.js' },
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const file of files) {
  const local = readFileSync(file.local);
  const url = new URL(file.remote, base);
  url.searchParams.set('aria_release_verify', process.env.RELEASE_SHA || 'unknown');
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    signal: AbortSignal.timeout(20000),
  });

  assert.equal(response.status, 200, `LIVE ${file.remote} returned HTTP ${response.status}`);
  const remote = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(remote), hash(local), `LIVE hash mismatch for ${file.remote}`);
  console.log(`PASS — LIVE ${file.remote} SHA256=${hash(remote)}`);
}

console.log(`PASS — CuevaCoin Worker LIVE source parity verified for release ${process.env.RELEASE_SHA}`);
