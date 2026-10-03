const $ = (sel) => document.querySelector(sel);

const queryForm = $("#queryForm");
const submitBtn = $("#submitBtn");
const errorBox = $("#errorBox");
const resultBox = $("#resultBox");
const emptyState = $("#emptyState");
const directionTabs = $("#directionTabs");
const directionStatsEl = $("#directionStats");
const tripTabs = $("#tripTabs");
const tableWrap = $("#tableWrap");
const resultPlaka = $("#resultPlaka");
const resultMeta = $("#resultMeta");

const freeMinutesInput = $("#freeMinutes");
const ratePerMinuteInput = $("#ratePerMinute");
const specialStopsInput = $("#specialStops");
const specialRateInput = $("#specialRatePerMinute");
const feeTotalDelayEl = $("#feeTotalDelay");
const feeBillableEl = $("#feeBillable");
const feeTotalEl = $("#feeTotal");

const settingsBtn = $("#settingsBtn");
const settingsModal = $("#settingsModal");
const closeSettings = $("#closeSettings");
const vehicleForm = $("#vehicleForm");
const vehicleList = $("#vehicleList");

let currentData = null;
let activeDir = 0;
let activeTrip = 0;
let knownVehicles = {};

// Bugünden bir önceki günü varsayılan tarih yap
$("#tarih").value = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

function normalizePlaka(p) {
  return (p || "").toUpperCase().replace(/[\s-]/g, "");
}

async function loadVehicles() {
  const res = await fetch("/api/vehicles");
  knownVehicles = await res.json();
  renderVehicleList();
  renderPlakaOptions();
}

function renderPlakaOptions() {
  const select = $("#plaka");
  const previous = select.value;
  const entries = Object.values(knownVehicles).sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"));

  select.innerHTML = `<option value="" disabled>Araç seçin…</option>`;
  for (const v of entries) {
    const opt = document.createElement("option");
    opt.value = v.plaka;
    opt.textContent = v.hatAdi ? `${v.plaka} — ${v.hatAdi}` : v.plaka;
    select.appendChild(opt);
  }

  if (entries.length === 0) {
    select.querySelector("option").textContent = "Önce ⚙︎ menüsünden araç ekleyin";
  }

  // Önceki seçim hâlâ listede varsa koru
  if (previous && knownVehicles[previous]) {
    select.value = previous;
  } else {
    select.selectedIndex = 0;
  }
}

function renderVehicleList() {
  vehicleList.innerHTML = "";
  const entries = Object.values(knownVehicles);
  if (entries.length === 0) {
    vehicleList.innerHTML = `<p style="color:var(--text-dim);font-size:13px;">Henüz kayıtlı araç yok.</p>`;
    return;
  }
  for (const v of entries) {
    const row = document.createElement("div");
    row.className = "vehicle-row";
    row.innerHTML = `
      <div>
        <div class="vplaka">${v.plaka}</div>
        <div class="vmeta">VID ${v.vehicleId}${v.hatId ? " · Hat " + v.hatId : ""}${v.kod ? " · " + v.kod : ""}</div>
      </div>
      <button data-plaka="${v.plaka}">Sil</button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      await fetch(`/api/vehicles/${encodeURIComponent(v.plaka)}`, { method: "DELETE" });
      await loadVehicles();
    });
    vehicleList.appendChild(row);
  }
}

// Plaka seçilince kayıtlı VehicleId'yi otomatik doldur
$("#plaka").addEventListener("change", (e) => {
  const p = normalizePlaka(e.target.value);
  const known = knownVehicles[p];
  $("#vehicleId").value = known ? known.vehicleId : "";
});

queryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const plaka = $("#plaka").value.trim();
  const tarih = $("#tarih").value;
  const vehicleId = $("#vehicleId").value.trim();

  errorBox.hidden = true;
  setLoading(true);

  try {
    const params = new URLSearchParams({ plaka });
    if (tarih) params.set("date", tarih);
    if (vehicleId) params.set("vehicleId", vehicleId);

    const res = await fetch(`/api/report?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Bilinmeyen hata");

    currentData = data;
    activeDir = 0;
    activeTrip = 0;
    renderResult();
    await loadVehicles(); // yeni öğrenilen kod/hatAdi olabilir
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.querySelector(".spinner").hidden = !loading;
  submitBtn.querySelector(".btn-label").textContent = loading ? "Getiriliyor…" : "Rapor Getir";
}

function showError(msg) {
  errorBox.hidden = false;
  errorBox.textContent = msg;
  resultBox.hidden = true;
  emptyState.hidden = false;
}

function renderResult() {
  emptyState.hidden = true;
  resultBox.hidden = false;

  resultPlaka.textContent = currentData.plaka;
  const kodPart = currentData.kod ? ` · ${currentData.kod}` : "";
  const hatPart = currentData.hatAdi ? ` · ${currentData.hatAdi}` : "";
  const vidPart = currentData.hatId ? `Vehicle ${currentData.vehicleId} / Hat ${currentData.hatId}` : `Vehicle ${currentData.vehicleId}`;
  resultMeta.textContent = `${currentData.tarih}${kodPart}${hatPart} · ${vidPart}`;

  renderDirectionTabs();
  renderTripChips();
  renderTable();
  renderFee();
}

// ---------- Rötar ücreti hesaplama ----------

function parseSpecialStopNames() {
  return (specialStopsInput.value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isSpecialStop(stopName, specials) {
  if (!stopName) return false;
  const name = stopName.toLocaleLowerCase("tr-TR");
  return specials.some((s) => name.includes(s.toLocaleLowerCase("tr-TR")));
}

function delayBuckets() {
  // Tüm yönler, tüm seferler, tüm duraklardaki POZİTİF (geç kalma) rötar
  // dakikaları, "özel durak" olup olmamasına göre iki gruba ayrılır.
  // Sitenin kendi hesapladığı resmi değerler kullanılıyor. Giriş verisi olup
  // sapma yazılmamışsa "zamanında" (0) kabul edilir; giriş verisi hiç
  // yoksa hesaba katılmaz.
  let normal = 0;
  let special = 0;
  if (!currentData) return { normal, special };
  const specials = parseSpecialStopNames();
  for (const yon of currentData.yonler) {
    for (const sefer of yon.seferler) {
      for (const st of sefer.stops) {
        const rotar = st.giris && typeof st.rotarSiteDk !== "number" ? 0 : st.rotarSiteDk;
        if (typeof rotar === "number" && rotar > 0) {
          if (isSpecialStop(st.ad, specials)) special += rotar;
          else normal += rotar;
        }
      }
    }
  }
  return { normal, special };
}

function totalDelayMinutes() {
  const { normal, special } = delayBuckets();
  return normal + special;
}

function renderFee() {
  if (!currentData) return;
  const freeMinutes = Math.max(0, Number(freeMinutesInput.value) || 0);
  const rate = Math.max(0, Number(ratePerMinuteInput.value) || 0);
  const specialRate = Math.max(0, Number(specialRateInput.value) || 0);

  const { normal, special } = delayBuckets();
  const total = normal + special;

  // İlk 15 dakikalık serbest süre önce normal (düşük ücretli) duraklardan
  // düşülür, kalan varsa özel duraklardan düşülür.
  const normalAfterFree = Math.max(0, normal - freeMinutes);
  const remainingFree = Math.max(0, freeMinutes - normal);
  const specialAfterFree = Math.max(0, special - remainingFree);

  const billable = normalAfterFree + specialAfterFree;
  const fee = Math.round(normalAfterFree * rate + specialAfterFree * specialRate);

  feeTotalDelayEl.textContent = `${total} dk`;
  feeBillableEl.textContent = `${billable} dk`;
  feeTotalEl.textContent = `${fee.toLocaleString("tr-TR")} ₺`;
}

freeMinutesInput?.addEventListener("input", renderFee);
ratePerMinuteInput?.addEventListener("input", renderFee);
specialStopsInput?.addEventListener("input", renderFee);
specialRateInput?.addEventListener("input", renderFee);

// ---------- Yön özeti (sefer sayısı, ortalama/maks rötar) ----------

function renderDirectionStats() {
  const yon = currentData?.yonler?.[activeDir];
  if (!yon) { directionStatsEl.innerHTML = ""; return; }

  let sum = 0, count = 0, max = null;
  for (const sefer of yon.seferler) {
    for (const st of sefer.stops) {
      const rotar = st.giris && typeof st.rotarSiteDk !== "number" ? 0 : st.rotarSiteDk;
      if (typeof rotar === "number") {
        sum += rotar;
        count++;
        if (max === null || rotar > max) max = rotar;
      }
    }
  }
  const avg = count ? (sum / count).toFixed(1) : "—";

  directionStatsEl.innerHTML = `
    <span>${yon.seferler.length} sefer</span>
    <span>·</span>
    <span>Ortalama rötar: ${avg} dk</span>
    <span>·</span>
    <span>En yüksek: ${max ?? "—"} dk</span>
  `;
}

function renderDirectionTabs() {
  directionTabs.innerHTML = "";
  currentData.yonler.forEach((yon, i) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (i === activeDir ? " active" : "");
    btn.textContent = yon.ad;
    btn.addEventListener("click", () => {
      activeDir = i;
      activeTrip = 0;
      renderDirectionTabs();
      renderDirectionStats();
      renderTripChips();
      renderTable();
    });
    directionTabs.appendChild(btn);
  });
  renderDirectionStats();
}

function renderTripChips() {
  tripTabs.innerHTML = "";
  const yon = currentData.yonler[activeDir];
  if (!yon) return;
  yon.seferler.forEach((sefer, i) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (i === activeTrip ? " active" : "");
    chip.textContent = `Sefer ${sefer.sefer}${sefer.orer ? " · " + sefer.orer : ""}`;
    chip.addEventListener("click", () => {
      activeTrip = i;
      renderTripChips();
      renderTable();
    });
    tripTabs.appendChild(chip);
  });
}

function delayBadge(minutes) {
  if (minutes === null || minutes === undefined) return `<span class="badge neutral">—</span>`;
  if (minutes === 0) return `<span class="badge good">0 dk</span>`;
  if (minutes > 0) return `<span class="badge bad">+${minutes} dk</span>`;
  return `<span class="badge warn">${minutes} dk</span>`;
}

function renderTable() {
  const yon = currentData.yonler[activeDir];
  const sefer = yon?.seferler?.[activeTrip];
  if (!sefer) {
    tableWrap.innerHTML = `<p style="padding:16px;color:var(--text-dim);">Bu yön için sefer bulunamadı.</p>`;
    return;
  }

  const rows = sefer.stops.map((st) => {
    // Site, sadece sapma olan duraklara sayı basıyor; giriş verisi var ama
    // sapma sayısı yoksa bu durak zamanında demektir (0 dk).
    const rotar = st.giris && typeof st.rotarSiteDk !== "number" ? 0 : st.rotarSiteDk;
    return `
    <tr>
      <td class="stop-name">${st.ad}</td>
      <td>${st.giris ?? "—"}</td>
      <td>${st.cikis ?? "—"}</td>
      <td>${delayBadge(rotar)}</td>
    </tr>
  `;
  }).join("");

  tableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Durak</th>
          <th>Giriş</th>
          <th>Çıkış</th>
          <th>Rötar</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---------- Ayarlar modalı ----------

settingsBtn.addEventListener("click", () => { settingsModal.hidden = false; });
closeSettings.addEventListener("click", () => { settingsModal.hidden = true; });
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) settingsModal.hidden = true;
});

vehicleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(vehicleForm);
  const payload = Object.fromEntries(fd.entries());
  const res = await fetch("/api/vehicles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    vehicleForm.reset();
    await loadVehicles();
  }
});

loadVehicles();

// PWA service worker (ana ekrana eklenebilir hale getirir)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
