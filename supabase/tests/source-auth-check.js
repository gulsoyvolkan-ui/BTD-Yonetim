'use strict';

const fs = require('fs');
const assert = require('assert');

const supa = fs.readFileSync('js/btd-supabase.js', 'utf8');
assert.ok(!supa.includes('sifre_hash'), 'login must not read sifre_hash');
assert.ok(!supa.includes('tc_no'), 'login must not read tc_no');
assert.ok(supa.includes('signInWithPassword'), 'supabase auth');
assert.ok(supa.includes('link_my_auth'), 'auth mapping');

const cloud = fs.readFileSync('js/btd-cloud.js', 'utf8');
assert.ok(!cloud.includes('is_god'), 'client must not write is_god');
assert.ok(!cloud.includes('sifre_hash'), 'client must not write sifre_hash');
assert.ok(!cloud.includes('PROTECTED_USERS'), 'username must not keep privilege');

const html = fs.readFileSync('index.html', 'utf8');
assert.ok(!html.includes('isDemoAdminCredentials'), 'demo login removed');
assert.ok(!html.includes('buildEmergencyAdminUser'), 'emergency admin removed');
assert.ok(!html.includes("p === '123456'"), 'demo password check removed');
assert.ok(!html.includes('şifre 123456'), 'demo password hint removed');
assert.ok(!html.includes('applyDemoLoginOverrides'), 'username override removed');

const crud = fs.readFileSync('api/_lib/crud.js', 'utf8');
assert.ok(!crud.includes('SUPABASE_SECRET_KEY'), 'api must not read the secret key');
assert.ok(!crud.includes('BTD_API_KEY'), 'shared api key is not authorization');
assert.ok(crud.includes("tokenRole(token) !== 'authenticated'"), 'only user jwt');

console.log('source-auth-check passed');
