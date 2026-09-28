# Rötar Hesaplayıcı — Kurulum ve Yayına Alma

`server.ps1` + `start.bat` ikilisinin yerini alan, **her cihazdan** (telefon, PC, tablet)
tarayıcı üzerinden erişilebilen bir web uygulaması. Mantık birebir aynı (aynı regex'ler,
aynı medyan/referans rötar hesaplama), sadece PowerShell yerine Node.js ile yazıldı ve
tema baştan tasarlandı.

## Neden artık 127.0.0.1 değil?

Eski sürüm PowerShell'in kendi bilgisayarınızda açtığı `http://127.0.0.1:8788` adresinde
çalışıyordu — bu adrese sadece o bilgisayardan erişilebilir. Herkesin (ve telefonların)
kullanabilmesi için bu sunucunun **internete açık bir adreste** çalışması gerekiyor.
Aşağıdaki adımlardan birini seçerek bunu birkaç dakikada yapabilirsiniz.

---

## 1) En kolay yol: ücretsiz bir barındırma servisi (Render.com)

1. Bu klasörü bir GitHub deposuna yükleyin (Github Desktop veya `git` ile).
2. [render.com](https://render.com) üzerinde ücretsiz hesap açın → **New +** → **Web Service**.
3. GitHub deponuzu seçin. Ayarlar:
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Environment: Node
4. Deploy edince Render size sabit bir adres verir, örn:
   `https://rotar-hesaplayici.onrender.com`
5. Bu adresi telefonunuzdan, ofisteki herkesin bilgisayarından açabilirsiniz — kurulum
   gerekmez, sadece tarayıcıdan girilir. İsterseniz telefonda "Ana ekrana ekle" diyerek
   uygulama simgesi gibi kullanabilirsiniz (PWA desteği eklendi).

Railway.app veya Fly.io da aynı mantıkla çalışır, hepsi ücretsiz katman sunar.

## 2) Kendi sunucunuz / VPS varsa

```bash
npm install
node server.js          # varsayılan port 8788
# veya:
PORT=80 node server.js  # doğrudan 80 portunda
```

Kalıcı çalışması için `pm2` önerilir:
```bash
npm install -g pm2
pm2 start server.js --name rotar
pm2 save && pm2 startup
```

Bir alan adınız varsa Nginx ile ters proxy + Let's Encrypt (certbot) ekleyerek
`https://rotar.firmaniz.com` gibi kalıcı ve güvenli bir adres elde edebilirsiniz.

## 3) Docker ile (herhangi bir bulut sağlayıcısı)

```bash
docker build -t rotar-hesaplayici .
docker run -p 8788:8788 rotar-hesaplayici
```

Bu imajı Railway, Render, Fly.io, DigitalOcean App Platform gibi Docker destekleyen
her platforma doğrudan yükleyebilirsiniz.

## 4) Yerel test (kendi bilgisayarınızda denemek için)

```bash
cd rotar-app
npm install
node server.js
```
Tarayıcıdan `http://localhost:8788` açın. **Not:** bu sadece test amaçlıdır — bu haliyle
diğer cihazlardan erişilemez; kalıcı ve herkese açık kullanım için yukarıdaki 1., 2. veya
3. seçeneklerden birini uygulayın.

---

## Neler değişti / eklendi

- **PowerShell → Node.js**: Aynı parse/rötar hesaplama mantığı, ama artık herhangi bir
  sunucuda (Windows/Linux/Mac fark etmez) çalışabilir.
- **Yeni tema**: Koyu (ve otomatik açık) tema, mobil uyumlu, sekmeli yön/sefer görünümü,
  renkli rötar rozetleri (yeşil = zamanında, kırmızı = geç, sarı = erken).
- **PWA desteği**: `manifest.json` + `sw.js` sayesinde telefonda "Ana ekrana ekle" ile
  gerçek bir uygulama gibi ikon oluşturulabilir.
- **Kayıtlı araç yönetimi**: Sağ üstteki ⚙︎ simgesinden plaka/VehicleId/HatId ekleyip
  silebilirsiniz (eski `vehicles.json` verisi zaten içeri aktarıldı: `34M1681`).
- **Ağ erişimi bu ortamda kapalı olduğu için `npm install` ve canlı çalıştırma testi
  benim tarafımdan yapılamadı** — ayrıştırma (parsing) mantığını sahte bir HTML
  örneğiyle test ettim ve doğru sonuç verdiğini doğruladım, ama gerçek 3cmobil.com.tr
  sayfasıyla ilk çalıştırmada küçük bir HTML farkı çıkarsa haber verin, birlikte
  düzeltiriz.

## Dosya yapısı

```
rotar-app/
  server.js          → API + statik dosya sunucusu
  package.json
  vehicles.json       → kayıtlı plaka/araç verisi (mevcut verinizle dolduruldu)
  Dockerfile
  public/
    index.html
    style.css
    app.js
    manifest.json
    icon.svg
    sw.js
```
