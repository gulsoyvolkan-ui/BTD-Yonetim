# BTD güvenlik toparlaması — sahip özeti

Tarih: 30 Ekim 2026. Bu dal üretim geçişi değildir.

**Karar: NO-GO.** Birleştirme, dağıtım, canlı SQL, secret rotation ve canlı veri değişikliği yok. Aşağıdaki kapılar sahip onayıdır. Agent bunları yapmadı.

Doğrulanan `origin/main`: `2aa351fa759b6196a5141e00b0f80a3ff866d087` (PR #12 birleşmiş). PR #10 ve PR #11 bu ucun altındadır, kaybolmadı. PR #9 (`cursor/btd-auth-rls-c508`, `3d74774`) güncel main ile çakışıyordu; eski haliyle ezilmedi. PR #12’deki üyelik, API jetonu ve `013`–`015` korundu. Eksik kapatma bu dalda eklendi.

Canlı veritabanı kimliği bu ortamda yok. Politika kataloğu okunmadı. Canlı RLS açık denmez. `kullanicilar.auth_user_id` dolu varsayılmaz.

## Acil kapatma

Dosya: `supabase/017_emergency_anon_containment.sql`

Anon’un personel (`tc_no` dahil) ve firma tablolarını okumasını keser. Katalog (malzeme, döviz, tatil) bu dosyada yoktur; onlar `015`’e kalır. `017` tek başına üretimin bittiği anlamına gelmez.

Dosyanın iç sırası sabittir: önce `authenticated` için `USING` ve `WITH CHECK`, sonra `demo_all_access` düşer, sonra `anon` yetkisi alınır. Anon’a `GRANT` yoktur. `002`, `003` ve `016` geniş anon okumayı geri yazamaz; çalıştırılırsa durur.

Uygulanmadı. Yapıştırmak Kapı C’dir.

## Değişen dosyalar

- `supabase/017_emergency_anon_containment.sql` — acil kapatma (yeni, uygulanmadı)
- `supabase/018_sensitive_columns.sql` — `tc_no` ve `maas` kolon daraltması ve yetkili fonksiyon (yeni, uygulanmadı)
- `supabase/019_audit_attribution.sql` — `auth.uid()` denetim tetiği (yeni, uygulanmadı)
- `supabase/016_rollback_demo_access.sql` — anon geri açmaz, durur
- `supabase/002_demo_users_grants.sql`, `supabase/003_demo_rls_policies.sql` — yeniden çalışınca anon açmaz
- `supabase/009_urunler_fasoncular.sql`, `supabase/010_gorevler.sql` — demo politika ve anon grant çıkarıldı
- `supabase/015_revoke_anon_demo.sql` — sonunda personel kolon daraltması (blanket grant ezmesin)
- `index.html`, `js/btd-auth.js`, `js/btd-supabase.js`, `js/btd-cloud.js` — e-posta Auth, eski oturum iptali, anon senkron yok
- `api/_lib/security.test.js` — sentetik doğrulama
- `docs/security/PRODUCTION_MIGRATION_RUNBOOK.md`, `docs/security/TEST_RESULTS.md`

SHADOW deposuna dokunulmadı. `api/shadow-read.js` iş verisi okumaz; yetkisi genişletilmedi.

## On doğrulama

| # | Konu | Sonuç |
|---|---|---|
| 1 | Supabase Auth; istemcide parola özeti ile giriş yok | Geçti (kaynak ve Node) |
| 2 | Personel hesabı runbook; toplu `UPDATE` yok | Geçti (metin ve SQL). Canlı bağlama yapılmadı |
| 3 | Firma üyeliği | Geçti (kod ve `014`/`017`). Canlı politika blocked |
| 4 | RLS `USING` ve `WITH CHECK` | Geçti (statik). Çalıştırma blocked |
| 5 | Demo giriş ve kullanıcı adı ile yetki yükseltme kalktı | Geçti |
| 6 | Hassas kolonların anon/genel seçimi | Kod geçti. `017`/`018` uygulanmadı. Canlı blocked |
| 7 | API kimliği; `x-api-key` tek başına yetmez | Geçti (`selfcheck`: anahtar var, jeton yok → 401) |
| 8 | Okuma ve yazmada sunucu yetkisi | API geçti. Tarayıcı yolu RLS’e bağlı. Canlı blocked |
| 9 | Denetlenebilir aktör | API olayı sır içermiyor, geçti. `019` çalıştırılmadı, blocked |
| 10 | Eski oturumun düşmesi | Geçti (`v1` ve `tc_no` taşıyan oturum reddedilir) |

Node: `security.test.js` 72 doğrulama, ardından SHADOW HTTP ve bulut kapısı. `selfcheck.js` 85 doğrulama. Üretim ve staging veritabanı yok; Postgres bu ortamda yok. Staging başarısı yoktur. Tarayıcıda tıklama yapılmadı.

## SQL sırası (sahip, sonra)

Yedek zamanı yoksa hiçbir dosyayı açmayın. Bağlantı dizesini sohbete yazmayın. Her dosyayı SQL Editor’da tek parça yapıştırın. Bayrak, dosyadan önce, aynı pencerede:

```sql
SELECT set_config('btd.allow_anon_containment', 'on', true);
```

`013` bayraksızdır. Diğer bayrak adları dosyanın başındadır: `btd.allow_sensitive_columns`, `btd.allow_audit_trigger`, `btd.allow_rls`, `btd.allow_anon_revoke`.

1. `supabase/013_auth_membership.sql` — fonksiyon ve denetim tablosu. Demo politikayı düşürmez, anon açmaz, kullanıcı satırı güncellemez.
2. Hesap bağlama — aşağıdaki tek kişi adımı. Toplu iş yok.
3. `supabase/017_emergency_anon_containment.sql` — Kapı C.
4. Bu kodun dağıtımı — Kapı D. `017` ile aynı bakım penceresi. `017` önce, dağıtım hemen ardından.
5. `supabase/018_sensitive_columns.sql`
6. `supabase/019_audit_attribution.sql`
7. `supabase/014_tenant_rls.sql` — demo politikayı silmez. Tek başına anon’u kapatmaz.
8. `supabase/015_revoke_anon_demo.sql` — kalan anon ve katalog. Personel kolonunu yeniden daraltır.

Çalıştırılmayacaklar: `002`, `003`, `016`. İkisi de anon `SELECT`/`ALL` geri açmaz; eski alışkanlıkla yapıştırmayın. `009` ve `010` tablo kurar, demo politika yazmaz. Geçmişteki kopyalarını yeniden çalıştırmayın.

Tek hesap (canlı veri, Kapı B). Parolayı SQL’e yazmayın:

```sql
UPDATE public.kullanicilar
SET auth_user_id = '<AUTH_USER_UUID>'::uuid
WHERE kullanici_adi = '<KULLANICI_ADI>'
  AND auth_user_id IS NULL;
```

Yanlış bağ:

```sql
UPDATE public.kullanicilar
SET auth_user_id = NULL
WHERE kullanici_adi = '<KULLANICI_ADI>';
```

Bu, Auth kullanıcısını ve iş satırını silmez.

## Personel girişi

Bu kod birleşip dağıtılırsa kullanıcı adı ve parola özeti ile giriş kapanır. Eski `localStorage` oturumu (`btd_auth_session_v1`) silinir. Açık oturum sunucudan üyelik doğrulamazsa kapanır. Giriş iş e-postası ve Supabase Auth parolasıdır. `auth_user_id` boşsa ekran “henüz BTD hesabına bağlı değil” der; özet yoluna düşmez.

Bağlanmamış personel bu dağıtımdan sonra buluta giremez. Yerel demo dizin giriş sayılmaz. Dağıtımdan önce aktif her kişi e-posta ile açılmış olmalıdır. Kiosk ortak hesap değildir; aynı e-posta kuralı geçerlidir. Kiosk kısıtı arayüzdedir. Yönetici jetonu, `018` uygulandıysa hassas fonksiyonu çağırabilir. Bunu kiosk sınırı sanmayın.

`017` uygulanır ve kod henüz dağılmazsa: e-posta ile girmiş kişi (jeton) firma politikasıyla okumaya devam eder. Kullanıcı adı yolu anon anahtar kullandığı için personel ve firma bulutunu kaybeder; eski ekran yerelde kalabilir. Bu, verinin korunduğu anlamına gelmez.

Maaş ve `tc_no`, `018` uygulanmadan buluttan geri okunmaz. Yetkili (yönetici veya `erisim_kritik`) `018` sonrası fonksiyondan görür. Operatör listesinde bu alanlar boş kalır.

Açılış senkronu oturumsuz tablo okumaz ve açılışta buluta yazmaz. Boş tabloya yerel tohum basılmaz.

## Yedek ve geri dönüş

1. Supabase → Database → Backups. Son yedeğin zamanını not edin. Bağlantı dizesini yazmayın.
2. Yedek zamanı yoksa `014`, `015`, `017`, `018`, `019` yok.
3. Uygulama bozulursa kod dağıtımını geri alın. Ayrı git kararıdır. Bu dal kendi kendine birleşmez.
4. `016` çalıştırmayın. Geniş anon okuma geri açılmaz.
5. Tek kişinin bağı yukarıdaki `auth_user_id = NULL` satırıdır.
6. `authenticated` politikası yeniden yazılacaksa `014` veya `017`. Anon grant yok.
7. İş satırı bu dosyalarla silinmez.

## Secret rotation (şimdi yapılmaz)

Değerleri sohbete, repoya veya loga yazmayın.

- Vercel: [hesap token sayfası](https://vercel.com/account/tokens) → eski token **Revoke** → yenisini yalnız GitHub Actions `VERCEL_TOKEN` secret’ına koyun. Kullanıcı token yenilendi demedikçe bu hatırlatma durmaz.
- `service_role` kodda yok. Bir yerde göründüyse panelden rotate edin. Repoya koymayın.
- Anon anahtar tarayıcıdadır. `015` uygulanmadan rotate etmek okumayı kapatmaz. Rotate, `015` sonrası, ayrı pencerede. Yeni değer yalnız Vercel ve istemci config sürecindedir. Bu sohbete yapıştırmayın.
- `BTD_API_KEY` kimlik değildir. Paylaşıldıysa, kod yayında olduktan sonra Vercel’de değiştirin. API yine kullanıcı jetonu ister.
- Personel parolası Auth panelindedir. Eski demo parolası kullanılmaz.
- SHADOW imza anahtarına yeni iş verisi yetkisi verilmez. Ayrı bir sızıntı yoksa bu dal onu değiştirmez.

## Kesim listesi

- [ ] Yedek zamanı yazılı
- [ ] Kapı A: `013` uygulandı, anon hâlâ açıkken fonksiyon var
- [ ] Kapı B: aktif personelin her biri tek tek bağlı ve e-posta ile girmiş
- [ ] Kapı C: `017` uygulandı
- [ ] Kapı D: bu kod dağıtıldı; kullanıcı adı girişi kapalı
- [ ] Kapı E: `018` ve `019`
- [ ] Kapı F: `014` sonra `015`
- [ ] Kapı G: secret rotation, değerler sohbette değil
- [ ] `002` / `003` / `016` çalıştırılmadı
- [ ] SHADOW hâlâ `UNAVAILABLE` ve yazmasız

## Kapılar

| Kapı | İş | Şimdi |
|---|---|---|
| A | `013` yapıştır | NO-GO |
| B | Tek tek Auth hesabı ve `auth_user_id` | NO-GO, canlı veri |
| C | `017` acil kapatma | NO-GO |
| D | Bu PR’ı birleştir ve dağıt | NO-GO |
| E | `018` ve `019` | NO-GO |
| F | `014` sonra `015` | NO-GO |
| G | Token ve anahtar rotation | NO-GO, değer yazılmaz |

Hepsi NO-GO iken BTD’nin bugünkü üretim kodu değişmez. Bu dalın kodu yayına girmeden personel girişi düşmez. `017` yapıştırılmadan anon okuma da kapanmaz.
