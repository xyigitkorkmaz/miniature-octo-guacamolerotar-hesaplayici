# Rötar Hesaplayıcı — Kurulum

> Bu zip'i mevcut `rotar-app` klasörünün ÜSTÜNE aç ("aynı adlı dosyaları değiştir" de).
> Eski `public/login.html`, `public/account.html`, `public/device.html` dosyalarını sil.

Giriş/şifre/üyelik sistemi yok. Siteyi açan herkes direkt kullanır.

## Özel duraklar (100 ₺/dk)

Sitedeki "Özel duraklar" kutusu kaldırıldı. Duraklar `public/app.js` başında sabit:

```js
const SPECIAL_RATE = 100; // ₺/dk
const SPECIAL_STOPS_BY_GROUP = {
  "4": ["Akal Evler", "Elma Şekeri"],
  "3": ["Bağlar Cad."],
};
```

Grup, raporun "N NOLU GRUP" yazısından anlaşılır. Durak eklemek/çıkarmak için bu listeyi
düzenleyip push etmek yeterli. Büyük/küçük harf ve Türkçe karakter farkı sorun olmaz.

## Gönderme

```
cd C:\yol\rotar-app
git add .
git commit -m "ozel duraklar koda alindi"
git push
```

Render otomatik yayınlar. Gerekirse `DATABASE_URL` ortam değişkeni yeterli.

## Yerel

```
npm install
node server.js
```
http://localhost:8788
