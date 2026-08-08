# Paraşüt Entegrasyon Planı — BTD Yönetim

Hedef: Technomac / Bluemac / Devorias carileri ve faturaları Paraşüt API v4 üzerinden senkronize etmek; resmi e-Fatura/e-Arşiv Paraşüt’ten kessin. BTD üretim/sipariş kaynağı kalır.

Kaynak: https://api.parasut.com/v4 · https://apidocs.parasut.com/

---

## 1. Neden Excel yetmez?

Şu anki Excel aktarımı yalnızca **TL Bakiye** kolonunu `tlBalance` olarak yazıyor. Dosyada ayrıca **USD / EUR / GBP Bakiye** var; işlem (cari hareket) satırları yok.

| Katman | Excel | API |
|--------|-------|-----|
| Cari kart (unvan, VKN, adres) | Var | Var |
| Döviz bakiyeleri (TRY/USD/EUR/GBP) | Kolonlar var, biz TL aldık | Contact balance / accounts |
| Cari hareket (fatura, tahsilat, ödeme) | Yok | Transactions / invoices / payments |
| e-Fatura kesme | Yok | SalesInvoice + e-Invoice/e-Archive job |

Excel = hızlı seed. Gerçek finans = API.

---

## 2. Mimari prensip (3 firma)

Her grup firması **ayrı Paraşüt şirketi** (`company_id`) kabul edilir:

```
BTD activeCompany  →  parasut_company_id  →  ayrı OAuth token / credential
Technomac          →  PS_TM_…             →  kendi carileri + faturaları
Bluemac            →  PS_BM_…
Devorias           →  PS_DV_…
```

- Aynı dış müşteri/tedarikçi (aynı VKN) üç BTD firmasında **üç ayrı cari** kalır (mevcut model).
- Paraşüt’te de her şirketin kendi contact kaydı vardır; BTD `partyKey` + `firma_id` ile eşlenir.
- Secret’lar tarayıcıya konmaz → **Supabase Edge Function** (veya ince bir API proxy) token alır, Paraşüt’e gider.

```
[BTD UI] → [Supabase Edge: parasut-*] → [api.parasut.com/v4/{company_id}/…]
                ↕
         [Supabase: parasut_baglanti, cari_eslesme, fatura_eslesme]
```

---

## 3. Aşamalar

### A0 — Excel iyileştirme (opsiyonel, paralel, 0.5–1 gün)
- `balances: { TRY, USD, EUR, GBP }` kaydet
- Listede çoklu döviz göster; sıralama `|TRY|` veya seçilen dövize göre
- Hareket yok; sadece bakiyeyi düzeltir

### A1 — Bağlantı + cari senkron (MVP)
1. OAuth2 (`password` veya `authorization_code` + `refresh_token`)
2. Contacts list/create/update (müşteri & tedarikçi)
3. Eşleme: `vergi_no` / unvan → BTD `partyKey` + `parasut_contact_id`
4. Döviz bakiyelerini contact’tan veya balance endpoint’ten çek
5. UI: Ayarlar → “Paraşüt Bağla” (firma başına)

### A2 — Sipariş → satış faturası (Paraşüt’te resmi belge)
Akış BTD’de:

`Sipariş (Tamamlandı / Sevk edildi) → Faturalandır → Paraşüt sales_invoices → e-Fatura veya e-Arşiv job`

BTD tutacaklar:
- `invoice` kaydı (yerel takip: taslak / gönderildi / hata / parasut_id)
- Kalemler sipariş kalemlerinden
- Cari = CRM müşteri → `parasut_contact_id`
- Döviz = sipariş/teklif para birimi

Paraşüt:
- `POST /v4/{company_id}/sales_invoices`
- Ardından e-belge tipi (e-Fatura / e-Arşiv) için ilgili endpoint + async job tracking
- Başarıda BTD’de `parasutInvoiceId`, `eDocumentStatus`, PDF linki (varsa)

### A3 — Cari hareket görünümü
- Tahsilat / ödeme özetleri (read-only önce)
- BTD’de “Cari ekstresi” = Paraşüt transactions proxy (cache’li)

### A4 — Ters yön (ileride)
- Paraşüt’te oluşan carileri BTD’ye pull (Excel’in yerini alır)
- Çift yazımı engelle: kaynak bayrağı `source: parasut | btd`

---

## 4. Veri eşleme taslağı

### 4.1 Cari (Contact)

| BTD | Paraşüt (özet) |
|-----|----------------|
| `name` / `unvan` | `name` |
| `taxNo` | `tax_number` |
| `taxOffice` | `tax_office` |
| `address` | `address` / city / district |
| `email` / `phone` | iletişim alanları |
| `cariRole` customer | contact tip / category customer |
| `cariRole` supplier | supplier |
| `cariRole` both | tek contact; BTD’de çift kart kalır, aynı `parasut_contact_id` |
| `balances.TRY/USD/EUR/GBP` | API balance alanları |
| `partyKey` | lokal; Paraşüt’e yazılmaz |
| `firma_id` | hangi `parasut company_id` |

### 4.2 Fatura (SalesInvoice)

| BTD sipariş / fatura | Paraşüt |
|----------------------|---------|
| Sipariş no | `description` / custom field / `order_no` |
| Müşteri | `relationships.contact` |
| Kalem: partNo + desc | `details` / product lines |
| qty, unitPrice | detail attributes |
| KDV % | tax / vat rate |
| currency | invoice currency |
| vade / due | `due_date` |
| BTD `invoice.id` | lokal; yanıta `id` yazılır |

Kurallar:
- Siparişte fatura yoksa veya Paraşüt’te iptalse yeniden gönderilebilir (maliyet→teklif orphan mantığı gibi).
- Resmi belge kesildikten sonra BTD’den silme yok; iptal Paraşüt süreçleriyle.

---

## 5. Supabase şema (yeni)

```text
parasut_baglantilar
  firma_id UUID PK/FK
  parasut_company_id TEXT NOT NULL
  client_id / secret → tercihen Vault veya Encrypted
  refresh_token (encrypted)
  access_token_expires_at
  connected_at, last_sync_at
  status: disconnected | ok | error

parasut_cari_eslesme
  firma_id
  musteri_id XOR tedarikci_id (nullable çift)
  party_key
  parasut_contact_id
  UNIQUE(firma_id, parasut_contact_id)

parasut_fatura_eslesme
  firma_id
  local_invoice_id / belge_no
  order_id
  parasut_sales_invoice_id
  e_doc_type: efatura | earchive | null
  e_doc_status
  last_error
```

Mevcut `musteriler` / `tedarikciler` için opsiyonel:
- `bakiye_try`, `bakiye_usd`, `bakiye_eur`, `bakiye_gbp` (veya JSONB `bakiyeler`)

---

## 6. Edge Function uçları (öneri)

| Function | İş |
|----------|-----|
| `parasut-oauth` | token al / yenile (firma bazlı) |
| `parasut-sync-contacts` | pull/push cariler |
| `parasut-create-invoice` | siparişten sales_invoice + e-belge başlat |
| `parasut-invoice-status` | async job poll |

UI asla `client_secret` görmez; sadece “Bağlantı durumu” ve “Şimdi senkronize et / Faturalandır”.

---

## 7. Ürün akışı (kullanıcı gözü)

1. Ayarlar → Firma (TM/BM/DV) → Paraşüt bağla  
2. Carileri senkron et (veya ilk seferde Excel + sonraki API)  
3. Üretim: teklif → sipariş → iş emri → sevkiyat (mevcut BTD)  
4. Faturalandırma sayfası: uygun sipariş → **Paraşüt’te fatura kes**  
5. Durum: Gönderildi / e-Belge bekliyor / Tamam / Hata  
6. PDF/link Paraşüt’ten; BTD’de sipariş “Faturalandı”

---

## 8. Riskler ve kararlar

| Risk | Önlem |
|------|--------|
| 3 ayrı Paraşüt aboneliği / company_id | Kurulumda netleştir |
| Token sızıntısı | Sadece Edge + Vault |
| Çift fatura | `parasut_fatura_eslesme` unique + UI kilidi |
| VKN’siz cari | Eşleme unvan + manuel onay kuyruğu |
| e-Fatura async | Job status poll + kullanıcıya durum |
| Dövizli fatura | Sipariş currency = invoice currency |

---

## 9. Uygulama sırası (önerilen sprintler)

1. **Docs + credential:** destek@parasut.com / developer panel → client_id/secret + 3× company_id  
2. **A1 iskelet:** Edge oauth + tek firma (Technomac) contact pull  
3. **Eşleme UI:** çakışan / yeni / güncellenecek cari önizleme  
4. **A2:** sipariş → sales_invoice (test şirketi)  
5. **e-Belge** job + durum  
6. Bluemac / Devorias bağları  
7. (Paralel) A0 Excel multi-currency

---

## 10. Bu planın dışı (bilinçli)

- BTD içinde GİB’e doğrudan e-Fatura kesmek (Paraşüt yapacak)
- Muhasebe defteri / Bilanço (Paraşüt tarafı)
- Excel’i API yerine uzun vadeli tutmak (sadece bootstrap)

---

## 11. Senden gerekenler (uygulama öncesi)

1. Her firma için Paraşüt **company_id**  
2. API **client_id / client_secret** (veya destek onayı)  
3. Test için sandbox/canlı ayrımı  
4. İlk pilot firma: öneri **Technomac**  
5. Faturalandırma tetik koşulu: sipariş durumu = ? (öneri: Sevk edildi / Tamamlandı)

Bu belge onaylandıktan sonra kod: Edge + şema + Faturalandırma UI bağlantısı ile A1’den başlanır.
