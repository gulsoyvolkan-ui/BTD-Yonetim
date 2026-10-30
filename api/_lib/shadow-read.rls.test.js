'use strict';

// Canlı Postgres ve RLS bu dosyada çalıştırılmaz.
// BTD_RLS_TEST_DATABASE_URL yoksa veya uç yerel değilse NOT TESTED.
// Service role kullanılmaz. Bu sonuç canlı GO değildir.

const url = String(process.env.BTD_RLS_TEST_DATABASE_URL || '').trim();
if (!url) {
  console.log('shadow rls: NOT TESTED live postgres');
  process.exit(0);
}

let host = '';
try {
  host = new URL(url).hostname;
} catch (err) {
  console.log('shadow rls: NOT TESTED live postgres');
  process.exit(0);
}

if (host !== '127.0.0.1' && host !== 'localhost') {
  console.log('shadow rls: NOT TESTED refused non-local database');
  process.exit(0);
}

console.log('shadow rls: NOT TESTED local runner is not bundled');
process.exit(0);
