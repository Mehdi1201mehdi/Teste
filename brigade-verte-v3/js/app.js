// Point d'entrée : charge les données, restaure la tournée, relie les vues.
// Chaque module garde son domaine : composer (saisie), report (rapport),
// map (territoire), router (navigation), storage (persistance).

import { $, esc, todayISO, stampDate, plural } from "./utils.js";
import { state, load, save } from "./storage.js";
import { toast, confirmDialog, closeOnBackdrop, initOfflineBanner, initToast, replay } from "./ui.js";
import { go, initRouter, onRoute } from "./router.js";
import { loadStreets, streetEntry } from "./streets.js";
import { loadWaste } from "./waste.js";
import { adresseText } from "./bp.js";
import { loadSectorContours } from "./sectors.js";
import { initComposer, renderAllComposer, renderComposer, chooseRue, editBp, resetCurrent } from "./composer.js";
import { initReport, renderReport, sectorCounts, sectorBarHtml, revealBp } from "./report.js";
import { showSuggestions } from "./components.js";
import { fmtDist } from "./geo.js";
import * as map from "./map.js";

/* ─── Rendu transversal : compteurs, carte, rapport ─── */
function renderTour({ fresh = -1 } = {}) {
  const n = state.bps.length;
  const nav = $("navCount");
  nav.textContent = n;
  nav.toggleAttribute("data-zero", n === 0);
  nav.closest(".vsBtn").setAttribute("aria-label", `Rapport de tournée — ${plural(n, "dépôt")}`);
  $("hudCount").textContent = n;
  $("hudCountLabel").textContent = n > 1 ? "dépôts relevés" : "dépôt relevé";
  $("hudSectors").innerHTML = sectorBarHtml(sectorCounts());
  $("tourDate").textContent = stampDate(state.date);
  $("tourDate").setAttribute("datetime", state.date || "");
  map.setPins(
    state.bps.map((bp, i) => ({ rue: bp.rue, label: `n°${i + 1} · ${adresseText(bp)}` })),
    { fresh, editing: state.editing },
  );
  renderReport();
}

function changed(opts = {}) {
  renderTour(opts);
  renderAllComposer();
}

/* ─── Réglages de tournée ─── */
function bindSettings() {
  const dlg = $("settingsDlg");
  closeOnBackdrop(dlg);
  $("openSettings").onclick = () => {
    $("date").value = state.date;
    $("saveStatus").textContent = state.lastSaved ? `Enregistré sur l'appareil à ${state.lastSaved}` : "Enregistré sur l'appareil";
    dlg.showModal();
  };
  $("date").addEventListener("change", (e) => {
    state.date = e.target.value || todayISO();
    renderTour();
    save();
  });
  const gps = $("gpsToggle");
  const applyGps = () => {
    gps.setAttribute("aria-checked", String(state.gps));
    $("locateBtn").hidden = !state.gps;
    $("mapLocate").hidden = !state.gps;
  };
  gps.onclick = () => {
    state.gps = !state.gps;
    applyGps();
    save();
    toast(state.gps ? "Localisation GPS activée." : "Localisation GPS désactivée.");
  };
  applyGps();

  $("resetCurrent").onclick = async () => {
    dlg.close();
    const ok = await confirmDialog({
      title: "Effacer la saisie en cours ?",
      text: "Rue, précisions et déchets non enregistrés seront effacés. Les bons déjà enregistrés sont conservés.",
      ok: "Effacer la saisie",
    });
    if (!ok) return;
    resetCurrent();
    renderTour();
    go("terrain", 1);
  };

  // Export de secours : tous les bons dans un fichier JSON.
  $("exportBps").onclick = () => {
    if (!state.bps.length) return toast("Aucun signalement à sauvegarder.");
    const data = JSON.stringify({ app: "brigade-verte-amiens", version: 3, date: state.date, bps: state.bps }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `brigade-verte-bp-${state.date || todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${plural(state.bps.length, "signalement")} exporté${state.bps.length > 1 ? "s" : ""}.`, null, "ok");
  };

  // Import : validé et normalisé strictement.
  $("importBps").onclick = () => $("importFile").click();
  $("importFile").onchange = async () => {
    const file = $("importFile").files[0];
    $("importFile").value = "";
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const raw = Array.isArray(json) ? json : json && json.bps;
      if (!Array.isArray(raw)) return toast("Fichier non reconnu : choisissez un export .json de Brigade Verte.", null, "error");
      const clean = raw
        .filter((b) => b && typeof b === "object" && b.rue && b.secteur)
        .map((b) => ({
          rue: String(b.rue),
          numero: b.numero != null ? String(b.numero) : "",
          secteur: String(b.secteur),
          wastes: Array.isArray(b.wastes) ? b.wastes.map(String) : [],
          precisions: Array.isArray(b.precisions) ? b.precisions.map(String) : [],
        }));
      if (!clean.length) return toast("Aucun signalement valide dans ce fichier — rien n'a été remplacé.", null, "error");
      if (state.bps.length) {
        dlg.close();
        const ok = await confirmDialog({
          title: "Remplacer la tournée ?",
          text: `Les ${state.bps.length} signalements actuels seront remplacés par les ${clean.length} du fichier.`,
          ok: "Remplacer",
        });
        if (!ok) return;
      }
      state.bps = clean;
      state.mailCustom = "";
      state.editing = null;
      changed();
      save();
      dlg.open && dlg.close();
      toast(`${plural(clean.length, "signalement")} rechargé${clean.length > 1 ? "s" : ""}.`, null, "ok");
    } catch (e) {
      toast("Fichier illisible — vos signalements actuels sont intacts.", null, "error");
    }
  };

  document.addEventListener("bv:quota", () =>
    toast("Stockage plein : exportez vos signalements (Réglages) pour ne rien perdre.", null, "error"),
  );
}

/* ─── Carte : toucher → rues proches ─── */
function onMapPick({ list, quartier }) {
  const box = $("mapPick");
  $("mapPickTitle").innerHTML = quartier
    ? `Quartier <b>${esc(quartier)}</b> · rues proches`
    : "Rues les plus proches";
  const listEl = $("mapPickList");
  if (!list.length) return;
  const narrow = window.matchMedia("(max-width: 1023px)").matches;
  const entries = list.slice(0, narrow ? 3 : 5).map(({ r, d }) =>
    streetEntry(r, "", (rue) => {
      box.hidden = true;
      if (state.view !== "terrain" || state.stage !== 1) go("terrain", 1);
      chooseRue(rue, { fly: true });
    }, fmtDist(d)),
  );
  showSuggestions(listEl, entries, "");
  listEl.classList.remove("suggest");
  box.hidden = false;
  listEl.querySelector(".sug")?.focus({ preventScroll: true });
}

function bindShell() {
  document.querySelectorAll("[data-view-target]").forEach((b) => {
    b.addEventListener("click", () => {
      const view = b.dataset.viewTarget;
      if (view === "terrain" && b.dataset.new && state.editing == null) go("terrain", 1);
      else go(view, view === "terrain" ? state.stage : state.stage);
    });
  });
  $("mapFit").onclick = () => map.fit();
  document.querySelector(".brand").addEventListener("click", (e) => {
    e.preventDefault();
    go("terrain", state.stage);
  });
  $("mapPickClose").onclick = () => {
    $("mapPick").hidden = true;
    map.clearProbe();
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("mapPick").hidden) {
      $("mapPick").hidden = true;
      map.clearProbe();
    }
  });
  onRoute((view) => {
    renderTour();
    // Rapport : la carte cadre toute la tournée. Terrain : elle revient sur la rue choisie.
    if (view === "rapport") map.fitPins();
    else if (state.current.rue) map.setTarget(state.current.rue.rue);
  });
}

/* ─── Service worker : mise à jour sans jamais couper une saisie ─── */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  const doReload = () => {
    reloaded = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    $("updateBanner").hidden = false;
  });
  $("updateReload").onclick = doReload;
  const register = () => navigator.serviceWorker.register("service-worker.js").catch(() => {});
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
}

async function main() {
  registerServiceWorker();
  navigator.storage?.persist?.().catch(() => {});
  load();
  // La date se règle sur le jour courant à chaque ouverture (heure locale).
  state.date = todayISO();

  const [streets] = await Promise.all([loadStreets(), loadWaste()]);
  map.initMap($("map"), streets, {
    onPick: onMapPick,
    onPinClick: (i) => {
      go("rapport");
      requestAnimationFrame(() => {
        const t = document.querySelector(`#bpList [data-i="${i}"]`)?.closest(".ticket");
        t?.scrollIntoView({ block: "center", behavior: "smooth" });
        replay(t, "is-editing");
        setTimeout(() => t?.classList.remove("is-editing"), 1400);
      });
    },
  });

  // Quartiers officiels : chargés après la carte, puis tout est recalculé
  // (quartier de la rue choisie, répartition par quartier du rapport).
  map.loadAreas().then(() => {
    changed();
    if (state.current.rue) map.setTarget(state.current.rue.rue, { fly: false });
    else if (state.bps.length) map.fitPins();
  });

  initComposer({ changed, reveal: revealBp });
  initReport({ changed, edit: editBp });
  bindSettings();
  bindShell();
  initOfflineBanner();
  initToast();

  // Restaure la saisie en cours
  const c = state.current;
  $("streetInput").value = c.rue?.rue || "";
  $("numeroRue").value = c.numero || "";
  $("precCustom").value = c.precisionCustom || "";
  if (c.rue) map.setTarget(c.rue.rue, { fly: false });

  initRouter();
  changed();
  if (!c.rue && state.bps.length) map.fitPins();
  renderComposer();
  save();
  loadSectorContours();
}

main();
