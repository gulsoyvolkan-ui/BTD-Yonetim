'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Rol adı service_role bir Postgres rolüdür. Anahtar biçimleri ayrıdır:
// sb_secret_, service_role JWT yükü, SUPABASE_SERVICE_ROLE ataması.
const PATTERNS = [
  { rule: 'vercel_token', re: new RegExp('vcp_' + '[A-Za-z0-9]{20,}') },
  { rule: 'vercel_assignment', re: new RegExp('VERCEL_TOKEN' + '[A-Z0-9_]*' + '\\s*=\\s*\\S') },
  { rule: 'github_pat', re: new RegExp('ghp_' + '[A-Za-z0-9]{20,}') },
  { rule: 'github_fine_grained', re: new RegExp('github_pat_' + '[A-Za-z0-9_]{20,}') },
  { rule: 'stripe_live', re: new RegExp('sk_live_' + '[A-Za-z0-9]+') },
  { rule: 'stripe_test', re: new RegExp('sk_test_' + '[A-Za-z0-9]+') },
  {
    rule: 'private_key',
    re: new RegExp('-----BEGIN ' + '(?:RSA |OPENSSH |EC )?' + 'PRIVATE KEY-----'),
  },
  { rule: 'supabase_secret', re: new RegExp('sb_secret_' + '[A-Za-z0-9]+') },
  {
    rule: 'service_role_assignment',
    re: new RegExp('SUPABASE_SERVICE_ROLE' + '[A-Z0-9_]*' + '\\s*=\\s*\\S'),
  },
];

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function jwtRole(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return json && typeof json.role === 'string' ? json.role : null;
  } catch (err) {
    return null;
  }
}

function scanText(text) {
  const hits = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of PATTERNS) {
      pattern.re.lastIndex = 0;
      if (pattern.re.test(line)) hits.push({ line: i + 1, rule: pattern.rule });
    }
    JWT_RE.lastIndex = 0;
    let match;
    while ((match = JWT_RE.exec(line))) {
      if (jwtRole(match[0]) === 'service_role') {
        hits.push({ line: i + 1, rule: 'service_role_jwt' });
        break;
      }
    }
  }
  return hits;
}

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' });
  return out.toString('utf8').split('\0').filter(Boolean);
}

function scanRepo(root) {
  const hits = [];
  for (const rel of trackedFiles(root)) {
    const abs = path.join(root, rel);
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) continue;
    for (const hit of scanText(buf.toString('utf8'))) {
      hits.push({ file: rel, line: hit.line, rule: hit.rule });
    }
  }
  return hits;
}

function main() {
  const root = repoRoot();
  const hits = scanRepo(root);
  if (hits.length) {
    for (const hit of hits) {
      console.error(`${hit.file}:${hit.line} rule=${hit.rule}`);
    }
    console.error('Possible secret found. Remove it and rotate the credential.');
    process.exit(1);
  }
  console.log('Secret scan passed.');
}

module.exports = { PATTERNS, scanText, scanRepo, jwtRole };

if (require.main === module) main();
