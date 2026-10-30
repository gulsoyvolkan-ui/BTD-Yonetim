#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

if [[ -n "${DATABASE_URL:-}" ]]; then
  psql_cmd() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }
else
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS btd_rls_test;"
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE btd_rls_test;"
  psql_cmd() { sudo -u postgres psql -d btd_rls_test -v ON_ERROR_STOP=1 -q "$@"; }
fi

run() {
  psql_cmd -c "SET client_min_messages TO warning" -f "$1" -o /tmp/btd-sql.out
  echo "ok $(basename "$1")"
}

run supabase/tests/00_roles.sql
run supabase/001_schema.sql
run supabase/004_hr_crm_contact_fields.sql
run supabase/005_personel_foto.sql
run supabase/006_wo_cam_planned_duration.sql
run supabase/007_tech_drawing_qr_key.sql
run supabase/009_urunler_fasoncular.sql
run supabase/010_gorevler.sql
run supabase/011_marka.sql
run supabase/tests/10_simulate_open.sql
run supabase/tests/15_synthetic.sql
run supabase/tests/20_assert_open.sql
run supabase/012_auth_rls.sql
run supabase/tests/30_assert_closed.sql
run supabase/012_auth_rls_rollback.sql
run supabase/tests/20_assert_open.sql
run supabase/012_auth_rls.sql
run supabase/tests/30_assert_closed.sql
node api/_lib/selfcheck.js
node supabase/tests/source-auth-check.js
echo "auth rls regression passed"
