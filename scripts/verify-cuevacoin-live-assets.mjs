import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const base = 'https://cuevacoin.robvg9.workers.dev';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const live = new Map();
const timeout = AbortSignal.timeout(20000);

for (const path of ['/', '/service-worker.js']) {
  const url = new URL(path, base);
  url.searchParams.set('aria_asset_e2e', process.env.GITHUB_SHA || 'pull-request');
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    signal: timeout,
  });
  assert.equal(response.status, 200, `LIVE ${path} returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 100, `LIVE ${path} returned an empty or unexpectedly short response`);
  live.set(path, bytes);
  console.log(`PASS — LIVE ${path} is available (HTTP 200, SHA256=${hash(bytes)})`);
}

const forbidden = [
  '/.git/config',
  '/.git/index',
  '/.git/logs/HEAD',
  '/.git/hooks/commit-msg.sample',
  '/.wrangler/tmp/deploy-g6ghaL/no-op-worker.js',
  '/.assetsignore',
];

const liveIndexHash = hash(live.get('/'));
for (const path of forbidden) {
  const url = new URL(path, base);
  url.searchParams.set('aria_asset_e2e', process.env.GITHUB_SHA || 'pull-request');
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  const body = Buffer.from(await response.arrayBuffer());
  const isSpaFallback = response.status === 200 && hash(body) === liveIndexHash;
  assert.ok(
    response.status === 403 || response.status === 404 || response.status === 410 || isSpaFallback,
    `Potential internal asset exposure: ${path} returned HTTP ${response.status} and SHA256=${hash(body)}`,
  );
  console.log(`PASS — ${path} is not served as an internal file (HTTP ${response.status}${isSpaFallback ? ', SPA fallback only' : ''})`);
}
