// Point d'entrée : charge les données, restaure la tournée, relie les vues.
// Chaque module garde son domaine : composer (saisie), report (rapport),
// map (territoire), router (navigation), storage (persistance).

// La séquence de démarrage s'initialise en premier : elle mesure le vrai chargement.
import { splash } from "./splash.js";
import { $, esc, todayISO, stampDate, plural, dateFr } from "./utils.js";
import { state, load, save, reload, STORAGE_KEY, newBpId } from "./storage.js";
import { buildExport, parseBackup, readArchivedTours } from "./backup.js";
import { dateLongue } from "./phrase.js";
import { toast, confirmDialog, closeOnBackdrop, initOfflineBanner, initToast, placeToast } from "./ui.js";
import { go, initRouter, onRoute, MQ, matches } from "./router.js";
import { loadStreets, streetEntry } from "./streets.js";
import { loadWaste } from "./waste.js";
import { adresseText } from "./bp.js";
import { loadSectorContours } from "./sectors.js";
import { initComposer, renderAllComposer, renderComposer, chooseRue, editBp, resetCurrent } from "./composer.js";
import { initReport, renderReport, sectorCounts, sectorBarHtml, revealBp, showOutlookAndroidFailed } from "./report.js";
import { ANDROID_RETURN_PARAM } from "./email.js";
import { showSuggestions } from "./components.js";
import { fmtDist } from "./geo.js";
import { initStreetIndex, loadStreetGeometry } from "./locate.js";
import * as map from "./map.js";
import { initCollecte } from "./collecteView.js";
import { initDashboard, renderDashboard } from "./dashboard.js";

/* ─── Rendu transversal : compteurs, carte, rapport ─── */
function renderTour({ fresh = -1 } = {}) {
  const n = state.bps.length;
  // Compteurs de la navigation (barre du bas, barre latérale…) : par classe,
  // un même id ne pouvant figurer qu'une fois dans la page.
  document.querySelectorAll(".navCount").forEach((nav) => {
    nav.textContent = n;
    nav.toggleAttribute("data-zero", n === 0);
    // Nom accessible = texte visible (« Rapports 4 ») : pas d'aria-label (WCAG 2.5.3).
    nav.closest("[data-view-target]")?.removeAttribute("aria-label");
  });
  $("hudCount").textContent = n;
  $("hudCountLabel").textContent = n > 1 ? "dépôts relevés" : "dépôt relevé";
  $("hudSectors").innerHTML = sectorBarHtml(sectorCounts());
  // « jeu. 24.09 » : le jour de la semaine s'efface sur les petits écrans (3 onglets).
  const [day, ...rest] = stampDate(state.date).split(" ");
  $("tourDate").innerHTML = rest.length ? `<span class="stampDay">${esc(day)}</span> ${esc(rest.join(" "))}` : esc(day);
  $("tourDate").setAttribute("datetime", state.date || "");
  const sub = $("appbarSub");
  if (sub) sub.textContent = state.date ? `Tournée du ${dateLongue(state.date)}` : "";
  renderSaveStatus();
  // La sauvegarde suit souvent le rendu (même geste) : l'heure est relue juste après.
  setTimeout(renderSaveStatus, 0);
  map.setPins(
    state.bps.map((bp, i) => ({ rue: bp.rue, label: `n°${i + 1} · ${adresseText(bp)}` })),
    { fresh, editing: state.editing },
  );
  renderReport();
  renderDashboard();
}

/* ─── État de sauvegarde (en-tête, barre latérale) ───
   « Enregistré · 14:32 » depuis state.lastSaved ; « Hors connexion » (la
   sauvegarde reste locale) ; « Sauvegarde impossible » si le stockage est plein. */
let saveFailed = false;
function renderSaveStatus() {
  const t = state.lastSaved || "";
  const offline = !navigator.onLine;
  const tone = saveFailed ? "danger" : offline ? "warn" : "ok";
  const word = saveFailed ? "Sauvegarde impossible" : offline ? "Hors connexion" : "Enregistré";
  const iconId = tone === "ok" ? "i-circle-check" : tone === "warn" ? "i-wifi-off" : "i-alert";
  const title = saveFailed
    ? "Stockage plein : exportez vos bons de passage depuis les Réglages."
    : `${offline ? "Hors connexion — " : ""}${t ? `Tournée enregistrée sur l'appareil à ${t}` : "Tournée enregistrée sur l'appareil"}`;
  document.querySelectorAll("[data-save-status]").forEach((el) => {
    if (el.dataset.tone !== tone) el.dataset.tone = tone;
    el.title = title;
    const w = el.querySelector(".saveWord");
    const tm = el.querySelector(".saveTime");
    const use = el.querySelector("use");
    if (w && w.textContent !== word) w.textContent = word;
    const time = saveFailed ? "" : t;
    if (tm && tm.textContent !== time) tm.textContent = time;
    if (use && use.getAttribute("href") !== `#${iconId}`) use.setAttribute("href", `#${iconId}`);
  });
}
function watchSaveStatus() {
  // Événement prévu côté storage.js (« bv:saved ») ; à défaut, relecture régulière.
  document.addEventListener("bv:saved", () => {
    saveFailed = false;
    renderSaveStatus();
  });
  document.addEventListener("bv:quota", () => {
    saveFailed = true;
    renderSaveStatus();
  });
  window.addEventListener("online", renderSaveStatus);
  window.addEventListener("offline", renderSaveStatus);
  let last = state.lastSaved;
  setInterval(() => {
    if (state.lastSaved !== last) {
      last = state.lastSaved;
      renderSaveStatus();
    }
  }, 2000);
  renderSaveStatus();
}

function changed(opts = {}) {
  renderTour(opts);
  renderAllComposer();
}

/* ─── Réglages de tournée ─── */
function bindSettings() {
  const dlg = $("settingsDlg");
  closeOnBackdrop(dlg);
  const openSettings = () => {
    if (dlg.open) return;
    $("date").value = state.date;
    $("saveStatus").textContent = state.lastSaved ? `Enregistré sur l'appareil à ${state.lastSaved}` : "Enregistré sur l'appareil";
    dlg.showModal();
  };
  // En-tête (#openSettings) et barre latérale ([data-open-settings]) : même réglages.
  $("openSettings").onclick = openSettings;
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-settings]")) openSettings();
  });
  $("date").addEventListener("change", (e) => {
    // Choix manuel : gardé jusqu'à la fin de la journée (le lendemain, la
    // date repasse d'elle-même au jour courant).
    setTourDate(e.target.value || todayISO());
    state.dateDay = todayISO();
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
    // Identifiants : conservés, complétés s'ils manquent ou se répètent.
    const seen = new Set();
    clean.forEach((b) => {
      if (!b.id || seen.has(b.id)) b.id = newBpId();
      seen.add(b.id);
    });
    state.bps = clean;
    state.staleSince = "";
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

/* ─── Date de tournée : toujours la date du jour ─── */

/** Texte retouché à la main : sa date suit (sinon objet et corps divergent). */
function retimeCustomMail(before, after) {
  if (!state.mailCustom || !before || before === after) return;
  state.mailCustom = state.mailCustom
    .split(dateLongue(before)).join(dateLongue(after))
    .split(dateFr(before)).join(dateFr(after));
}

/** Change la date de la tournée ; un texte retouché à la main suit. */
function setTourDate(date) {
  const before = state.date;
  if (date === before) return;
  state.date = date;
  // Texte retouché à la main : sa date suit (sinon objet et corps divergent).
  retimeCustomMail(before, date);
  if ($("settingsDlg")?.open) $("date").value = date;
  renderTour();
}

/**
 * Nouveau jour (ouverture de l'appli, retour dessus, ou minuit passé appli
 * ouverte) : la date de tournée passe automatiquement à la date du jour.
 * Les bons déjà enregistrés sont conservés ; l'agent est prévenu.
 */
function syncTourDate({ announce = true } = {}) {
  const today = todayISO();
  if (state.dateDay === today && state.date) return;
  const changed = state.date && state.date !== today;
  if (changed && state.bps.length && !state.staleSince) state.staleSince = state.date;
  state.dateDay = today;
  setTourDate(today);
  save();
  if (changed && announce) {
    const left = state.bps.length ? ` ${plural(state.bps.length, "bon de passage", "bons de passage")} de la veille ${state.bps.length > 1 ? "sont toujours enregistrés" : "est toujours enregistré"}.` : "";
    toast(`Date de tournée mise à jour : ${dateLongue(today)}.${left}`, null, left ? "warn" : "");
  }
}

function watchDay() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncTourDate();
  });
  window.addEventListener("focus", () => syncTourDate());
  setInterval(() => syncTourDate(), 60 * 1000);
}

/* ─── Carte : toucher → rues proches ─── */
function onMapPick({ list, quartier }) {
  const box = $("mapPick");
  $("mapPickTitle").innerHTML = quartier
    ? `Quartier <b>${esc(quartier)}</b> · rues proches`
    : "Rues les plus proches";
  const listEl = $("mapPickList");
  if (!list.length) return;
  const narrow = !matches(MQ.desktop);
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
  // Délégation : fonctionne aussi pour les boutons créés après le démarrage
  // (cartes du tableau de bord, activité récente…).
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view-target]");
    if (!b) return;
    const view = b.dataset.viewTarget;
    if (view === "terrain" && b.dataset.new && state.editing == null) go("terrain", 1);
    else go(view, state.stage);
  });
  $("mapFit").onclick = () => map.fit();
  // Logo (en-tête et barre latérale) : retour à l'Accueil.
  document.querySelectorAll(".brand").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      go("accueil");
    }),
  );
  // Lien d'évitement « Aller à la saisie » : ouvre le Terrain et y place le focus.
  document.querySelector(".skip-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (state.view !== "terrain") go("terrain", state.stage);
    requestAnimationFrame(() => {
      const target = state.stage === 1 ? $("streetInput") : $("panel");
      (target && target.offsetParent ? target : $("panel")).focus();
    });
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
    else if (view === "terrain") {
      map.setTarget(state.current.rue ? state.current.rue.rue : null);
      // La carte réapparaît (masquée hors Terrain) : taille recalculée.
      requestAnimationFrame(() => map.refresh());
    }
    requestAnimationFrame(placeToast);
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
  // Date de tournée : toujours la date du jour (mise à jour à l'ouverture,
  // au retour dans l'appli et à minuit). Un choix manuel dans les Réglages
  // vaut pour la journée en cours.
  const reopenedNextDay = state.date && state.dateDay !== todayISO() && state.date !== todayISO();
  // Bons gardés d'un jour précédent : on retient la date de cette tournée
  // (l'Accueil la signale jusqu'à la clôture, même pour des bons sans heure).
  if (reopenedNextDay && state.bps.length && !state.staleSince) state.staleSince = state.date;
  if (state.dateDay !== todayISO() || !state.date) {
    retimeCustomMail(state.date, todayISO());
    state.date = todayISO();
    state.dateDay = todayISO();
  }

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
    // Balise touchée : le bon correspondant est mis en évidence dans les Rapports
    // (revealBp remet le filtre à zéro si le bon est masqué).
    onPinClick: (i) => revealBp(i),
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
  initDashboard({ edit: editBp, reveal: revealBp });
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
  watchDay();
  initOfflineBanner();
  initToast();
  watchSaveStatus();

  // Restaure la saisie en cours
  const c = state.current;
  restoreInputs();

  // Retour d'Android après un échec d'ouverture d'Outlook (…?outlook=echec#rapport) :
  // l'adresse est nettoyée et le rapport rouvert avec les autres façons d'envoyer.
  const params = new URLSearchParams(window.location.search);
  const outlookFailed = params.get(ANDROID_RETURN_PARAM) === "echec";
  if (outlookFailed) {
    params.delete(ANDROID_RETURN_PARAM);
    const q = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${q ? "?" + q : ""}#rapport`);
    state.view = "rapport";
  }

  initRouter();
  changed();
  if (outlookFailed && state.bps.length) showOutlookAndroidFailed();
  if (!c.rue && state.bps.length) map.fitPins();
  renderComposer();
  save();
  loadSectorContours();
  // Interface prête : la séquence de démarrage peut s'effacer.
  splash.step("ui");
  if (reopenedNextDay && state.bps.length) {
    const n = state.bps.length;
    const msg = `Date de tournée : ${dateLongue(state.date)}. ${plural(n, "bon de passage", "bons de passage")} d'une tournée précédente ${n > 1 ? "sont toujours enregistrés" : "est toujours enregistré"}.`;
    // Après l'écran de démarrage, pour que le message soit lu.
    if ($("splash")) document.addEventListener("bv:splashdone", () => toast(msg, null, "warn"), { once: true });
    else toast(msg, null, "warn");
  }
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
