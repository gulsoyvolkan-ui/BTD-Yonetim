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
  ok(rules(serviceEnv).length === 0, 'service env name without a value is not a credential');
  ok(rules('# ' + serviceEnv + '=').length === 0, 'empty assignment is not a credential');
  ok(rules('# Okuyucu adresi service_role değildir.').length === 0, 'comment names the role');
  ok(rules('{"role":"service_role"}').length === 0, 'plain role field is not a jwt');
  const roleOnTokenLine = rules(`service_role # ${'vcp_'}${'a'.repeat(20)}`);
  ok(roleOnTokenLine.includes('vercel_token') && roleOnTokenLine.length === 1, 'role comment does not hide a token');

  const secret = 'sb_secret_' + 'a'.repeat(8);
  ok(rules(`key=${secret}`).includes('supabase_secret'), 'sb_secret_ is a credential');
  ok(rules('sb_publishable_' + 'a'.repeat(8)).length === 0, 'publishable prefix is not this rule');

  const serviceJwt = jwt({ iss: 'supabase', role: 'service_role', ref: 'example' });
  ok(rules(serviceJwt).includes('service_role_jwt'), 'service_role JWT payload is a credential');
  ok(rules(serviceEnv + '_KEY=' + serviceJwt).includes('service_role_assignment'), 'assignment with a value is a credential');
  ok(rules('CREATE ROLE service_role; ' + serviceJwt).includes('service_role_jwt'), 'role line does not hide a service jwt');
  ok(rules(jwt({ iss: 'supabase', role: 'anon', ref: 'example' })).length === 0, 'anon JWT is not a service credential');
  ok(rules(jwt({ role: 'authenticated' })).length === 0, 'authenticated JWT is not a service credential');

  ok(rules('vcp_' + 'b'.repeat(20)).includes('vercel_token'), 'vercel token shape');
  ok(rules('ghp_' + 'c'.repeat(20)).includes('github_pat'), 'github pat shape');
  ok(rules('github_pat_' + 'd'.repeat(20)).includes('github_fine_grained'), 'fine grained pat shape');
  ok(rules('-----BEGIN ' + 'PRIVATE KEY-----').includes('private_key'), 'private key block');
  ok(rules('-----BEGIN ' + 'RSA PRIVATE KEY-----').includes('private_key'), 'rsa private key block');
  ok(rules('-----BEGIN ' + 'OPENSSH PRIVATE KEY-----').includes('private_key'), 'openssh private key block');
  ok(rules('-----BEGIN ' + 'EC PRIVATE KEY-----').includes('private_key'), 'ec private key block');
  ok(rules('sk_live_' + 'f'.repeat(8)).includes('stripe_live'), 'stripe live key shape');
  ok(rules('sk_test_' + 'f'.repeat(8)).includes('stripe_test'), 'stripe test key shape');
  ok(rules('VERCEL_' + 'TOKEN=' + 'e'.repeat(8)).includes('vercel_assignment'), 'vercel assignment');

  ok(rules('geçici/demo ' + 'ghp_' + 'c'.repeat(20)).includes('github_pat'), 'demo phrase does not hide a github pat');
  ok(rules('anon / publishable ' + secret).includes('supabase_secret'), 'publishable phrase does not hide sb_secret');
  ok(
    rules('"role":"anon" ' + '-----BEGIN ' + 'PRIVATE KEY-----').includes('private_key'),
    'anon role phrase does not hide a private key'
  );
  ok(rules('# Politika: service_role kelimesi anahtar değildir.').length === 0, 'markdown role name is not a credential');
  ok(rules('# ornek ' + 'vcp_' + 'b'.repeat(20)).includes('vercel_token'), 'markdown does not bypass a token');

  const roleLines = [
    '# Okuyucu adresi service_role değildir. Yoksa servis okuması BLOCKED kalır.',
    'SET ROLE service_role; SELECT public.btd_shadow_operasyon_ozet();',
    "ok(serviceDenied, 'service_role cannot execute the read');",
    "SELECT has_function_privilege('service_role', 'public.btd_shadow_operasyon_ozet(text,uuid,integer)', 'EXECUTE')",
    "for (const role of ['btd_shadow_okuyucu', 'anon', 'authenticated', 'service_role']) {",
    "ok(sql.includes('service_role'), 'sql names the reader and revokes service role');",
    "ok(!/DROP ROLE (anon|authenticated|service_role)/.test(rollback), 'rollback keeps platform roles');",
    '-- service_role ile RLS aşılmaz. İstemcinin firma_id iddiasına güvenen politika yoktur.',
    "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN",
    'CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;',
    'REVOKE ALL ON FUNCTION public.btd_shadow_operasyon_ozet(text, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;',
    '-- Canlıda ÇALIŞTIRILMADI. anon, authenticated ve service_role rolleri silinmez.',
  ].join('\n');
  ok(rules(roleLines).length === 0, 'role-name lines from the failing scan are not credentials');

  const root = path.join(__dirname, '..');
  const config = fs.readFileSync(path.join(root, 'js', 'supabase-config.js'), 'utf8');
  ok(!rules(config).includes('service_role_jwt'), 'committed anon key is not a service_role JWT');

  const repoHits = scanRepo(root);
  ok(
    repoHits.length === 0,
    'tracked tree has no credential-shaped hit: ' +
      repoHits.map((hit) => `${hit.file}:${hit.line} rule=${hit.rule}`).join(', ')
  );

  console.log(`secret-scan: ${calls} passed`);
}

main();
