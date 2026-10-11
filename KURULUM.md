# Rötar Hesaplayıcı — Kurulum (giriş sistemi YOK)

> Bu zip'i mevcut `rotar-app` klasörünün ÜSTÜNE aç ("aynı adlı dosyaları değiştir" de).
> `public/` klasörüne dokunulmaz; senin dosyaların olduğu gibi kalır.
> `public/` içindeki `login.html`, `account.html`, `device.html` artık kullanılmıyor, silebilirsin.

Şifre, kullanıcı ve cihaz kaydı sistemi tamamen kaldırıldı. Siteyi açan herkes
doğrudan uygulamayı görür ve plaka ekleyip silebilir. Adresi sadece güvendiğin
kişilerle paylaş.

## Render'da

Ortam değişkeni olarak sadece `DATABASE_URL` yeterli (araç listesi için).
`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_DAYS` artık gerekmiyor; silebilirsin.

```
cd C:\yol\rotar-app
git add .
git commit -m "giris sistemi kaldirildi"
git push
```

## Kendi bilgisayarında

```
npm install
node server.js
```
http://localhost:8788 (DATABASE_URL yoksa araçlar vehicles.json'da tutulur).

## Plaka ekleme

- Sitede ⚙︎ simgesinden ekle, ya da
- `vehicles.json`'a satır ekleyip `git push` yap (olmayanlar açılışta DB'ye eklenir).

## Notlar

- index.html'de `/logout` veya `/account.html` bağlantıları varsa kaldır.
- Veritabanında eski `users` ve `sessions` tabloları kalabilir; zararsızdır.
  İstersen: `DROP TABLE users, sessions;`
