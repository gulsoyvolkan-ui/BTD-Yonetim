# Güvenlik notları — BTD Yönetim

## Acil yapılacaklar

1. **Vercel token yenile** (sohbette paylaşıldıysa mutlaka):
   - [vercel.com/account/tokens](https://vercel.com/account/tokens) → eski token’ı **Revoke**
   - Yeni token oluştur → yalnız GitHub **Settings → Secrets → Actions → `VERCEL_TOKEN`** alanına yaz
   - Token’ı sohbete / e-postaya / repoya yapıştırma
2. Org/Project ID secret’ları token değildir; yine de yanlışlıkla public gist’e koyma.

## Ne nerede durur?

| Bilgi | Nerede | Not |
|--------|--------|-----|
| `VERCEL_TOKEN` | GitHub Actions secret | Repo’da asla yok |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | GitHub Actions secret | Public değil |
| Supabase **anon** key | `js/supabase-config.js` | Tarayıcıda görünür; RLS şart |
| Supabase **service_role** | Hiçbir yerde olmamalı | En tehlikeli anahtar |

## Kod korumaları

- `.gitignore`: `.env*`, `.vercel/`
- CI: `.github/workflows/secret-scan.yml` (açık token / service_role / private key taraması)
- Deploy: secret boşsa fail; credential persist kapalı

Ayrıntı: `docs/security/BTD_SECURITY_BASELINE.md`, `docs/security/PRODUCTION_MIGRATION_RUNBOOK.md`, `docs/integrations/SHADOW_BTD_READ_V1.md`.

## Bilinen demo riskleri (bilinçli)

- `003` ve `002` yeniden çalıştırılmaz. Eski halleri anon’a geniş izin veriyordu. Güncel dosyalar durur ve izin yazmaz.
- Acil kapatma `supabase/017_emergency_anon_containment.sql`. Üretimde bu PR sırasında çalıştırılmadı. Sıra ve NO-GO: `docs/security/GUVENLIK_TOPARLAMA.md`.
- `016` anon okumayı geri açmaz.
- Giriş iş e-postası ve Supabase Auth’tır. İstemci parola özeti ile giriş yapmaz. Başarısız giriş yönetici hesabı üretmez.

## Sızıntı olursa

1. İlgili token/key’i sağlayıcı panelinden iptal et  
2. Yenisini sadece secret store’a koy  
3. Git geçmişinde kaldıysa key’i yine de revoke et (silmek yetmez)  
4. Supabase Dashboard → API → gerekirse anon/service key rotate  
