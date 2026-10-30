# Kiosk pilot listesi — 2026-11-02

Tasarım ve `?portal=kiosk` kapısı. Masaüstü ve mobil, sorgu yokken aynı 2 saatlik hareketsizlik ve hatırlama kutusunu kullanır. Yeni sipariş veya görev motoru yok. `gorevler` BTD görevleridir. SHADOW kapalı olsa da kiosk BTD ekranını açar.

## Kural

- Ortak kiosk kullanıcısı yok. Kişi kendi adıyla girer.
- Parola kaydedilmez. Hatırlama kutusu gizlenir ve oturum `localStorage`’a yazılmaz.
- Hareketsizlik 5 dakikadır, sonra çıkış.
- Grup yöneticisi bayrağı kioskta düşer. Ayarlar yöneticisi açılmaz.
- Firma, üyeliktekidir. Sorgu, üyeliği olmayan firmayı seçtirmez.
- `015` bu pilotun sabahı çalıştırılmaz.

## 2 Kasım kontrolü

1. Aynı tarayıcıda `index.html` açın. Sorgu yok. Hatırlama kutusu görünsün. Giriş sonrası firma değiştirme masaüstündeki gibi kalsın.
2. Adresin sonuna `?portal=kiosk` ekleyin. Hatırlama ve firma kutusu gizlensin. Parola alanı `autocomplete=off` olsun.
3. Mavi yaka bir kişiyle girin. Fiyat sayfaları kapalı kalsın. Adı kendi adı olsun.
4. Yönetici hesabıyla kioskta girin. Ayarlarda kullanıcı yönetimi açılmasın. Masaüstünde, sorgusuz, aynı hesap yönetici kalsın.
5. 5 dakika dokunmayın. Oturum kapansın. Parola tarayıcı deposunda BTD oturum anahtarında olmasın.
6. SHADOW ucunu boş bırakın. Kiosk yine BTD ekranına gelsin. SHADOW yanıtı, çağrılırsa `UNAVAILABLE` olsun, sipariş ekranı onun için durmasın.
7. Pilot bitince sekmeyi kapatın. `016` veya hesap çözme gerekmez; bu kapı yalnız sorgu parametresidir.

Üretim GO değildir.
