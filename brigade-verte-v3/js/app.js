// Point d'entrée : charge les données, restaure la tournée, relie les vues.
// Chaque module garde son domaine : composer (saisie), report (rapport),
// map (territoire), router (navigation), storage (persistance).

// La séquence de démarrage s'initialise en premier : elle mesure le vrai chargement.
import { splash } from "./splash.js";
import { $, esc, todayISO, stampDate, plural, dateFr, scrollBehavior } from "./utils.js";
import { state, load, save, reload, STORAGE_KEY } from "./storage.js";
import { buildExport, parseBackup, readArchivedTours } from "./backup.js";
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
import { initStreetIndex, loadStreetGeometry } from "./locate.js";
import * as map from "./map.js";
import { initCollecte } from "./collecteView.js";

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
  // « jeu. 24.09 » : le jour de la semaine s'efface sur les petits écrans (3 onglets).
  const [day, ...rest] = stampDate(state.date).split(" ");
  $("tourDate").innerHTML = rest.length ? `<span class="stampDay">${esc(day)}</span> ${esc(rest.join(" "))}` : esc(day);
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
    const before = state.date;
    state.date = e.target.value || todayISO();
    // Texte retouché à la main : sa date suit (sinon objet et corps divergent).
    if (state.mailCustom && before && before !== state.date) {
      state.mailCustom = state.mailCustom.split(dateFr(before)).join(dateFr(state.date));
    }
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
    const c = state.current;
    const empty = !c.rue && !c.numero && !c.precisions.length && !(c.precisionCustom || "").trim() && !c.wastes.length && state.editing == null;
    if (empty) return toast("Aucune saisie en cours.");
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

  // Export de secours : la tournée en cours (+ l'historique des versions
  // précédentes resté sur l'appareil) dans un fichier JSON.
  $("exportBps").onclick = async () => {
    const tours = await readArchivedTours();
    if (!state.bps.length && !tours.length) return toast("Aucun bon de passage à sauvegarder.");
    const data = JSON.stringify(buildExport(state, tours), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `brigade-verte-bp-${state.date || todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const extra = tours.length ? ` (+ ${plural(tours.length, "tournée archivée", "tournées archivées")})` : "";
    toast(`${plural(state.bps.length, "bon de passage", "bons de passage")} exporté${state.bps.length > 1 ? "s" : ""}${extra}.`, null, "ok");
  };

  // Import : tous les formats d'export (v3, v4, v5), validé et normalisé strictement.
  $("importBps").onclick = () => $("importFile").click();
  $("importFile").onchange = async () => {
    const file = $("importFile").files[0];
    $("importFile").value = "";
    if (!file) return;
    let parsed;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("taille");
      parsed = parseBackup(JSON.parse(await file.text()));
    } catch (e) {
      return toast(
        e && e.message === "format"
          ? "Fichier non reconnu : choisissez un export .json de Brigade Verte."
          : "Fichier illisible — vos bons de passage actuels sont intacts.",
        null,
        "error",
      );
    }
    const { bps: clean, rejected } = parsed;
    if (!clean.length) return toast("Aucun bon de passage valide dans ce fichier — rien n'a été remplacé.", null, "error");
    if (state.bps.length) {
      dlg.close();
      const ok = await confirmDialog({
        title: "Remplacer la tournée ?",
        text: `Les ${plural(state.bps.length, "bon de passage", "bons de passage")} actuels seront remplacés par les ${clean.length} du fichier. Exportez d'abord la tournée actuelle si vous voulez la garder.`,
        ok: "Remplacer",
      });
      if (!ok) return;
    }
    // Une modification en cours visait un bon de l'ancienne tournée : abandonnée.
    if (state.editing != null) resetCurrent({ silent: true });
    state.bps = clean;
    state.mailCustom = "";
    state.editing = null;
    changed();
    save();
    dlg.open && dlg.close();
    const skip = rejected ? ` ${plural(rejected, "ligne ignorée", "lignes ignorées")} (rue, secteur ou déchet manquant).` : "";
    toast(`${plural(clean.length, "bon de passage", "bons de passage")} rechargé${clean.length > 1 ? "s" : ""}.${skip}`, null, rejected ? "warn" : "ok");
  };

  document.addEventListener("bv:quota", () =>
    toast("Stockage plein : exportez vos bons de passage (Réglages) pour ne rien perdre.", null, "error"),
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
      else go(view, state.stage);
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
    else if (view === "terrain") map.setTarget(state.current.rue ? state.current.rue.rue : null);
  });
}

/** Recopie la saisie en cours (état) dans les champs du formulaire. */
function restoreInputs() {
  const c = state.current;
  $("streetInput").value = c.rue?.rue || "";
  $("numeroRue").value = c.numero || "";
  $("precCustom").value = c.precisionCustom || "";
  if (c.rue) map.setTarget(c.rue.rue, { fly: false });
}

/**
 * Deux onglets ouverts : chacun réécrit toute la tournée, le dernier gagne.
 * Dès qu'un autre onglet enregistre, celui-ci relit la sauvegarde — aucun bon
 * saisi ailleurs n'est écrasé par une copie périmée.
 */
function syncTabs() {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY || e.newValue == null) return;
    reload();
    restoreInputs();
    changed();
    renderComposer();
    toast("Tournée mise à jour depuis un autre onglet.");
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
  // Premier lancement : l'agent est prévenu une fois que tout est gardé sur
  // l'appareil (avant cela, l'application a encore besoin du réseau).
  if (!hadController) {
    navigator.serviceWorker.ready
      .then(() => toast("Application prête hors connexion.", null, "ok"))
      .catch(() => {});
  }
  const register = () => navigator.serviceWorker.register("service-worker.js").catch(() => {});
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
}

async function main() {
  registerServiceWorker();
  navigator.storage?.persist?.().catch(() => {});
  load();
  // Date de tournée : le jour courant pour une NOUVELLE tournée. Une tournée
  // commencée (bons déjà relevés) garde sa date, même rouverte le lendemain —
  // sinon le rapport partirait avec une fausse date d'îlotage.
  if (!state.bps.length || !state.date) state.date = todayISO();

  const [streets] = await Promise.all([
    loadStreets().then((r) => {
      splash.step("streets");
      splash.setVoies(r.length);
      return r;
    }),
    loadWaste().then((r) => {
      splash.step("waste");
      return r;
    }),
  ]);
  initStreetIndex(streets);
  map.initMap($("map"), streets, {
    onPick: onMapPick,
    onPinClick: (i) => {
      go("rapport");
      requestAnimationFrame(() => {
        const t = document.querySelector(`#bpList [data-i="${i}"]`)?.closest(".ticket");
        t?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
        replay(t, "is-editing");
        setTimeout(() => t?.classList.remove("is-editing"), 1400);
      });
    },
  });

  splash.step("map");

  // Quartiers officiels : chargés après la carte, puis tout est recalculé
  // (quartier de la rue choisie, répartition par quartier du rapport).
  map.loadAreas().then(() => {
    splash.step("areas");
    changed();
    if (state.current.rue) map.setTarget(state.current.rue.rue, { fly: false });
    else if (state.bps.length) map.fitPins();
  });

  initComposer({ changed, reveal: revealBp });
  initReport({ changed, edit: editBp });
  initCollecte({
    // « Relever un dépôt ici » depuis la vue Collecte : l'adresse passe au Terrain.
    useAddress: (rue, num) => {
      go("terrain", 1);
      chooseRue(rue);
      if (num) {
        const input = $("numeroRue");
        input.value = num;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
  });
  bindSettings();
  bindShell();
  syncTabs();
  initOfflineBanner();
  initToast();

  // Restaure la saisie en cours
  const c = state.current;
  restoreInputs();

  initRouter();
  changed();
  if (!c.rue && state.bps.length) map.fitPins();
  renderComposer();
  save();
  loadSectorContours();
  // Interface prête : la séquence de démarrage peut s'effacer.
  splash.step("ui");
  // Tracé réel des rues (pour « Ma position ») : chargé hors du chemin critique,
  // une fois la séquence de démarrage terminée (aucune saccade pendant l'animation).
  // « Ma position » le charge de toute façon à la demande s'il n'est pas prêt.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  if ($("splash")) document.addEventListener("bv:splashdone", () => idle(() => loadStreetGeometry()), { once: true });
  else idle(() => loadStreetGeometry());
}

main().catch((e) => {
  // Démarrage incomplet : on ne laisse jamais l'agent devant l'écran d'accueil.
  console.error(e);
  splash.fail();
});
