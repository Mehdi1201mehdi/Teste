// Point d'entrée : charge les données, restaure la tournée, relie les vues.
// Chaque module garde son domaine : composer (saisie), report (rapport),
// map (territoire), router (navigation), storage (persistance).

// La séquence de démarrage s'initialise en premier : elle mesure le vrai chargement.
import { splash } from "./splash.js";
import { $, esc, todayISO, stampDate, plural } from "./utils.js";
import { state, load, save, nextRef } from "./storage.js";
import { normalizeBp } from "./model.js";
import { loadTours, cachedTours, mergeTours, storageEstimate, archiveAvailable } from "./archive.js";
import { withInsights } from "./ops.js";
import { DEFAULT_WEIGHTS, WEIGHT_LABELS, weightsOf } from "./priority.js";
import { toCSV, buildBackup, parseBackup, download } from "./exporter.js";
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
import { initHistory, renderHistory, refreshArchive, leaveHistory } from "./history.js";

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
  renderHistory();
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
    renderWeights();
    dlg.showModal();
  };
  $("healthSettings").addEventListener("toggle", () => $("healthSettings").open && renderHealth());

  // Indice de priorité : pondérations réglables (0 à 10), appliquées partout
  // (liste, fiche, carte, tableau de bord, CSV) dès la modification.
  function renderWeights() {
    const w = weightsOf(state.prio);
    $("prioWeights").innerHTML = Object.keys(DEFAULT_WEIGHTS)
      .map(
        (k) => `<label class="weightRow"><span>${esc(WEIGHT_LABELS[k])}</span>
        <input type="number" class="input input--num mono" inputmode="numeric" min="0" max="10" step="1" data-w="${k}" value="${w[k]}" aria-label="Points : ${esc(WEIGHT_LABELS[k])}"></label>`,
      )
      .join("");
    $("prioWeights").querySelectorAll("[data-w]").forEach((inp) => {
      inp.onchange = () => {
        const v = Math.round(Number(inp.value));
        if (!Number.isFinite(v) || v < 0 || v > 10) {
          inp.value = weightsOf(state.prio)[inp.dataset.w];
          return toast("Valeur entre 0 et 10.", null, "warn");
        }
        state.prio = { ...weightsOf(state.prio), [inp.dataset.w]: v };
        save();
        renderTour();
      };
    });
  }
  $("prioReset").onclick = () => {
    state.prio = null;
    save();
    renderWeights();
    renderTour();
    toast("Pondérations par défaut rétablies.", null, "ok");
  };

  // Santé du système : uniquement des informations réellement mesurées.
  async function renderHealth() {
    const row = (k, v, tone = "") => `<div${tone ? ` data-tone="${tone}"` : ""}><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    let version = "—";
    try {
      const keys = await caches.keys();
      const m = keys.map((k) => k.match(/shell-(v[\d.]+)/)).find(Boolean);
      version = m ? m[1] : "non installée (pas de cache hors ligne)";
    } catch (e) {
      version = "indisponible";
    }
    const sw = !("serviceWorker" in navigator) ? ["Non pris en charge", "warn"] : navigator.serviceWorker.controller ? ["Actif : l'application fonctionne hors ligne", "ok"] : ["Inactif (premier chargement ou navigation privée)", "warn"];
    const conn = navigator.connection?.effectiveType ? ` · ${navigator.connection.effectiveType.toUpperCase()}` : "";
    let gps = state.gps ? "Activé dans l'application" : "Désactivé dans l'application";
    try {
      const p = await navigator.permissions?.query({ name: "geolocation" });
      if (p) gps += ` · autorisation navigateur : ${{ granted: "accordée", denied: "refusée", prompt: "demandée à l'usage" }[p.state] || p.state}`;
    } catch (e) {
      /* API absente (Safari ancien) : on n'affiche que le réglage */
    }
    const est = await storageEstimate();
    const mo = (b) => `${(b / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
    let tours = [];
    let archive = "Disponible";
    try {
      tours = await loadTours();
    } catch (e) {
      archive = `Illisible (${e.message})`;
    }
    const nbArch = tours.reduce((a, t) => a + t.bps.length, 0);
    const quarantine = (state.quarantine || []).length;
    $("health").innerHTML = [
      row("Version", `<span class="mono">${esc(version)}</span>`),
      row("Service worker", esc(sw[0]), sw[1]),
      row("Réseau", navigator.onLine ? `En ligne${esc(conn)}` : "Hors ligne — la saisie continue", navigator.onLine ? "ok" : "warn"),
      row("GPS", esc(gps)),
      row("Tournée en cours", `${plural(state.bps.length, "signalement")}`),
      row("Historique (IndexedDB)", archiveAvailable() ? `${esc(archive)} · ${plural(tours.length, "tournée")} · ${plural(nbArch, "signalement")}` : "Non pris en charge par ce navigateur", archiveAvailable() && !/Illisible/.test(archive) ? "" : "warn"),
      row("Éléments en quarantaine", quarantine ? `${quarantine} (données illisibles conservées, incluses dans la sauvegarde complète)` : "Aucun", quarantine ? "warn" : ""),
      row("Espace utilisé", est ? `${mo(est.usage)} sur ${mo(est.quota)} disponibles${est.persisted ? " · stockage protégé" : " · stockage non protégé (le navigateur peut le vider si l'appareil manque de place)"}` : "Non communiqué par ce navigateur"),
      row("Dernier enregistrement", state.lastSaved ? `Aujourd'hui à ${esc(state.lastSaved)}` : "—"),
      row("Dernière sauvegarde complète", state.lastBackup ? esc(new Date(state.lastBackup).toLocaleString("fr-FR")) : "Jamais — pensez à exporter l'historique", state.lastBackup ? "" : "warn"),
      row("Synchronisation", "Aucune : les données restent sur cet appareil (pas de serveur)"),
    ].join("");
  }
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

  // Export de secours : les bons de la tournée en cours (format historique, champs v5 inclus).
  $("exportBps").onclick = () => {
    if (!state.bps.length) return toast("Aucun signalement à sauvegarder.");
    download(`brigade-verte-bp-${state.date || todayISO()}.json`, JSON.stringify({ app: "brigade-verte-amiens", version: 5, date: state.date, bps: state.bps }, null, 2), "application/json");
    toast(`${plural(state.bps.length, "signalement")} exporté${state.bps.length > 1 ? "s" : ""}.`, null, "ok");
  };

  // Sauvegarde complète : tournée en cours + historique (seul moyen de copier
  // l'historique hors de l'appareil — aucune synchronisation n'existe).
  $("exportAll").onclick = async () => {
    let tours = [];
    try {
      tours = await loadTours();
    } catch (e) {
      toast(`Historique illisible (${e.message}) : seule la tournée en cours est sauvegardée.`, null, "warn");
    }
    if (!state.bps.length && !tours.length) return toast("Rien à sauvegarder pour l'instant.");
    download(`brigade-verte-sauvegarde-${todayISO()}.json`, JSON.stringify(buildBackup(state, tours)), "application/json");
    state.lastBackup = new Date().toISOString();
    save();
    const n = state.bps.length + tours.reduce((a, t) => a + t.bps.length, 0);
    toast(`Sauvegarde complète : ${plural(n, "signalement")}, ${plural(tours.length, "tournée archivée", "tournées archivées")}.`, null, "ok");
  };

  // Tableur : un signalement par ligne (Excel, LibreOffice, import dans un CRM).
  $("exportCsv").onclick = async () => {
    try {
      await loadTours();
    } catch (e) {
      /* l'historique manquant est signalé ci-dessous par le nombre de lignes */
    }
    const rows = withInsights([...state.bps.map((bp) => ({ bp, tour: { id: state.tour?.id || "" } })), ...cachedTours().flatMap((t) => t.bps.map((bp) => ({ bp, tour: t })))]);
    if (!rows.length) return toast("Aucun signalement à exporter.");
    download(`brigade-verte-signalements-${todayISO()}.csv`, toCSV(rows), "text/csv;charset=utf-8");
    toast(`${plural(rows.length, "signalement")} exporté${rows.length > 1 ? "s" : ""} en CSV.`, null, "ok");
  };

  // Import : sauvegarde complète (fusion de l'historique, rien n'est supprimé)
  // ou fichier d'une tournée (remplace la tournée en cours, après confirmation).
  $("importBps").onclick = () => $("importFile").click();
  $("importFile").onchange = async () => {
    const file = $("importFile").files[0];
    $("importFile").value = "";
    if (!file) return;
    try {
      const parsed = parseBackup(JSON.parse(await file.text()));
      let merged = null;
      if (parsed.tours.length) {
        try {
          merged = await mergeTours(parsed.tours, { nextRef });
        } catch (e) {
          return toast(`Historique non restauré (${e.message}) — rien n'a été modifié.`, null, "error");
        }
      }
      if (parsed.settings?.mailTo && !state.mailTo) state.mailTo = parsed.settings.mailTo;
      if (parsed.settings?.prio && !state.prio) state.prio = weightsOf(parsed.settings.prio);
      const date = parsed.date || state.date;
      const tourId = state.tour?.id || "";
      const clean = parsed.currentBps.map((b) => normalizeBp(b, { date, tourId, nextRef })).filter(Boolean);
      const skipped = parsed.currentBps.length - clean.length;
      if (!clean.length) {
        if (merged) {
          changed();
          save();
          dlg.open && dlg.close();
          return toast(`Historique restauré : ${plural(merged.added, "tournée ajoutée", "tournées ajoutées")}, ${plural(merged.updated, "complétée", "complétées")}.`, null, "ok");
        }
        return toast("Aucun signalement valide dans ce fichier — rien n'a été remplacé.", null, "error");
      }
      if (state.bps.length) {
        dlg.close();
        const ok = await confirmDialog({
          title: "Remplacer la tournée en cours ?",
          text: `Les ${state.bps.length} signalements de la tournée en cours seront remplacés par les ${clean.length} du fichier.${merged ? " L'historique, lui, a déjà été complété sans rien supprimer." : ""}`,
          ok: "Remplacer",
        });
        if (!ok) return;
      }
      if (!state.tour) state.tour = { id: clean[0].tourId || `T-${(date || todayISO()).replace(/-/g, "")}-imp`, startedAt: null };
      if (parsed.date) state.date = parsed.date;
      state.bps = clean.map((b) => ({ ...b, tourId: b.tourId || state.tour.id }));
      state.mailCustom = "";
      state.editing = null;
      changed();
      save();
      dlg.open && dlg.close();
      toast(`${plural(clean.length, "signalement")} rechargé${clean.length > 1 ? "s" : ""}${skipped ? ` (${skipped} illisible${skipped > 1 ? "s" : ""} ignoré${skipped > 1 ? "s" : ""})` : ""}${merged ? ` · historique : +${merged.added} tournée(s)` : ""}.`, null, "ok");
    } catch (e) {
      toast(/non reconnu/.test(e.message) ? e.message : "Fichier illisible — vos signalements actuels sont intacts.", null, "error");
    }
  };

  document.addEventListener("bv:quota", () =>
    toast("Stockage plein : exportez vos signalements (Réglages) pour ne rien perdre.", null, "error"),
  );
}

/* ─── Carte : toucher → rues proches ─── */
function onMapPick({ list, quartier, lat, lon }) {
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
      // Le point touché devient la position du dépôt (source « carte »).
      chooseRue(rue, { fly: true, geo: Number.isFinite(lat) ? { lat, lon, acc: null, source: "carte" } : null });
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
    if (view === "historique") return refreshArchive({ fresh: true, entering: true });
    leaveHistory(); // couche « historique » et bascule carte retirées
    if (view === "terrain") map.setTarget(state.current.rue ? state.current.rue.rue : null);
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
        t?.scrollIntoView({ block: "center", behavior: "smooth" });
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
  initHistory({
    changed,
    edit: editBp,
    // « Régler les pondérations » depuis une fiche ou le tableau de bord.
    settings: (section) => {
      $("openSettings").click();
      if (section === "prio") {
        $("prioSettings").open = true;
        requestAnimationFrame(() => $("prioSettings").scrollIntoView({ block: "start" }));
      }
    },
  });
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
  initOfflineBanner();
  initToast();

  // Restaure la saisie en cours
  const c = state.current;
  $("streetInput").value = c.rue?.rue || "";
  $("numeroRue").value = c.numero || "";
  $("precCustom").value = c.precisionCustom || "";
  $("bpNote").value = c.note || "";
  if (c.rue) map.setTarget(c.rue.rue, { fly: false });

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
