import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
assert.equal(config.name, 'cuevacoin', 'Wrangler Worker name mismatch');
assert.equal(config.assets?.directory, './', 'Unexpected Worker assets target');

console.log('PASS — Worker name and assets target match CuevaCoin');
