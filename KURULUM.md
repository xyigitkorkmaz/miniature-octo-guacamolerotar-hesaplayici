# Rötar Hesaplayıcı — Kurulum

> Bu zip'i mevcut `rotar-app` klasörünün ÜSTÜNE aç ("aynı adlı dosyaları değiştir" de).
> Eski `public/login.html`, `public/account.html`, `public/device.html` dosyalarını sil.

Giriş/şifre/üyelik sistemi yok. Siteyi açan herkes direkt kullanır.

## Tarife

Ücret sitede ayarlanmaz, kodda sabittir: her gecikme dakikası 100 ₺, özel duraklarda 200 ₺.
"Serbest dk" kutusu duruyor (15). Tarife `public/app.js` başında (ve `server.js` içinde aynı liste):

```js
const RATE_NORMAL = 100;  // ₺/dk
const RATE_SPECIAL = 200; // ₺/dk
const SPECIAL_STOPS_BY_GROUP = {
  "3": ["Happy Kavaklı"],
  "4": ["Elma Şekeri", "Yonca Fırın"],
};
```

Grup, raporun "N NOLU GRUP" yazısından anlaşılır. Durak eklemek/çıkarmak için bu listeyi
iki dosyada da düzenleyip push etmek yeterli. Büyük/küçük harf ve Türkçe karakter farkı sorun olmaz.

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
