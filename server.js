// Rötar Hesaplayıcı - Node.js sunucusu
// server.ps1 dosyasındaki mantığın birebir JavaScript karşılığıdır.
// Herhangi bir barındırma servisinde (Render, Railway, Fly.io, bir VPS, vb.)
// çalışacak şekilde tasarlanmıştır; 127.0.0.1'e bağlı değildir.

import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import crypto from "crypto";
import { promisify } from "util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8788;
const VEHICLES_PATH = path.join(__dirname, "vehicles.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// ====================== Kullanıcılar & oturum ======================
// <auth-helpers>
const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = "rotar_session";
const SESSION_DAYS = 30;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET tanımlı değil: sunucu her yeniden başlatıldığında herkes çıkış yapar.");
}
let DUMMY_HASH = "";

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Şifre değişince eski oturumlar geçersiz olsun diye token'a şifre özetinin parmak izi girer
function fingerprint(passwordHash) {
  return crypto.createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

function signToken(user) {
  const payload = Buffer.from(
    JSON.stringify({ u: user.username, h: fingerprint(user.passwordHash), exp: Date.now() + SESSION_DAYS * 864e5 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function readToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return d.exp > Date.now() ? d : null;
  } catch {
    return null;
  }
}
// </auth-helpers>

function getCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const parts = [`${COOKIE_NAME}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (req.secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

const normalizeUsername = (u) => String(u || "").trim().toLowerCase();
const validUsername = (u) => /^[a-z0-9._-]{3,32}$/.test(u);
const validPassword = (p) => typeof p === "string" && p.length >= 8 && p.length <= 200;
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---- Kullanıcı deposu (PostgreSQL; DATABASE_URL yoksa users.json) ----
const USERS_PATH = path.join(__dirname, "users.json");

async function readUsersFile() {
  try {
    const raw = await fs.readFile(USERS_PATH, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
const writeUsersFile = (o) => fs.writeFile(USERS_PATH, JSON.stringify(o, null, 2), "utf8");

function rowToUser(r) {
  return { username: r.username, passwordHash: r.password_hash, role: r.role, createdAt: r.created_at };
}

async function getUser(username) {
  if (!username) return null;
  if (!pool) return (await readUsersFile())[username] || null;
  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

async function listUsers() {
  if (!pool) return Object.values(await readUsersFile());
  const { rows } = await pool.query("SELECT * FROM users ORDER BY created_at");
  return rows.map(rowToUser);
}

async function createUser(username, passwordHash, role) {
  if (!pool) {
    const all = await readUsersFile();
    if (all[username]) return false;
    all[username] = { username, passwordHash, role, createdAt: new Date().toISOString() };
    await writeUsersFile(all);
    return true;
  }
  const r = await pool.query(
    "INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    [username, passwordHash, role]
  );
  return r.rowCount === 1;
}

async function setUserPassword(username, passwordHash) {
  if (!pool) {
    const all = await readUsersFile();
    if (all[username]) all[username].passwordHash = passwordHash;
    await writeUsersFile(all);
    return;
  }
  await pool.query("UPDATE users SET password_hash = $2 WHERE username = $1", [username, passwordHash]);
}

async function removeUser(username) {
  if (!pool) {
    const all = await readUsersFile();
    delete all[username];
    await writeUsersFile(all);
    return;
  }
  await pool.query("DELETE FROM users WHERE username = $1", [username]);
}

async function initUsers() {
  DUMMY_HASH = await hashPassword("dummy-password");
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        username      TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  } else {
    console.warn("DATABASE_URL tanımlı değil: kullanıcılar users.json'da tutuluyor (Render'da kalıcı değildir!)");
  }
  if ((await listUsers()).length > 0) return;

  const username = normalizeUsername(process.env.ADMIN_USERNAME || "admin");
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!validPassword(password)) {
    password = crypto.randomBytes(9).toString("base64url");
    generated = true;
  }
  await createUser(username, await hashPassword(password), "admin");
  if (generated) {
    console.log(`İlk yönetici oluşturuldu -> kullanıcı: ${username}  şifre: ${password}  (giriş yapınca değiştir!)`);
  } else {
    console.log(`İlk yönetici oluşturuldu: ${username}`);
  }
}

// ---- Giriş (kapının dışında) ----
const loginAttempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (loginAttempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  loginAttempts.set(ip, recent);
  return recent.length >= 10;
}

app.post("/api/auth/login", wrap(async (req, res) => {
  if (tooManyAttempts(req.ip)) {
    return res.status(429).json({ error: "Çok fazla deneme. 15 dakika sonra tekrar dene." });
  }
  const { username: uIn, password } = req.body || {};
  const user = await getUser(normalizeUsername(uIn));
  const ok = await verifyPassword(String(password || ""), user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    loginAttempts.get(req.ip).push(Date.now());
    return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
  }
  loginAttempts.delete(req.ip);
  setSessionCookie(req, res, signToken(user), SESSION_DAYS * 86400);
  res.json({ ok: true, username: user.username, role: user.role });
}));

// ---- Kapı: bundan sonraki her şey giriş ister ----
const PUBLIC_PATHS = new Set(["/login.html", "/manifest.json", "/icon.svg", "/sw.js", "/favicon.ico"]);

app.use(async (req, res, next) => {
  try {
    if (PUBLIC_PATHS.has(req.path)) return next();
    const session = readToken(getCookie(req, COOKIE_NAME));
    const user = session ? await getUser(session.u) : null;
    if (user && session.h === fingerprint(user.passwordHash)) {
      req.user = { username: user.username, role: user.role };
      return next();
    }
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Giriş gerekli" });
    return res.redirect("/login.html");
  } catch (err) {
    next(err);
  }
});

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Bu işlem için yönetici olmalısın" });
  next();
}

app.get("/api/me", (req, res) => res.json(req.user));

app.get("/logout", (req, res) => {
  setSessionCookie(req, res, "", 0);
  res.redirect("/login.html");
});
app.post("/api/auth/logout", (req, res) => {
  setSessionCookie(req, res, "", 0);
  res.json({ ok: true });
});

app.post("/api/me/password", wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = await getUser(req.user.username);
  if (!(await verifyPassword(String(currentPassword || ""), user.passwordHash))) {
    return res.status(400).json({ error: "Mevcut şifre hatalı" });
  }
  if (!validPassword(newPassword)) return res.status(400).json({ error: "Yeni şifre en az 8 karakter olmalı" });
  user.passwordHash = await hashPassword(newPassword);
  await setUserPassword(user.username, user.passwordHash);
  setSessionCookie(req, res, signToken(user), SESSION_DAYS * 86400); // bu oturum devam etsin
  res.json({ ok: true });
}));

// ---- Yönetici: kullanıcı yönetimi ----
app.get("/api/admin/users", requireAdmin, wrap(async (req, res) => {
  const users = await listUsers();
  res.json(users.map((u) => ({ username: u.username, role: u.role, createdAt: u.createdAt })));
}));

app.post("/api/admin/users", requireAdmin, wrap(async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body || {};
  const role = req.body?.role === "admin" ? "admin" : "user";
  if (!validUsername(username)) {
    return res.status(400).json({ error: "Kullanıcı adı 3-32 karakter olmalı (harf, rakam, . _ -)" });
  }
  if (!validPassword(password)) return res.status(400).json({ error: "Şifre en az 8 karakter olmalı" });
  const created = await createUser(username, await hashPassword(password), role);
  if (!created) return res.status(409).json({ error: "Bu kullanıcı adı zaten var" });
  res.json({ username, role });
}));

app.put("/api/admin/users/:username/password", requireAdmin, wrap(async (req, res) => {
  const username = normalizeUsername(req.params.username);
  if (!(await getUser(username))) return res.status(404).json({ error: "Kullanıcı bulunamadı" });
  if (!validPassword(req.body?.password)) return res.status(400).json({ error: "Şifre en az 8 karakter olmalı" });
  await setUserPassword(username, await hashPassword(req.body.password));
  res.json({ ok: true });
}));

app.delete("/api/admin/users/:username", requireAdmin, wrap(async (req, res) => {
  const username = normalizeUsername(req.params.username);
  if (username === req.user.username) return res.status(400).json({ error: "Kendi hesabını silemezsin" });
  await removeUser(username);
  res.json({ ok: true });
}));

app.use(express.static(PUBLIC_DIR));

// ---------- Yardımcı fonksiyonlar ----------

// ---------- Veri depolama (PostgreSQL; DATABASE_URL yoksa vehicles.json'a düşer) ----------

const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL
  ? new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
    })
  : null;

async function readVehiclesFile() {
  try {
    const raw = await fs.readFile(VEHICLES_PATH, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function rowToEntry(r) {
  return { plaka: r.plaka, vehicleId: r.vehicle_id, hatId: r.hat_id, kod: r.kod, hatAdi: r.hat_adi };
}

async function initDb() {
  if (!pool) {
    console.warn("DATABASE_URL tanımlı değil: vehicles.json kullanılıyor (Render'da kalıcı değildir!)");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      plaka      TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL,
      hat_id     TEXT NOT NULL DEFAULT '',
      kod        TEXT NOT NULL DEFAULT '',
      hat_adi    TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // vehicles.json'daki araçlardan veritabanında OLMAYANLARI ekle (var olanlara dokunmaz).
  // Böylece vehicles.json'a plaka ekleyip push etmek eskisi gibi çalışır.
  const seed = await readVehiclesFile();
  let added = 0;
  for (const v of Object.values(seed)) {
    const r = await pool.query(
      `INSERT INTO vehicles (plaka, vehicle_id, hat_id, kod, hat_adi)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (plaka) DO NOTHING`,
      [normalizePlaka(v.plaka), String(v.vehicleId), v.hatId || "", v.kod || "", v.hatAdi || ""]
    );
    added += r.rowCount;
  }
  if (added) console.log(`vehicles.json'dan ${added} yeni araç veritabanına eklendi.`);
}

// Eski formatla aynı: { "34M1681": { plaka, vehicleId, hatId, kod, hatAdi }, ... }
async function readVehicles() {
  if (!pool) return readVehiclesFile();
  const { rows } = await pool.query("SELECT * FROM vehicles ORDER BY plaka");
  return Object.fromEntries(rows.map((r) => [r.plaka, rowToEntry(r)]));
}

async function getVehicle(plaka) {
  if (!pool) return (await readVehiclesFile())[plaka] || null;
  const { rows } = await pool.query("SELECT * FROM vehicles WHERE plaka = $1", [plaka]);
  return rows[0] ? rowToEntry(rows[0]) : null;
}

async function upsertVehicle(e) {
  if (!pool) {
    const all = await readVehiclesFile();
    all[e.plaka] = e;
    await fs.writeFile(VEHICLES_PATH, JSON.stringify(all, null, 2), "utf8");
    return e;
  }
  await pool.query(
    `INSERT INTO vehicles (plaka, vehicle_id, hat_id, kod, hat_adi)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (plaka) DO UPDATE
       SET vehicle_id = EXCLUDED.vehicle_id, hat_id = EXCLUDED.hat_id,
           kod = EXCLUDED.kod, hat_adi = EXCLUDED.hat_adi, updated_at = now()`,
    [e.plaka, e.vehicleId, e.hatId, e.kod, e.hatAdi]
  );
  return e;
}

async function deleteVehicle(plaka) {
  if (!pool) {
    const all = await readVehiclesFile();
    delete all[plaka];
    await fs.writeFile(VEHICLES_PATH, JSON.stringify(all, null, 2), "utf8");
    return;
  }
  await pool.query("DELETE FROM vehicles WHERE plaka = $1", [plaka]);
}

function normalizePlaka(plaka) {
  if (!plaka) return "";
  return plaka.toUpperCase().replace(/[\s-]/g, "");
}

function clockToSeconds(clock) {
  if (!clock) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(clock);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + mi * 60 + s;
}

function secondsToClock(seconds) {
  if (seconds === null || seconds === undefined) return null;
  const day = Math.floor(seconds / 86400);
  let rem = Math.trunc(seconds % 86400);
  if (rem < 0) rem += 86400;
  const h = Math.floor(rem / 3600);
  const mi = Math.floor((rem % 3600) / 60);
  const s = Math.floor(rem % 60);
  const clock = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return day > 0 ? `${clock}+${day}` : clock;
}

function median(values) {
  const arr = values.filter((v) => v !== null && v !== undefined);
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor((n - 1) / 2);
  if (n % 2 === 1) return sorted[mid];
  return (sorted[mid] + sorted[mid + 1]) / 2;
}

const NAMED_ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
};

function decodeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, name) => NAMED_ENTITIES[name]);
}

function cleanStopName(name) {
  let t = decodeHtml(name || "");
  t = t.replace(/<br\s*\/?>/gis, " ");
  t = t.replace(/<[^>]+>/gs, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function parseCell(inner) {
  const times = [...inner.matchAll(/>(\d{2}:\d{2}:\d{2})</g)].map((m) => m[1]);
  let site = null;
  const siteMatch = /<span[^>]*>\s*([+-]?\d+)\s*<\/span>/.exec(inner);
  if (siteMatch) site = parseInt(siteMatch[1], 10);
  return {
    giris: times[0] ?? null,
    cikis: times[1] ?? null,
    siteRotar: site,
  };
}

function parseReportHtml(html) {
  let hatAdi = null;
  const hatMatch = />([^<]*GRUP[^<]*)</.exec(html);
  if (hatMatch) hatAdi = decodeHtml(hatMatch[1]).trim();

  let kod = null;
  const kodMatch = /<td[^>]*>\s*([A-Z]{1,4}\d{1,4})\s*<\/td>\s*<td[^>]*>\s*[0-9A-Z]+/.exec(html);
  if (kodMatch) kod = kodMatch[1];

  const tableMatches = [...html.matchAll(/<table[^>]*>\s*<thead[^>]*>.*?<\/table>/gis)];
  const directions = [];
  let dirIndex = 0;

  for (const tm of tableMatches) {
    const table = tm[0];
    if (!/Sefer/.test(table)) continue;

    const ths = [...table.matchAll(/<th[^>]*>(.*?)<\/th>/gis)].map((m) => cleanStopName(m[1]));
    if (ths.length < 4) continue;

    const stopNames = ths.slice(2);

    const trs = [...table.matchAll(/<tr>(.*?)<\/tr>/gis)];
    const trips = [];
    for (const trM of trs) {
      const row = trM[1];
      if (/<th/i.test(row)) continue;
      const tds = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gis)].map((m) => m[1]);
      if (tds.length < 3) continue;

      const seferRaw = cleanStopName(tds[0]);
      const sefer = parseInt(seferRaw, 10) || 0;
      let orer = null;
      const orerMatch = /(\d{2}:\d{2}:\d{2})/.exec(tds[1]);
      if (orerMatch) orer = orerMatch[1];

      const stops = [];
      for (let i = 2; i < tds.length; i++) {
        const parsed = parseCell(tds[i]);
        const name = i - 2 < stopNames.length ? stopNames[i - 2] : `Durak ${i - 1}`;
        stops.push({ ad: name, giris: parsed.giris, cikis: parsed.cikis, siteRotar: parsed.siteRotar });
      }

      trips.push({ sefer, orer, stops });
    }

    dirIndex++;
    const dirName = dirIndex === 1 ? "Gidis" : dirIndex === 2 ? "Donus" : `Yon ${dirIndex}`;
    directions.push({ ad: dirName, duraklar: stopNames, seferler: trips });
  }

  return { hatAdi, kod, yonler: directions };
}

function addDelayCalculations(parsed) {
  for (const yon of parsed.yonler) {
    const stopCount = yon.duraklar.length;
    const offsetLists = Array.from({ length: stopCount }, () => []);

    for (const sefer of yon.seferler) {
      let startSec = null;
      for (const st of sefer.stops) {
        const sec = clockToSeconds(st.giris);
        if (sec !== null) { startSec = sec; break; }
      }
      if (startSec === null) continue;

      let prev = startSec;
      for (let s = 0; s < stopCount && s < sefer.stops.length; s++) {
        let sec = clockToSeconds(sefer.stops[s].giris);
        if (sec === null) continue;
        if (sec + 6 * 3600 < prev) sec += 86400;
        offsetLists[s].push(sec - startSec);
        prev = sec;
      }
    }

    const medianOffsets = offsetLists.map((list) => median(list));

    let refTrip = null;
    for (const sefer of yon.seferler) {
      if (sefer.stops.some((st) => st.giris)) { refTrip = sefer; break; }
    }

    const refOffsets = [];
    if (refTrip) {
      let refStart = null;
      for (const st of refTrip.stops) {
        const sec = clockToSeconds(st.giris);
        if (sec !== null) { refStart = sec; break; }
      }
      let prev = refStart;
      for (let s = 0; s < stopCount; s++) {
        let sec = s < refTrip.stops.length ? clockToSeconds(refTrip.stops[s].giris) : null;
        if (sec === null || refStart === null) { refOffsets.push(null); continue; }
        if (sec + 6 * 3600 < prev) sec += 86400;
        refOffsets.push(sec - refStart);
        prev = sec;
      }
    }

    yon.medyanOffsetSn = medianOffsets;
    yon.referansOffsetSn = refOffsets;

    for (const sefer of yon.seferler) {
      let startSec = null;
      for (const st of sefer.stops) {
        const sec = clockToSeconds(st.giris);
        if (sec !== null) { startSec = sec; break; }
      }

      let prev = startSec;
      for (let s = 0; s < sefer.stops.length; s++) {
        const st = sefer.stops[s];
        let actual = clockToSeconds(st.giris);
        if (actual !== null && prev !== null && actual + 6 * 3600 < prev) actual += 86400;
        if (actual !== null) prev = actual;

        let planMedyan = null;
        let planRef = null;
        if (startSec !== null && s < medianOffsets.length && medianOffsets[s] !== null) {
          planMedyan = Math.round(startSec + medianOffsets[s]);
        }
        if (startSec !== null && s < refOffsets.length && refOffsets[s] !== null) {
          planRef = Math.round(startSec + refOffsets[s]);
        }

        let rotarMedyan = null;
        let rotarRef = null;
        if (actual !== null && planMedyan !== null) rotarMedyan = Math.round((actual - planMedyan) / 60);
        if (actual !== null && planRef !== null) rotarRef = Math.round((actual - planRef) / 60);

        st.planlananMedyan = secondsToClock(planMedyan);
        st.planlananReferans = secondsToClock(planRef);
        st.rotarMedyanDk = rotarMedyan;
        st.rotarReferansDk = rotarRef;
        st.rotarSiteDk = st.siteRotar;
      }
    }
  }
  return parsed;
}

async function getReport(plakaIn, date, vehicleIdIn, hatIdIn) {
  const plaka = normalizePlaka(plakaIn);
  const known = await getVehicle(plaka);

  let vehicleId = vehicleIdIn || (known ? String(known.vehicleId) : "");
  let hatId = hatIdIn || (known ? String(known.hatId) : "");
  if (!date) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    date = d.toISOString().slice(0, 10);
  }

  if (!vehicleId) {
    throw new Error("Bu plaka kayitli degil. Vehicle ID girmen gerekiyor (ornek: 9661).");
  }

  let url = `https://3cmobil.com.tr/AD_AracbazliRapor.aspx?VehicleId=${encodeURIComponent(vehicleId)}&EndDate=${encodeURIComponent(date)}&Plaka=${encodeURIComponent(plaka)}`;
  if (hatId) url += `&HatId=${encodeURIComponent(hatId)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let html;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "RotarHesaplayici/1.0" },
      signal: controller.signal,
    });
    html = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  if (!/ltrAracRapor/.test(html) && !/Sefer/.test(html)) {
    throw new Error("Rapor HTML'i beklenen tablolari icermiyor. VehicleId/HatId/tarih kontrol et.");
  }

  let parsed = parseReportHtml(html);
  parsed = addDelayCalculations(parsed);
  parsed.plaka = plaka;
  parsed.vehicleId = vehicleId;
  parsed.hatId = hatId;
  parsed.tarih = date;
  parsed.kaynakUrl = url;
  if (known && known.kod && !parsed.kod) parsed.kod = known.kod;
  return parsed;
}

// ---------- API rotaları ----------

app.get("/api/vehicles", async (req, res) => {
  res.json(await readVehicles());
});

app.post("/api/vehicles", async (req, res) => {
  const { plaka: plakaIn, vehicleId, hatId, kod, hatAdi } = req.body || {};
  const plaka = normalizePlaka(plakaIn);
  if (!plaka || !vehicleId) {
    return res.status(400).json({ error: "plaka ve vehicleId gerekli" });
  }
  const entry = { plaka, vehicleId: String(vehicleId), hatId: hatId ? String(hatId) : "", kod: kod ? String(kod) : "", hatAdi: hatAdi ? String(hatAdi) : "" };
  await upsertVehicle(entry);
  res.json(entry);
});

app.delete("/api/vehicles/:plaka", async (req, res) => {
  const plaka = normalizePlaka(req.params.plaka);
  await deleteVehicle(plaka);
  res.json({ ok: true });
});

app.get("/api/report", async (req, res) => {
  const { plaka, date, vehicleId, hatId } = req.query;
  try {
    const data = await getReport(plaka, date, vehicleId, hatId);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Sunucu hatası" });
});

await initDb();
await initUsers();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Rötar hesaplayıcı çalışıyor: http://0.0.0.0:${PORT}`);
});
