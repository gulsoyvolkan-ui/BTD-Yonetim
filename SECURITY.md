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

## Bilinen demo riskleri (bilinçli)

- Supabase `003_demo_rls_policies.sql` anon’a geniş izin verir — **bitirme/demo içindir**. Gerçek müşteri verisi öncesi firma bazlı RLS + güvenli auth gerekir.
- Kullanıcı şifreleri demo’da düz metin (`sifre_hash` alanı); üretimde hash + Supabase Auth tercih edilmeli.
- Giriş demosu: `volkan` / `123456` — production’da değiştir / kapat.

## Sızıntı olursa

1. İlgili token/key’i sağlayıcı panelinden iptal et  
2. Yenisini sadece secret store’a koy  
3. Git geçmişinde kaldıysa key’i yine de revoke et (silmek yetmez)  
4. Supabase Dashboard → API → gerekirse anon/service key rotate  
