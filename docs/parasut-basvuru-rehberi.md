# Paraşüt API — Senden İstenenler (Sade Rehber)

Pilot: **Technomac**  
Durum: API erişimi için `destek@parasut.com` başvurusu

---

## Ne istediğimizi günlük dilde anlatım

Paraşüt’ün sistemimize “kapı anahtarı” vermesi lazım. Bu anahtarlar **şifre gibi**dir; sohbete veya ekran görüntüsüne yapıştırma. Gelince bana **güvenli yolla** (ör. Supabase Secrets / özel mesaj) ileteceksin.

| Teknik ad | Ne işe yarar? | Senin dilinde |
|-----------|---------------|---------------|
| **client_id** | Uygulama kimliği | “BTD Yönetim uygulamasının Paraşüt’teki numarası” |
| **client_secret** | Gizli anahtar | “Uygulama şifresi — kimseyle paylaşma” |
| **company_id** | Paraşüt şirket kodu | “Technomac’ın Paraşüt hesap numarası” (Bluemac/Devorias ayrıca) |
| **e-posta + şifre** (isteğe bağlı) | Bazı bağlantı türlerinde | Paraşüt’e girdiğin kullanıcı (tercihen API için ayrı kullanıcı) |

Bunlar olmadan entegrasyon **bağlanamaz**; iskelet hazır bekler.

---

## Adım 1 — Destek maili (kopyala-yapıştır)

**Kime:** destek@parasut.com  

**Konu:** API erişim talebi — BTD Yönetim / Technomac Makine

**Metin örneği:**

```
Merhaba,

BTD Yönetim adlı üretim / sipariş yönetim sistemimizi Paraşüt API v4 ile
entegre etmek istiyoruz.

Talep:
1) OAuth2 API uygulamasi (client_id ve client_secret)
2) Firmamıza ait company_id bilgisi
3) Satış faturası (sales_invoices) ve e-Fatura / e-Arşiv oluşturma yetkileri
4) Cari (contacts) okuma/yazma yetkisi

Pilot firma: Technomac (ardından Bluemac ve Devorias ayrı company_id ile
bağlanacak).

Uygulama tipi: sunucu taraflı entegrasyon (Supabase Edge Function).
Redirect URI: urn:ietf:wg:oauth:2.0:oob
(İhtiyaç halinde özel redirect tanımlayabilirsiniz.)

Yetkili: [AD SOYAD]
Telefon: [TELEFON]
Paraşüt hesap e-posta: [PARASÜT GİRİŞ E-POSTASI]
Vergi no (Technomac): [VKN]

Teşekkürler.
```

---

## Adım 2 — Gelen cevaptan not edilecekler

Cevap gelince şu üç değeri bir yere **güvenli** kaydet:

1. `client_id` = …………………………  
2. `client_secret` = …………………………  
3. Technomac `company_id` = …………………………  

İstersen aynı mailde Bluemac / Devorias `company_id` de iste.

---

## Adım 3 — Bana / sisteme nasıl verirsin?

1. Ayarlar → **Paraşüt** sekmesinde (BTD) `company_id` alanını doldur (bu gizli sayılmaz).  
2. `client_id` + `client_secret`’i **sohbete yazma**.  
   Supabase Dashboard → Project Settings → Edge Functions → Secrets içine  
   - `PARASUT_CLIENT_ID`  
   - `PARASUT_CLIENT_SECRET`  
   olarak ekleyeceğiz (rehber birlikte yapılır).  
3. “Anahtarlar hazır” de → OAuth + cari senkron kodunu açarız.

---

## Şimdilik senden tek iş

1. Yukarıdaki maili gönder.  
2. Cevabı bekle.  
3. Gelince haber ver.

Bu sırada BTD tarafında: veritabanı tabloları + Ayarlar → Paraşüt sekmesi + bağlantı durumu ekranı hazırlanır.
