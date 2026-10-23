// Neraca Bapok Nasional — dashboard statis.
// Data dibaca langsung dari Google Sheets (selalu terbaru); jika gagal, pakai snapshot di data/snapshot.js.

const SHEET_ID = "1qximmc_hwlZ-_UuYao45VDJ5XU-YwSF22ZYPOayO7pY";
const KOMODITAS = ["Cabai Rawit", "Cabai Merah", "Bawang Merah", "Telur Ayam", "Daging Ayam", "Daging Sapi"];
const SHEET_HARGA = "Harga";
const SHEET_PELAKU = "Pelaku Usaha";
const SATUAN = "ton";
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Baris subtotal regional di spreadsheet (bukan provinsi).
const REGIONAL = new Set(["Sumatera", "Jawa", "Bali - Nusra", "Kalimantan", "Sulawesi", "Maluku - Papua", "Indonesia"]);

// Titik perkiraan ibu kota / pusat provinsi [lat, lng].
const KOORDINAT = {
  "Aceh": [5.55, 95.32], "Sumatera Utara": [3.59, 98.67], "Sumatera Barat": [-0.95, 100.35],
  "Riau": [0.51, 101.45], "Jambi": [-1.61, 103.61], "Sumatera Selatan": [-2.98, 104.76],
  "Bengkulu": [-3.8, 102.27], "Lampung": [-5.43, 105.26], "Kepulauan Bangka Belitung": [-2.13, 106.11],
  "Kepulauan Riau": [0.92, 104.45], "DKI Jakarta": [-6.2, 106.85], "Jawa Barat": [-6.91, 107.61],
  "Jawa Tengah": [-6.99, 110.42], "Jawa Timur": [-7.25, 112.75], "DI Yogyakarta": [-7.8, 110.37],
  "Banten": [-6.12, 106.15], "Bali": [-8.65, 115.22], "Nusa Tenggara Barat": [-8.58, 116.12],
  "Nusa Tenggara Timur": [-10.18, 123.6], "Kalimantan Barat": [-0.03, 109.33], "Kalimantan Tengah": [-2.21, 113.92],
  "Kalimantan Selatan": [-3.44, 114.83], "Kalimantan Timur": [-0.5, 117.15], "Kalimantan Utara": [2.84, 117.37],
  "Sulawesi Utara": [1.47, 124.84], "Sulawesi Tengah": [-0.9, 119.87], "Sulawesi Selatan": [-5.15, 119.43],
  "Sulawesi Tenggara": [-3.97, 122.51], "Sulawesi Barat": [-2.68, 118.89], "Gorontalo": [0.54, 123.06],
  "Maluku": [-3.7, 128.18], "Maluku Utara": [0.79, 127.38], "Papua": [-2.53, 140.72],
  "Papua Barat": [-0.86, 134.06], "Papua Barat Daya": [-0.88, 131.25], "Papua Selatan": [-8.49, 140.4],
  "Papua Tengah": [-3.36, 135.5], "Papua Pegunungan": [-4.09, 138.95],
};

// Nama di GeoJSON yang berbeda dengan nama di spreadsheet.
const ALIAS_GEO = { "Daerah Istimewa Yogyakarta": "DI Yogyakarta" };

// ---------- util ----------
const fmt = (n) => (n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString("id-ID"));
const fmtSigned = (n) => (n > 0 ? "+" : "") + fmt(n);
const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/,/g, "").replace(/%$/, "").trim();
  if (t === "" || t === "-") return null;
  const v = Number(t);
  return isNaN(v) ? null : v;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function haversineKm([a1, o1], [a2, o2]) {
  const r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// ---------- pemuatan data ----------
async function fetchSheet(name) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

// Ubah satu sheet komoditas menjadi { periode: { provinsi: {kebutuhan, produksi, neraca} } }.
function parseKomoditas(csv) {
  const rows = parseCSV(csv);
  const header = rows[0].map((h) => h.trim());
  const periodeCols = {};
  header.forEach((h, i) => {
    if (!/Kebutuhan/i.test(h)) return;
    const label = h.replace(/Kebutuhan/i, "").trim();
    const bulan = BULAN.find((b) => label.toLowerCase().startsWith(b.toLowerCase()));
    const key = bulan || (/tahun/i.test(label) ? "Tahunan" : label);
    periodeCols[key] = i;
  });
  const data = {};
  for (const [periode, c] of Object.entries(periodeCols)) {
    data[periode] = {};
    for (const r of rows.slice(1)) {
      const prov = (r[1] || "").trim();
      if (!prov) continue;
      const kebutuhan = num(r[c]), produksi = num(r[c + 1]);
      let neraca = num(r[c + 2]);
      if (kebutuhan == null && produksi == null) continue;
      if (neraca == null) neraca = (produksi || 0) - (kebutuhan || 0);
      data[periode][prov] = { kebutuhan, produksi, neraca, penduduk: num(r[2]) };
    }
    // Baris "Indonesia" kadang kosong/tidak lengkap — hitung dari jumlah provinsi.
    const nas = data[periode]["Indonesia"];
    if (!nas || nas.kebutuhan == null || nas.produksi == null) {
      const prov = Object.entries(data[periode]).filter(([p]) => !REGIONAL.has(p)).map(([, d]) => d);
      const kebutuhan = prov.reduce((a, d) => a + (d.kebutuhan || 0), 0);
      const produksi = prov.reduce((a, d) => a + (d.produksi || 0), 0);
      data[periode]["Indonesia"] = { kebutuhan, produksi, neraca: produksi - kebutuhan, penduduk: null };
    }
  }
  return data;
}

// Sheet opsional (Harga / Pelaku Usaha): kembalikan array objek, atau null bila sheet tidak ada.
// gviz mengembalikan sheet pertama jika nama tidak ditemukan, jadi kita validasi kolom wajibnya.
function parseTabel(csv, kolomWajib) {
  const rows = parseCSV(csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (!rows.length) return null;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (!kolomWajib.every((k) => header.includes(k))) return null;
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || "").trim()])));
}

async function loadAll() {
  const state = { komoditas: {}, harga: null, pelaku: null, sumber: "" };
  try {
    const texts = await Promise.all(KOMODITAS.map(fetchSheet));
    KOMODITAS.forEach((k, i) => (state.komoditas[k] = parseKomoditas(texts[i])));
    state.sumber = "Data langsung dari Google Sheets";
    const [h, p] = await Promise.allSettled([fetchSheet(SHEET_HARGA), fetchSheet(SHEET_PELAKU)]);
    if (h.status === "fulfilled") state.harga = parseTabel(h.value, ["provinsi", "komoditas", "harga"]);
    if (p.status === "fulfilled") state.pelaku = parseTabel(p.value, ["provinsi", "komoditas", "nama"]);
  } catch (e) {
    console.warn("Gagal memuat Google Sheets, memakai snapshot:", e);
    const snap = window.SNAPSHOT;
    if (!snap) throw new Error("Tidak ada data: Google Sheets gagal dan snapshot tidak tersedia.");
    KOMODITAS.forEach((k) => (state.komoditas[k] = parseKomoditas(snap.sheets[k])));
    state.sumber = `Snapshot lokal (${snap.generated})`;
  }
  return state;
}

// ---------- logika rekomendasi ----------
// Greedy: provinsi defisit terbesar dipasok lebih dulu dari provinsi surplus terdekat.
function rekomendasi(provData) {
  const surplus = [], defisit = [];
  for (const [prov, d] of Object.entries(provData)) {
    if (REGIONAL.has(prov) || !KOORDINAT[prov]) continue;
    if (d.neraca > 0) surplus.push({ prov, sisa: d.neraca });
    else if (d.neraca < 0) defisit.push({ prov, kurang: -d.neraca });
  }
  defisit.sort((a, b) => b.kurang - a.kurang);
  const hasil = [];
  for (const d of defisit) {
    const kandidat = surplus
      .filter((s) => s.sisa > 0)
      .map((s) => ({ s, jarak: haversineKm(KOORDINAT[d.prov], KOORDINAT[s.prov]) }))
      .sort((a, b) => a.jarak - b.jarak);
    for (const { s, jarak } of kandidat) {
      if (d.kurang <= 0) break;
      const vol = Math.min(s.sisa, d.kurang);
      s.sisa -= vol; d.kurang -= vol;
      hasil.push({ dari: s.prov, ke: d.prov, volume: vol, jarak });
    }
    if (d.kurang > 0) hasil.push({ dari: null, ke: d.prov, volume: d.kurang, jarak: null });
  }
  return hasil;
}

// ---------- UI ----------
const S = { data: null, komoditas: KOMODITAS[0], periode: "Tahunan", rank: "volume", sort: { key: "neraca", dir: 1 } };
let map, layerProvinsi, layerFlows;
const polyByProv = {};

function initMap() {
  map = L.map("map", { zoomSnap: 0.25, scrollWheelZoom: false }).fitBounds([[6.5, 94.5], [-11.5, 141.5]]);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Batas provinsi: <a href="https://github.com/denyherianto/indonesia-geojson-topojson-maps-with-38-provinces">Deny Herianto</a> (CC BY 4.0)',
    maxZoom: 10,
  }).addTo(map);
  layerProvinsi = L.geoJSON(window.PROVINSI_GEOJSON, {
    onEachFeature: (f, layer) => {
      const p = ALIAS_GEO[f.properties.PROVINSI] || f.properties.PROVINSI;
      f.properties.nama = p;
      polyByProv[p] = layer;
      layer.on({
        mouseover: () => layer.setStyle({ weight: 2.5 }),
        mouseout: () => layer.setStyle({ weight: 1 }),
        click: (e) => layer.openTooltip(e.latlng), // untuk layar sentuh (tanpa hover)
      });
    },
  }).addTo(map);
  layerFlows = L.layerGroup().addTo(map);
}

function currentProv() {
  return S.data.komoditas[S.komoditas][S.periode] || {};
}

function populateSelects() {
  const sk = document.getElementById("sel-komoditas");
  sk.innerHTML = KOMODITAS.map((k) => `<option>${esc(k)}</option>`).join("");
  sk.value = S.komoditas;
  sk.onchange = () => { S.komoditas = sk.value; populatePeriode(); render(); };
  populatePeriode();
}

function populatePeriode() {
  const sp = document.getElementById("sel-periode");
  const tersedia = Object.keys(S.data.komoditas[S.komoditas]);
  const urut = ["Tahunan", ...BULAN].filter((p) => tersedia.includes(p));
  if (!urut.includes(S.periode)) S.periode = urut[0];
  sp.innerHTML = urut.map((p) => `<option>${esc(p)}</option>`).join("");
  sp.value = S.periode;
  sp.onchange = () => { S.periode = sp.value; render(); };
}

function renderKPI(prov) {
  const nas = prov["Indonesia"];
  const list = Object.entries(prov).filter(([p]) => !REGIONAL.has(p));
  const nS = list.filter(([, d]) => d.neraca > 0).length;
  const nD = list.filter(([, d]) => d.neraca < 0).length;
  const cls = nas && nas.neraca >= 0 ? "pos" : "neg";
  document.getElementById("kpis").innerHTML = `
    <div class="kpi"><div class="label">Kebutuhan nasional</div><div class="value">${fmt(nas?.kebutuhan)}</div><div class="hint">${SATUAN}</div></div>
    <div class="kpi"><div class="label">Produksi nasional</div><div class="value">${fmt(nas?.produksi)}</div><div class="hint">${SATUAN}</div></div>
    <div class="kpi"><div class="label">Neraca nasional</div><div class="value ${cls}">${nas ? fmtSigned(nas.neraca) : "–"}</div><div class="hint">${nas && nas.neraca >= 0 ? "surplus" : "defisit"}</div></div>
    <div class="kpi"><div class="label">Provinsi surplus / defisit</div><div class="value"><span class="pos" style="color:var(--surplus)">${nS}</span> / <span style="color:var(--defisit)">${nD}</span></div><div class="hint">dari ${list.length} provinsi</div></div>`;
}

function renderMap(prov, rek) {
  layerFlows.clearLayers();
  const css = getComputedStyle(document.documentElement);
  const cS = css.getPropertyValue("--surplus").trim(), cD = css.getPropertyValue("--defisit").trim(), cF = css.getPropertyValue("--flow").trim();
  const cN = css.getPropertyValue("--nodata").trim();

  // Satu warna penuh per provinsi: hijau = surplus, merah = defisit, abu-abu = tidak ada data.
  layerProvinsi.eachLayer((layer) => {
    const p = layer.feature.properties.nama;
    const d = prov[p];
    const warna = !d ? cN : d.neraca >= 0 ? cS : cD;
    layer.setStyle({ fillColor: warna, fillOpacity: 0.8, color: "#ffffff", weight: 1, opacity: 0.9 });
    // Info muncul saat kursor diarahkan (hover), tanpa perlu klik.
    const opsi = { sticky: true, direction: "top", offset: [0, -8] };
    if (!d) { layer.bindTooltip(`<b>${esc(p)}</b><br>Tidak ada data.`, opsi); return; }
    const pct = d.kebutuhan ? (d.neraca / d.kebutuhan) * 100 : null;
    layer.bindTooltip(`<b>${esc(p)}</b> — ${d.neraca >= 0 ? "Surplus" : "Defisit"}<br>
      Kebutuhan: ${fmt(d.kebutuhan)} ${SATUAN}<br>
      Produksi: ${fmt(d.produksi)} ${SATUAN}<br>
      Neraca: <b style="color:${d.neraca >= 0 ? cS : cD}">${fmtSigned(d.neraca)} ${SATUAN}</b>${pct != null ? ` (${pct.toFixed(0)}%)` : ""}`, opsi);
  });

  if (document.getElementById("chk-flows").checked) {
    const maxVol = Math.max(1, ...rek.filter((r) => r.dari).map((r) => r.volume));
    for (const r of rek) {
      if (!r.dari) continue;
      L.polyline([KOORDINAT[r.dari], KOORDINAT[r.ke]], {
        color: cF, weight: 1.5 + 4 * (r.volume / maxVol), opacity: 0.75, dashArray: "6 5",
      }).bindTooltip(`${esc(r.dari)} → ${esc(r.ke)}: ${fmt(r.volume)} ${SATUAN}`).addTo(layerFlows);
    }
  }
}

function renderRekomendasi(rek) {
  const el = document.getElementById("panel-rekomendasi");
  if (!rek.length) { el.innerHTML = `<p class="empty">Tidak ada provinsi defisit pada periode ini.</p>`; return; }
  const ok = rek.filter((r) => r.dari), sisa = rek.filter((r) => !r.dari);
  el.innerHTML = `
    <p class="note">Provinsi defisit terbesar diprioritaskan, lalu dipasok dari provinsi surplus terdekat sampai kebutuhannya tertutup.</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Dari (surplus)</th><th>Ke (defisit)</th><th class="num">Volume (${SATUAN})</th><th class="num">Jarak ±km</th></tr></thead>
      <tbody>${ok.map((r) => `<tr><td><span class="pill surplus">${esc(r.dari)}</span></td><td><span class="pill defisit">${esc(r.ke)}</span></td><td class="num">${fmt(r.volume)}</td><td class="num">${fmt(r.jarak)}</td></tr>`).join("")}</tbody>
    </table></div>
    ${sisa.length ? `<p class="note" style="margin-top:12px">Belum tertutup oleh surplus provinsi lain (perlu stok/impor/cadangan): ${sisa.map((r) => `<b>${esc(r.ke)}</b> ${fmt(r.volume)} ${SATUAN}`).join(", ")}.</p>` : ""}`;
}

function renderProvinsi(prov) {
  const el = document.getElementById("panel-provinsi");
  const rows = Object.entries(prov).filter(([p]) => !REGIONAL.has(p)).map(([p, d]) => ({
    provinsi: p, kebutuhan: d.kebutuhan, produksi: d.produksi, neraca: d.neraca,
    rasio: d.kebutuhan ? (d.neraca / d.kebutuhan) * 100 : null,
  }));
  const { key, dir } = S.sort;
  rows.sort((a, b) => (typeof a[key] === "string" ? a[key].localeCompare(b[key]) : (a[key] ?? -Infinity) - (b[key] ?? -Infinity)) * dir);
  const cols = [["provinsi", "Provinsi", ""], ["kebutuhan", `Kebutuhan (${SATUAN})`, "num"], ["produksi", `Produksi (${SATUAN})`, "num"], ["neraca", `Neraca (${SATUAN})`, "num"], ["rasio", "Neraca / Kebutuhan", "num"]];
  el.innerHTML = `<div class="table-scroll"><table>
    <thead><tr>${cols.map(([k, l, c]) => `<th class="${c}" data-k="${k}">${l}${k === key ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr class="clickable" data-p="${esc(r.provinsi)}"><td>${esc(r.provinsi)}</td><td class="num">${fmt(r.kebutuhan)}</td><td class="num">${fmt(r.produksi)}</td>
      <td class="num ${r.neraca >= 0 ? "pos" : "neg"}">${fmtSigned(r.neraca)}</td><td class="num ${r.neraca >= 0 ? "pos" : "neg"}">${r.rasio == null ? "–" : r.rasio.toFixed(0) + "%"}</td></tr>`).join("")}</tbody>
  </table></div>`;
  el.querySelectorAll("th").forEach((th) => (th.onclick = () => {
    const k = th.dataset.k;
    S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 };
    renderProvinsi(prov);
  }));
  el.querySelectorAll("tr.clickable").forEach((tr) => (tr.onclick = () => fokusProvinsi(tr.dataset.p)));
}

function fokusProvinsi(p) {
  const layer = polyByProv[p];
  if (!layer) return;
  map.fitBounds(layer.getBounds(), { maxZoom: 8, padding: [20, 20] });
  layer.openTooltip(layer.getBounds().getCenter());
  document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" });
}

// Top 10 surplus & defisit, diurutkan menurut volume atau persentase terhadap kebutuhan.
function renderTop10(prov) {
  const list = Object.entries(prov).filter(([p]) => !REGIONAL.has(p)).map(([p, d]) => ({
    p, neraca: d.neraca, persen: d.kebutuhan ? (d.neraca / d.kebutuhan) * 100 : null,
  }));
  const byPersen = S.rank === "persen";
  const key = (x) => (byPersen ? x.persen ?? 0 : x.neraca);
  const isi = (id, items, kelas) => {
    const el = document.getElementById(id);
    el.className = "rank " + kelas;
    if (!items.length) { el.innerHTML = `<li class="empty" style="cursor:default">Tidak ada provinsi.</li>`; return; }
    const max = Math.max(...items.map((x) => Math.abs(key(x))), 1);
    el.innerHTML = items.map((x, i) => {
      const utama = byPersen ? `${x.persen > 0 ? "+" : ""}${x.persen.toFixed(0)}%` : `${fmtSigned(x.neraca)}`;
      const sekunder = byPersen ? `${fmtSigned(x.neraca)} ${SATUAN}` : x.persen == null ? SATUAN : `${SATUAN} · ${x.persen > 0 ? "+" : ""}${x.persen.toFixed(0)}%`;
      return `<li data-p="${esc(x.p)}" title="Klik untuk melihat di peta">
        <span class="no">${i + 1}</span><span class="nm">${esc(x.p)}</span>
        <span class="val">${utama}<small>${sekunder}</small></span>
        <span class="bar"><i style="width:${(Math.abs(key(x)) / max) * 100}%"></i></span></li>`;
    }).join("");
    el.querySelectorAll("li[data-p]").forEach((li) => (li.onclick = () => fokusProvinsi(li.dataset.p)));
  };
  isi("top-defisit", list.filter((x) => x.neraca < 0).sort((a, b) => key(a) - key(b)).slice(0, 10), "defisit-list");
  isi("top-surplus", list.filter((x) => x.neraca > 0).sort((a, b) => key(b) - key(a)).slice(0, 10), "surplus-list");
}

function templateHint(sheet, cols, contoh) {
  return `<div class="empty">
    <p>Belum ada data. Tambahkan sheet bernama <code>${sheet}</code> di Google Sheets dengan baris pertama berisi kolom berikut — dashboard akan memuatnya otomatis:</p>
    <div class="table-scroll"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody><tr>${contoh.map((c) => `<td>${c}</td>`).join("")}</tr></tbody></table></div></div>`;
}

function renderHarga(prov) {
  const el = document.getElementById("panel-harga");
  const rows = (S.data.harga || []).filter((r) => r.komoditas.toLowerCase() === S.komoditas.toLowerCase());
  if (!rows.length) {
    el.innerHTML = templateHint(SHEET_HARGA, ["provinsi", "komoditas", "harga", "tanggal"], ["Jawa Timur", "Cabai Rawit", "45000", "2026-10-20"]);
    return;
  }
  const harga = rows.map((r) => ({ ...r, h: num(r.harga) })).filter((r) => r.h != null);
  const rata = harga.reduce((a, r) => a + r.h, 0) / harga.length;
  harga.sort((a, b) => b.h - a.h);
  el.innerHTML = `<p class="note">Rata-rata nasional: <b>Rp${fmt(rata)}</b>. Provinsi defisit dengan harga di atas rata-rata adalah peluang dagang bagi provinsi surplus.</p>
    <div class="table-scroll"><table><thead><tr><th>Provinsi</th><th class="num">Harga (Rp)</th><th class="num">vs rata-rata</th><th>Status neraca</th><th>Tanggal</th></tr></thead>
    <tbody>${harga.map((r) => {
      const d = prov[r.provinsi]; const sel = ((r.h - rata) / rata) * 100;
      const status = d ? (d.neraca >= 0 ? `<span class="pill surplus">Surplus</span>` : `<span class="pill defisit">Defisit</span>`) : "–";
      return `<tr><td>${esc(r.provinsi)}</td><td class="num">${fmt(r.h)}</td><td class="num ${sel > 0 ? "neg" : "pos"}">${sel > 0 ? "+" : ""}${sel.toFixed(0)}%</td><td>${status}</td><td>${esc(r.tanggal || "")}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function renderPelaku(rek) {
  const el = document.getElementById("panel-pelaku");
  const rows = (S.data.pelaku || []).filter((r) => r.komoditas.toLowerCase() === S.komoditas.toLowerCase());
  if (!rows.length) {
    el.innerHTML = templateHint(SHEET_PELAKU, ["provinsi", "komoditas", "nama", "jenis", "kontak"], ["Jawa Timur", "Cabai Rawit", "Gapoktan Makmur", "Kelompok tani", "0812-xxxx-xxxx"]);
    return;
  }
  const pemasok = new Set(rek.filter((r) => r.dari).map((r) => r.dari));
  rows.sort((a, b) => (pemasok.has(b.provinsi) - pemasok.has(a.provinsi)) || a.provinsi.localeCompare(b.provinsi));
  el.innerHTML = `<p class="note">Pelaku usaha di provinsi yang direkomendasikan sebagai pemasok ditampilkan paling atas.</p>
    <div class="table-scroll"><table><thead><tr><th>Provinsi</th><th>Nama</th><th>Jenis</th><th>Kontak</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.provinsi)}${pemasok.has(r.provinsi) ? ` <span class="pill surplus">pemasok</span>` : ""}</td><td>${esc(r.nama)}</td><td>${esc(r.jenis || "")}</td><td>${esc(r.kontak || "")}</td></tr>`).join("")}</tbody></table></div>`;
}

function render() {
  const prov = currentProv();
  const rek = rekomendasi(prov);
  renderKPI(prov);
  renderMap(prov, rek);
  renderTop10(prov);
  renderRekomendasi(rek);
  renderProvinsi(prov);
  renderHarga(prov);
  renderPelaku(rek);
}

function initTabs() {
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== "panel-" + b.dataset.tab));
  }));
}

(async function main() {
  initMap();
  initTabs();
  document.getElementById("chk-flows").onchange = render;
  document.querySelectorAll("#seg-rank button").forEach((b) => (b.onclick = () => {
    S.rank = b.dataset.rank;
    document.querySelectorAll("#seg-rank button").forEach((x) => x.classList.toggle("active", x === b));
    if (S.data) renderTop10(currentProv());
  }));
  try {
    S.data = await loadAll();
    document.getElementById("source-badge").textContent = S.data.sumber;
    populateSelects();
    render();
  } catch (e) {
    document.getElementById("source-badge").textContent = "Gagal memuat data: " + e.message;
  }
})();
