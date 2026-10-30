# Üretim geçişi, yedek, geri dönüş, hesap

Bu dal üretim geçişi değildir. Aşağıdaki adımlar insan içindir. Agent SQL çalıştırmadı, yedek almadı, Vercel ortamını değiştirmedi.

`kullanicilar.auth_user_id` dolu kabul edilmez. Toplu `UPDATE` yoktur.

## Yedek

1. Supabase projesi → Database → Backups. Son yedeğin zamanını not edin. Bağlantı dizesini sohbete veya repoya yapıştırmayın.
2. Ek mantıksal kopya gerekiyorsa bunu kendi makinenizden, gizli anahtarı komut satırına yazmadan alın.
3. Yedek zamanı yoksa `014` ve `015` dosyalarını açmayın.

## Sıra

### 1. Üyelik fonksiyonları

Dosya: `supabase/013_auth_membership.sql`

SQL Editor’a dosyanın tamamını yapıştırıp Run. Demo politikasını düşürmez, anon yetkisini almaz, kullanıcı satırı güncellemez. İkinci kez çalıştırılabilir.

SQL Editor `postgres` oturumunda `auth.uid()` boştur. `select public.btd_oturum_baglami();` burada NULL döner. Bu, fonksiyonun bozuk olduğu anlamına gelmez.

### 2. Tek hesap bağlama

Toplu iş yok. Her kişi için ayrı:

1. Supabase → Authentication → Users → Add user. E-posta ve parolayı panelde verin. Parolayı SQL’e, sohbete veya repoya yazmayın.
2. Kullanıcının Auth UUID’sini kopyalayın.
3. Aşağıdaki sorguyu tek kullanıcı adı ile çalıştırın. Yer tutucuları değiştirin. İkinci satır zaten bağlıysa dokunulmaz.

```sql
UPDATE public.kullanicilar
SET auth_user_id = '<AUTH_USER_UUID>'::uuid
WHERE kullanici_adi = '<KULLANICI_ADI>'
  AND auth_user_id IS NULL;
```

4. O kişi e-posta ile giriş dener. Bağlı değilse ekran “henüz BTD hesabına bağlı değil” der ve hash yoluna düşmez.
5. Bir sonraki kişiye ancak bu kişi açıldıysa geçin.

Hesap geri dönüşü, yalnız o satır:

```sql
UPDATE public.kullanicilar
SET auth_user_id = NULL
WHERE kullanici_adi = '<KULLANICI_ADI>';
```

Bu, Auth kullanıcısını silmez. Panelden ayrıca kapatılır. İş verisi silinmez.

### 3. Kiracı politikaları

Dosya: `supabase/014_tenant_rls.sql`

Aynı pencerede, dosyadan önce:

```sql
SELECT set_config('btd.allow_rls', 'on', true);
```

Bayrak yoksa dosya hiçbir tabloyu değiştirmez. `demo_all_access` dururken anon erişimi kapanmaz. Dosya eksik tabloyu atlar.

### 4. anon kapatma

Dosya: `supabase/015_revoke_anon_demo.sql`

Bunu, aktif herkes e-posta Auth ile girmeden çalıştırmayın. Kullanıcı adı yolu jeton taşımaz. `015` sonrası o yolun bulut sorgusu düşer. Yerel ekran kalır; bu, verinin korunduğu anlamına gelmez.

Aynı pencerede, dosyadan önce:

```sql
SELECT set_config('btd.allow_anon_revoke', 'on', true);
```

İş satırı silinmez. `auth_user_id` toplu dolmaz.

### 5. Vercel adları

Kod birleşip dağıtıldıktan sonra, insan olarak Vercel ortamına yalnız şu adları koyun. Değerleri repoya yazmayın.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (publishable / anon)
- `BTD_API_KEY`
- `BTD_SHADOW_SIGNING_KEY` (SHADOW ucu için; yoksa o uç 503 döner, SPA açılır)

Sıradan API gizli sunucu anahtarını okumaz. Eski dağıtım duruyorsa o anahtar hâlâ eski kodda kullanılabilir. Yeni kod yayında olduktan sonra o ortam değişkenini Vercel’den kaldırın. Değeri sohbete yapıştırmayın.

## Geri dönüş

Demo açıklığını geri açmak: `supabase/016_rollback_demo_access.sql`

Aynı pencerede önce:

```sql
SELECT set_config('btd.allow_demo_restore', 'on', true);
```

Bu, anon’a yeniden geniş yetki verir. Kalıcı çözüm değildir. Hesap bağını çözmek için yukarıdaki tek satırlık `auth_user_id = NULL` sorgusu kullanılır. `016` o bağı silmez.

Uygulama kodunu geri almak ayrı bir git işlemidir. Bu dal birleştirilmedi.
