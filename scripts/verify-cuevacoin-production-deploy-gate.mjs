import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const expectedProject = 'zqgmjwfvluboiporytcq';
assert.equal(process.env.GITHUB_REPOSITORY?.toLowerCase(), 'robvg9/cuevacoin', 'Wrong GitHub repository');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Production deployment must run from main');
assert.equal(process.env.CONFIRMED_PROJECT_REF, expectedProject, 'Project confirmation does not match CuevaCoin');
assert.ok((process.env.CHANGE_SUMMARY || '').trim().length >= 12, 'A meaningful change summary is required');

const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
assert.equal(config.name, 'cuevacoin', 'Wrangler Worker name mismatch');
assert.equal(config.assets?.directory, './', 'Unexpected Worker assets target');
assert.ok(process.env.CLOUDFLARE_API_TOKEN, 'Missing repository secret CUEVACOIN_CLOUDFLARE_API_TOKEN');
assert.ok(process.env.CLOUDFLARE_ACCOUNT_ID, 'Missing repository variable CUEVACOIN_CLOUDFLARE_ACCOUNT_ID');

console.log('PASS — repository, main ref, project identity, deployment summary and Worker target verified');
console.log('PASS — required credential presence verified (secret values are never printed)');
