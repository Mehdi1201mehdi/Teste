// Application de suivi de tournée — Brigade Verte Amiens.
// Navigation : Secteur → Rue → Numéros. Objectif : rapidité terrain.
// Point d'entrée : charge les données, restaure l'état, rend les vues.

import {
  state, load, save, saveSoon, touch, touchStreet, resetAll,
  streetState, numCounts, streetHasPb, streetIsDone, streetTouched,
} from "./state.js";
import {
  SECTEURS, SECTOR_META, OBJETS, loadStreets, streetsOfSector,
  sectorCounts, searchStreets, fetchHouseNumbers, norm, numKey,
} from "./data.js";
import { renderReport, reportText, exportCSV, exportXLS, printReport } from "./report.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const esc = (s) => String(s == null ? "" : s)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let currentSector = null;
let currentStreet = null;

// ── Navigation (vues + bouton retour natif) ──────────────────────────
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  window.scrollTo({ top: 0 });
}
function nav(view, data = {}, push = true) {
  if (push) history.pushState({ view, ...data }, "", "#" + view + (data.sector ? "/" + data.sector : ""));
  applyRoute(view, data);
}
function applyRoute(view, data) {
  if (view === "sectors") { renderSectors(); showView("sectors"); }
  else if (view === "streets") { currentSector = data.sector; renderStreetList(); showView("streets"); }
  else if (view === "street") { currentStreet = data.street; currentSector = data.sector || currentSector; renderStreet(); showView("street"); }
  else if (view === "report") { renderReport($("reportDoc")); showView("report"); }
  const fab = $("goReport");
  if (fab) fab.hidden = view === "report";
  updateHeader();
}

// ── En-tête : statistiques vivantes ──────────────────────────────────
function globalStats() {
  let rues = 0, nums = 0, pb = 0;
  for (const d of Object.values(state.streets)) {
    if (!streetTouched(d)) continue;
    const c = numCounts(d);
    rues++; nums += c.seen; pb += c.pb;
  }
  return { rues, nums, pb };
}
function updateHeader() {
  const s = globalStats();
  $("hRues").textContent = s.rues;
  $("hNums").textContent = s.nums;
  $("hPb").textContent = s.pb;
  $("saveDot").textContent = navigator.onLine ? "💾 Enregistré" : "📴 Hors ligne — enregistré";
}

// ── Vue Secteurs ─────────────────────────────────────────────────────
function sectorProgress(sec) {
  const streets = streetsOfSector(sec);
  let done = 0, pb = 0;
  for (const r of streets) {
    const d = state.streets[r.rue];
    if (!d) continue;
    if (streetIsDone(d)) done++;
    if (streetHasPb(d)) pb++;
  }
  return { total: streets.length, done, pb };
}
function renderSectors() {
  const wrap = $("sectorGrid");
  wrap.textContent = "";
  const counts = sectorCounts();
  for (const sec of SECTEURS) {
    const meta = SECTOR_META[sec];
    const p = sectorProgress(sec);
    const card = el("button", "sector-card");
    card.style.setProperty("--sc", meta.color);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    card.innerHTML =
      `<span class="sc-emoji">${meta.emoji}</span>
       <span class="sc-body">
         <span class="sc-name">Secteur ${esc(meta.label)}</span>
         <span class="sc-meta">${counts[sec]} rues${p.pb ? ` · <b class="sc-pb">${p.pb} ⚠</b>` : ""}</span>
         <span class="sc-bar"><i style="width:${pct}%"></i></span>
       </span>
       <span class="sc-go" aria-hidden="true">›</span>`;
    card.addEventListener("click", () => nav("streets", { sector: sec }));
    wrap.appendChild(card);
  }
}

// ── Vue Liste des rues d'un secteur ──────────────────────────────────
function streetPill(d) {
  if (!d || !streetTouched(d)) return { cls: "todo", txt: "À faire" };
  if (streetIsDone(d)) return { cls: "done", txt: "RAS" };
  const c = numCounts(d);
  if (streetHasPb(d)) return { cls: "pb", txt: c.pb + " ⚠" };
  return { cls: "wip", txt: c.total ? `${c.seen}/${c.total}` : "En cours" };
}
function renderStreetList(filter = "") {
  const meta = SECTOR_META[currentSector];
  $("streetsTitle").textContent = "Secteur " + meta.label;
  $("streetsTitle").style.setProperty("--sc", meta.color);
  const listEl = $("streetList");
  listEl.textContent = "";
  let streets = streetsOfSector(currentSector);
  const q = norm(filter);
  if (q) streets = streets.filter((r) => norm(r.rue).includes(q));
  $("streetCount").textContent = streets.length + " rues";
  if (!streets.length) {
    listEl.appendChild(el("p", "empty", "Aucune rue ne correspond."));
    return;
  }
  for (const r of streets) {
    const d = state.streets[r.rue];
    const p = streetPill(d);
    const row = el("button", "st-row");
    row.innerHTML =
      `<span class="st-name">${esc(r.rue)}</span>
       <span class="pill ${p.cls}">${esc(p.txt)}</span>
       <span class="st-go" aria-hidden="true">›</span>`;
    row.addEventListener("click", () => nav("street", { street: r.rue, sector: currentSector }));
    listEl.appendChild(row);
  }
}

// ── Vue Détail d'une rue ─────────────────────────────────────────────
function renderStreet() {
  const name = currentStreet;
  const d = streetState(name);
  $("streetName").textContent = name;
  const meta = SECTOR_META[currentSector] || SECTOR_META.CENTRE;
  $("streetSector").textContent = "Secteur " + meta.label;
  $("streetSector").style.setProperty("--sc", meta.color);

  // Observation générale de la rue
  const note = $("streetNote");
  note.value = d.note || "";
  note.oninput = () => { d.note = note.value; touchStreet(d); saveSoon(); };

  // Filtre numéros
  const filter = $("numFilter");
  filter.value = "";
  filter.oninput = () => renderNums(d, filter.value);

  // Bouton "Toute la rue RAS"
  $("bulkRas").onclick = () => {
    if (streetIsDone(d)) {
      d.nums.forEach((x) => { if (x.k === "ok") x.k = ""; });
    } else {
      d.nums.forEach((x) => { if (x.k !== "pb") x.k = "ok"; });
      touchStreet(d);
    }
    save(); renderNums(d, filter.value); updateStreetHeader(d); updateHeader();
  };

  updateStreetHeader(d);
  ensureNumbers(d).then(() => renderNums(d, filter.value));
}

function updateStreetHeader(d) {
  const c = numCounts(d);
  $("streetProg").textContent = c.total
    ? `${c.seen}/${c.total} numéros${c.pb ? ` · ${c.pb} anomalie${c.pb > 1 ? "s" : ""}` : ""}`
    : "Chargement…";
  $("bulkRas").classList.toggle("on", streetIsDone(d));
}

async function ensureNumbers(d) {
  if (d.fetched && d.nums.length) return;
  if (d.fetched) return; // déjà tenté, pas de numéros (mode manuel)
  $("numLoad").hidden = false;
  const got = await fetchHouseNumbers(currentStreet);
  $("numLoad").hidden = true;
  d.fetched = true;
  if (got && got.length) {
    const have = new Set(d.nums.map((x) => norm(x.n)));
    got.forEach((n) => { if (!have.has(norm(n))) d.nums.push({ n, k: "", objs: [], note: "" }); });
    save();
  }
}

function renderNums(d, filter = "") {
  const box = $("numList");
  box.textContent = "";
  d.nums.sort((a, b) => numKey(a.n) - numKey(b.n) || a.n.localeCompare(b.n, "fr"));
  const q = norm(filter);
  const shown = q ? d.nums.filter((x) => norm(x.n).includes(q)) : d.nums;

  if (!d.nums.length) {
    const warn = el("div", "num-empty");
    warn.innerHTML = navigator.onLine
      ? "Aucun numéro trouvé pour cette rue.<br>Ajoutez-les ci-dessous."
      : "Numéros indisponibles hors ligne.<br>Ils se chargeront au retour du réseau, ou ajoutez-les manuellement.";
    box.appendChild(warn);
  }
  shown.forEach((rec) => box.appendChild(numRow(d, rec)));
  box.appendChild(manualAdder(d));
}

function numRow(d, rec) {
  const wrap = el("div", "num");
  const face = el("button", "num-face");
  face.innerHTML = `<span class="num-n">${esc(rec.n)}</span><span class="num-tag"></span>`;
  const warn = el("button", "num-warn", "⚠");
  warn.setAttribute("aria-label", "Signaler une anomalie au n° " + rec.n);
  const top = el("div", "num-top");
  top.append(face, warn);

  const detail = el("div", "num-detail");
  const objs = el("div", "obj-grid");
  OBJETS.forEach((o) => {
    const b = el("button", "obj-btn", o);
    b.addEventListener("click", () => {
      const i = rec.objs.indexOf(o);
      if (i >= 0) rec.objs.splice(i, 1); else rec.objs.push(o);
      b.classList.toggle("on", i < 0);
      saveSoon();
    });
    objs.appendChild(b);
  });
  const noteInput = el("textarea", "num-note");
  noteInput.placeholder = "Précision : devant garage, côté pair, sorti depuis plusieurs jours…";
  noteInput.value = rec.note || "";
  noteInput.oninput = () => { rec.note = noteInput.value; saveSoon(); };
  detail.append(objs, noteInput);
  wrap.append(top, detail);

  function paintObjs() {
    objs.querySelectorAll(".obj-btn").forEach((b) => b.classList.toggle("on", rec.objs.includes(b.textContent)));
  }
  function paint() {
    wrap.classList.toggle("n-ok", rec.k === "ok");
    wrap.classList.toggle("n-pb", rec.k === "pb");
    face.querySelector(".num-tag").textContent = rec.k === "ok" ? "RAS ✓" : rec.k === "pb" ? "Anomalie" : "";
  }
  face.addEventListener("click", () => {
    rec.k = rec.k === "ok" ? "" : "ok";
    if (rec.k === "ok") touchStreet(d);
    save(); paint(); updateStreetHeader(d); updateHeader();
  });
  warn.addEventListener("click", () => {
    rec.k = rec.k === "pb" ? "" : "pb";
    if (rec.k === "pb") touchStreet(d);
    save(); paint(); updateStreetHeader(d); updateHeader();
    if (rec.k === "pb") setTimeout(() => noteInput.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
  });
  paintObjs(); paint();
  return wrap;
}

function manualAdder(d) {
  const row = el("div", "manual");
  const inp = el("input", "manual-inp");
  inp.placeholder = "Ajouter un n° (ex. 12 bis)";
  inp.autocomplete = "off";
  const btn = el("button", "manual-btn", "＋");
  const add = () => {
    const v = inp.value.trim();
    if (!v) return;
    if (!d.nums.some((x) => norm(x.n) === norm(v))) d.nums.push({ n: v, k: "", objs: [], note: "" });
    inp.value = "";
    save();
    renderNums(d, $("numFilter").value);
    updateStreetHeader(d);
  };
  btn.addEventListener("click", add);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  row.append(inp, btn);
  return row;
}

// ── Recherche globale (rues, tous secteurs) ──────────────────────────
function initGlobalSearch() {
  const input = $("globalSearch");
  const box = $("globalSuggest");
  input.addEventListener("input", () => {
    const list = searchStreets(input.value, 30);
    box.textContent = "";
    if (input.value.trim().length < 2) { box.hidden = true; return; }
    if (!list.length) { box.innerHTML = '<div class="sug-empty">Aucune rue trouvée.</div>'; box.hidden = false; return; }
    list.forEach((r) => {
      const meta = SECTOR_META[r.secteur] || SECTOR_META.CENTRE;
      const item = el("button", "sug-item");
      item.innerHTML = `<span>${esc(r.rue)}</span><span class="pill" style="background:${meta.color};color:#fff">${esc(meta.label)}</span>`;
      item.addEventListener("click", () => {
        input.value = ""; box.hidden = true;
        nav("street", { street: r.rue, sector: r.secteur });
      });
      box.appendChild(item);
    });
    box.hidden = false;
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) box.hidden = true;
  });
}

// ── Compte rendu : exports ───────────────────────────────────────────
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1900);
}
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); toast("Compte rendu copié ✅"); }
  catch (e) {
    const ta = el("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Compte rendu copié ✅"); } catch (_) { toast("Copie impossible"); }
    document.body.removeChild(ta);
  }
}
function initReportActions() {
  $("expCopy").onclick = () => copyText(reportText());
  $("expShare").onclick = () => {
    const txt = reportText();
    if (navigator.share) navigator.share({ title: "Compte rendu tournée", text: txt }).catch(() => {});
    else copyText(txt);
  };
  $("expWhatsapp").onclick = () => window.open("https://wa.me/?text=" + encodeURIComponent(reportText()), "_blank");
  $("expSms").onclick = () => { window.location.href = "sms:?&body=" + encodeURIComponent(reportText()); };
  $("expMail").onclick = () => {
    const subject = "Compte rendu tournée préventive — " + new Date().toLocaleDateString("fr-FR");
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(reportText())}`;
  };
  $("expCsv").onclick = exportCSV;
  $("expXls").onclick = exportXLS;
  $("expPrint").onclick = printReport;
}

// ── Initialisation ───────────────────────────────────────────────────
function bindChrome() {
  $("backStreets").onclick = () => history.back();
  $("backStreet").onclick = () => history.back();
  $("backReport").onclick = () => history.back();
  $("goReport").onclick = () => nav("report", {});

  const agent = $("agentInput");
  agent.value = state.agent || "";
  agent.oninput = () => { state.agent = agent.value; saveSoon(); };

  $("resetBtn").onclick = () => {
    if (!confirm("Effacer toute la tournée en cours ?")) return;
    if (!confirm("Confirmer : cette action est définitive.")) return;
    resetAll();
    nav("sectors", {}, true);
    toast("Tournée réinitialisée");
  };

  // Filtre A-Z de la liste des rues
  $("streetFilter").oninput = (e) => renderStreetList(e.target.value);

  // Retour réseau : recharge les numéros de la rue ouverte si besoin.
  window.addEventListener("online", () => {
    updateHeader();
    if (currentStreet && document.getElementById("view-street").classList.contains("active")) {
      const d = streetState(currentStreet);
      if (!d.nums.length) { d.fetched = false; ensureNumbers(d).then(() => renderNums(d, $("numFilter").value)); }
    }
  });
  window.addEventListener("offline", updateHeader);

  // Clavier mobile : recentre le champ actif au-dessus du clavier (Android/iOS).
  // Délégation : couvre aussi les champs créés dynamiquement (numéros, notes).
  document.addEventListener("focusin", (e) => {
    if (e.target.matches("input, textarea")) {
      setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    }
  });
}

function initRouter() {
  window.addEventListener("popstate", (e) => {
    const s = e.state;
    if (s && s.view) applyRoute(s.view, s);
    else applyRoute("sectors", {});
  });
  const start = { view: "sectors" };
  history.replaceState(start, "", "#sectors");
  applyRoute("sectors", {});
}

async function main() {
  load();
  await loadStreets();
  bindChrome();
  initGlobalSearch();
  initReportActions();
  initRouter();
  updateHeader();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("../service-worker.js").catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
}
main();
