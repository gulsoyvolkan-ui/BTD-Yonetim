# Owner kararları v0.4 — bekleyen kayıt

**Tarih:** 2026-11-05  
**Kaynak SHA:** `gulsoyvolkan-ui/BTD-Yonetim@eeedcabd7895d7995efe731b09af24e696c88a9d`  
**Bu dosya:** Karar tutanağı değildir. API, SQL, enum veya üretim durumu yazmaz. Hiçbir madde APPROVED yapılmamıştır.

Raporlama sözlüğü: `PROPOSED`, `APPROVED`, `DEFERRED`, `REJECTED`. Bu turda O1–O9 değeri `OWNER-PENDING`, sınıfı `PROPOSED` olarak yazıldı. `APPROVED`, `DEFERRED` ve `REJECTED` kullanılmadı.

| Karar | Konu | Değer | Sınıf | Nerede durur |
|---|---|---|---|---|
| O1 | Layout v3 | OWNER-PENDING | PROPOSED | TWIN liderliği. Bu depo kararı vermez. |
| O2 | Birincil ve bilgi ikonu | OWNER-PENDING | PROPOSED | TWIN liderliği. Bu depo kararı vermez. |
| O3 | Sahne ve binding tek yazarı | OWNER-PENDING | PROPOSED | ADR-001. BTD doğrulama sınırı önerisidir. |
| O4 | Sahne deposu | OWNER-PENDING | PROPOSED | TWIN liderliği. BTD rakip binding tablosu açmaz. |
| O5 | Pilot firma ve saha | OWNER-PENDING | PROPOSED | Çevrimdışı sentetik hazırlık ayrı izindir. Canlı bağlantı değildir. |
| O6 | Provenance ve TTL | OWNER-PENDING | PROPOSED | ADR-001 ve ADR-003 bağımlılığı. Kaynak sınıfları kabul edilmiş değildir. |
| O7 | OT ve 3D kapıları | OWNER-PENDING | PROPOSED | ADR-006. Doğrudan hareket NO-GO. |
| O8 | Kurumsal ajan kimliği | OWNER-PENDING | PROPOSED | ADR-002. O8-A, O8-B ve O8-C açık. |
| O9 | IAM ve scope | OWNER-PENDING | PROPOSED | ADR-002 ve ADR-006. O9-A, O9-B ve O9-C açık. |

O8 alt soruları (hepsi OWNER-PENDING / PROPOSED):

- O8-A. Global ajan profili ve firma ataması kabul, erteleme veya değişiklik mi?
- O8-B. Aynı SHADOW uzmanı birçok firma profiline atanabilir mi ve hangi sahip onaylar?
- O8-C. Askıya alma ve iptal yetkisi, aktif yürütme ve denetim kime aittir?

O9 alt soruları (hepsi OWNER-PENDING / PROPOSED):

- O9-A. Önce ayrı dar service principal, SSO veya OIDC sonra mı?
- O9-B. `on_behalf_of` süresi, tek kullanımlılık ve insan onayı nasıl tanımlanır?
- O9-C. Staging salt okuma allowlist'i ve üyelik matrisini kim onaylar?

İlgili belgeler:

- `docs/architecture/decisions/ADR-001-enterprise-authority-ownership.md`
- `docs/architecture/decisions/ADR-002-enterprise-principal-iam.md`
- `docs/architecture/decisions/ADR-006-release-security-ot.md`

**ADR taslak GO. Merge NO-GO. Canlı okuma, canlı yazma, SQL, secret, deploy ve OT NO-GO.**
