# Üretim geçişi

Bu dal üretim geçişi değildir. Ayrıntı, kapılar ve NO-GO: `docs/security/GUVENLIK_TOPARLAMA.md`.

Agent SQL çalıştırmadı, yedek almadı, Vercel değiştirmedi, hesap bağlamadı.

## Sıra

Yedekten sonra. Bayraklar dosya başında. Anon’a izin veren adım yoktur.

1. `supabase/013_auth_membership.sql`
2. Tek kişi Auth bağlama (`GUVENLIK_TOPARLAMA.md` içindeki tek `UPDATE`). Toplu yok.
3. `supabase/017_emergency_anon_containment.sql` — önce `authenticated` politika, sonra demo düşüş, sonra anon yetkisi.
4. Bu kodun dağıtımı, hesaplar bağlandıktan sonra ve `017` ile aynı pencerede.
5. `supabase/018_sensitive_columns.sql`
6. `supabase/019_audit_attribution.sql`
7. `supabase/014_tenant_rls.sql`
8. `supabase/015_revoke_anon_demo.sql`

`002`, `003` ve `016` çalıştırılmaz. `016` anon okumayı geri açmaz; durur. Geniş anon `SELECT`/`ALL` geri açma önerilmez.

`014` demo politikayı silmez. `017` ve `015` kapatır. `015` içindeki tablo grant’i personel kolonunu yeniden açmasın diye dosyanın sonunda kolon daraltması vardır.

## Geri dönüş

Kod dağıtımını geri almak ayrı bir git kararıdır. Tek hesap: `auth_user_id = NULL` (runbooktaki tek satır). İş satırı silinmez. `016` yok.
