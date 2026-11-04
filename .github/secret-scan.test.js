'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { scanText, scanRepo } = require('./secret-scan');

let calls = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  calls += 1;
}

function rules(text) {
  return scanText(text).map((hit) => hit.rule);
}

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function jwt(payload) {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.${'x'.repeat(16)}`;
}

function main() {
  ok(rules('CREATE ROLE service_role NOLOGIN;').length === 0, 'role name is not a credential');
  ok(rules("SET ROLE service_role; SELECT 1;").length === 0, 'set role is not a credential');
  ok(rules('REVOKE ALL FROM service_role;').length === 0, 'revoke names the role');
  const serviceEnv = 'SUPABASE_SERVICE' + '_ROLE';
  ok(rules('# ' + serviceEnv + '=').length === 0, 'empty assignment is not a credential');
  ok(rules('# Okuyucu adresi service_role değildir.').length === 0, 'comment names the role');
  ok(
    rules(`service_role # ${'vcp_'}${'a'.repeat(20)}`).includes('vercel_token'),
    'role comment does not hide a token'
  );

  const secret = 'sb_secret_' + 'a'.repeat(8);
  ok(rules(`key=${secret}`).includes('supabase_secret'), 'sb_secret_ is a credential');
  ok(rules('sb_publishable_' + 'a'.repeat(8)).length === 0, 'publishable prefix is not this rule');

  const serviceJwt = jwt({ iss: 'supabase', role: 'service_role', ref: 'example' });
  ok(rules(serviceJwt).includes('service_role_jwt'), 'service_role JWT payload is a credential');
  ok(rules(serviceEnv + '_KEY=' + serviceJwt).includes('service_role_assignment'), 'assignment with a value is a credential');
  ok(rules(jwt({ iss: 'supabase', role: 'anon', ref: 'example' })).length === 0, 'anon JWT is not a service credential');
  ok(rules(jwt({ role: 'authenticated' })).length === 0, 'authenticated JWT is not a service credential');

  ok(rules('vcp_' + 'b'.repeat(20)).includes('vercel_token'), 'vercel token shape');
  ok(rules('ghp_' + 'c'.repeat(20)).includes('github_pat'), 'github pat shape');
  ok(rules('github_pat_' + 'd'.repeat(20)).includes('github_fine_grained'), 'fine grained pat shape');
  ok(rules('-----BEGIN ' + 'PRIVATE KEY-----').includes('private_key'), 'private key block');
  ok(rules('VERCEL_' + 'TOKEN=' + 'e'.repeat(8)).includes('vercel_assignment'), 'vercel assignment');

  const root = path.join(__dirname, '..');
  const config = fs.readFileSync(path.join(root, 'js', 'supabase-config.js'), 'utf8');
  ok(!rules(config).includes('service_role_jwt'), 'committed anon key is not a service_role JWT');

  const repoHits = scanRepo(root);
  ok(repoHits.length === 0, 'tracked tree has no credential-shaped hit');

  console.log(`secret-scan: ${calls} passed`);
}

main();
