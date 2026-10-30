# Kiracı yetki matrisi

Bu matris hedeftir. `014` ve `015` canlıda çalıştırılmadı. Üretim satırlarının bu kuralla kapandığı doğrulanmadı. `auth_user_id` boşsa sunucu üyeliği yok sayılır.

Firma kaynağı `kullanici_firmalar` satırıdır. `tum_grup` tek başına listede olmayan bir `firma_id` açmaz. İstemci gövdesindeki rol, `is_god` veya firma kabul edilmez.

## Ekran

| Kim | Firma | Sayfa | Silme |
|---|---|---|---|
| Grup yöneticisi (`rol=Yönetici` ve `tum_grup`, üyelik satırları dolu) | Yalnız üyelik listesi | Masaüstünde yönetici sayfaları | Matris |
| Beyaz yaka, kritik erişim | Üyelik | Rol listesi ve kritik menü | Matris `delete` |
| Mavi yaka | Üyelik | İş emri, tedarik, imalat, görev, fason, kalite, sevkiyat, makine, Andon. Fiyat sayfaları kapalı | Matris |
| Operatör, kalite, sevkiyat, muhasebe | Üyelik | `index.html` `roleNavAccess` listesi | Matris |
| Kiosk (`?portal=kiosk`) | Tek firma | Operatör eşiği, yönetici değil | Kapalı |
| Oturum yok | Yok | Kabuk gizli. Sunucu yine üyeliğe bakar | Yok |

Masaüstü `portal` sorgusu yokken 2 saat hareketsizlik durur. Kiosk 5 dakikadır, hatırlama ve kayıtlı parola yoktur.

## Veritabanı hedefi

| Rol | İş |
|---|---|
| anon, `015` sonrası | Tablo yetkisi yok. `demo_all_access` düşer |
| authenticated | Üyelik `USING` ve `WITH CHECK`. Katalog yazması yalnız grup yöneticisi |
| `kullanicilar` | authenticated yalnız kendi satırını veya grup yöneticisi olarak okur. `sifre_hash` ve `tc_no` kolon yetkisi yok. Uygulama rol güncellemez |
| `denetim_olaylari` | Kendi olayı veya kendi firması. Güncelleme ve silme yok |

`014` demo politikasını silmez. Postgres izinleri OR birleşir. Asıl kapanış `015` dosyasındadır. `016` demo açıklığını geri açar; iş satırını silmez.

## API

| Koşul | Sonuç |
|---|---|
| Anahtar veya jeton yok / bozuk | 401 |
| Jeton geçerli, `firma_id` üyelikte yok | 403, tablo okunmaz |
| İkisi de geçerli | İstenen kolonlar, `select=*` yok |
| `sifre_hash`, `tc_no`, rol, `is_god` gövdede | 400 |
| SHADOW yazma | 405, `writes: false` |
| SHADOW kaynağı yok | 200, `freshness: UNAVAILABLE`, `data: null` |

Gizli sunucu anahtarı bu yollarda gönderilmez. Hız sınırı süreç belleklerindedir; sunucusuz ortamda küresel sayaç değildir.
