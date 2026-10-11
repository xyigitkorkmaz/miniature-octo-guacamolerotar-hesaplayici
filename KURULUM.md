# Rötar Hesaplayıcı — Kurulum (giriş sistemi + veritabanı)

> Bu zip'i mevcut `rotar-app` klasörünün ÜSTÜNE aç ("aynı adlı dosyaları değiştir" de).
> `public/` içindeki index.html, app.js, style.css, manifest.json, icon.svg, sw.js
> zip'te YOK; senin klasöründeki hâlleri olduğu gibi kalacak. Sadece login.html ve
> account.html eklenir.

## Kullanıcı adı / şifre nereden belirlenir?

İlk yönetici hesabı, sunucu ilk açıldığında şu iki ortam değişkeninden oluşur:

- `ADMIN_USERNAME`  (örn. admin)
- `ADMIN_PASSWORD`  (en az 8 karakter)

Bunlar Render'da **Environment** sekmesinden girilir (aşağıda adım adım).
Not: Sadece kullanıcı tablosu BOŞKEN okunur. Sonradan değiştirmek istersen
siteye girip `/account.html` sayfasından şifreni değiştir; yeni kullanıcıları da
oradan ekle/sil.

## A) Render'da (kalıcı kullanım)

1. Render panelinde **New +** → **PostgreSQL** → ücretsiz plan → oluştur.
   Açılan sayfadaki **Internal Database URL**'i kopyala.
2. Web servisine (rotar-hesaplayici) gir → **Environment** → şunları ekle:
   - `DATABASE_URL`    = kopyaladığın Internal Database URL
   - `SESSION_SECRET`  = uzun rastgele bir yazı (örn. 40 karakter, klavyeden bas)
   - `ADMIN_USERNAME`  = admin
   - `ADMIN_PASSWORD`  = seçtiğin şifre
3. cmd aç ve kodu gönder:

```
cd C:\yol\rotar-app
git add .
git commit -m "giris sistemi ve veritabani"
git push
```

4. Render otomatik deploy eder. **Logs** sekmesinde şunları görmelisin:
   - "vehicles.json'dan 15 yeni araç veritabanına eklendi."
   - "İlk yönetici oluşturuldu: admin"
5. Siteyi aç → giriş ekranı gelir → ADMIN_USERNAME / ADMIN_PASSWORD ile gir.

(İstersen `render.yaml` ile **New + → Blueprint** yolunu da kullanabilirsin;
servis ve veritabanını tek seferde kurar ve ADMIN_PASSWORD'ü sorar.)

## B) Kendi bilgisayarında deneme

```
cd C:\yol\rotar-app
npm install
set ADMIN_USERNAME=admin
set ADMIN_PASSWORD=deneme1234
node server.js
```

Tarayıcıdan http://localhost:8788 aç. (DATABASE_URL yoksa araçlar vehicles.json'da,
kullanıcılar users.json'da tutulur; users.json git'e gitmez.)

## Plaka ekleme

İki yol da çalışır:
- Sitede ⚙︎ simgesinden ekle (anında kaydolur).
- `vehicles.json`'a satır ekleyip `git push` yap. Sunucu her açılışta dosyadaki
  veritabanında olmayan araçları ekler (var olanlara dokunmaz).
  Not: ⚙︎'den sildiğin bir plaka dosyada duruyorsa yeniden başlatmada geri gelir;
  silmek için dosyadan da çıkar.

## Dosyalar

```
rotar-app/
  server.js        → API + giriş sistemi + veritabanı
  package.json     → express + pg
  vehicles.json    → ilk açılışta DB'ye aktarılan araç listesi
  render.yaml      → (opsiyonel) Render Blueprint
  Dockerfile
  public/
    login.html     → giriş ekranı        (YENİ)
    account.html   → şifre / kullanıcılar (YENİ)
    index.html, app.js, style.css, ...   → senin mevcut dosyaların
```

index.html'e çıkış ve hesap bağlantısı eklemek için:
`<a href="/logout">Çıkış</a>`  ve  `<a href="/account.html">Hesap</a>`
