// Séquence de démarrage — pilotage.
//
// · La barre suit le VRAI chargement : app.js déclare chaque étape terminée
//   (polices, rues, déchets, carte, interface) via splash.step().
// · Une seule ligne d'état, toujours vraie (voies chargées, hors connexion).
// · Durée : ≈ 1,4 s au premier lancement du jour, ≈ 0,2 s ensuite — un agent
//   ouvre l'appli des dizaines de fois par jour.
//   Un toucher (ou Échap / Entrée) écourte ; jamais plus de 8 s au total.
// · Aucun logo officiel n'est inventé : l'emblème de l'application est
//   affiché ; pour le logo officiel, déposez le fichier fourni par la
//   collectivité dans assets/logo/ et renseignez OFFICIAL_LOGO ci-dessous
//   (ajoutez-le aussi à SHELL_ASSETS dans service-worker.js).

const OFFICIAL_LOGO = null; // ex. "assets/logo/police-municipale-amiens.svg"

const DAY_KEY = "bv_splash_day";
const MIN_FULL = 1400;
const MIN_QUICK = 200;
const MAX_TOTAL = 8000;
const STEPS = { fonts: 0.1, streets: 0.3, waste: 0.1, map: 0.2, ui: 0.25, areas: 0.05 };

const $ = (id) => document.getElementById(id);
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** « full » au premier lancement du jour, « quick » ensuite, « off » (réglage de test). */
function pickMode() {
  try {
    const forced = new URLSearchParams(window.location.search).get("splash");
    if (forced === "full" || forced === "quick" || forced === "off") return forced;
    if (localStorage.getItem("bv_splash_mode") === "off") return "off";
    if (localStorage.getItem(DAY_KEY) === todayKey()) return "quick";
    localStorage.setItem(DAY_KEY, todayKey());
  } catch {
    /* stockage indisponible : séquence complète */
  }
  return "full";
}

function createSplash() {
  const root = $("splash");
  const app = $("app");
  const noop = { step() {}, done() {}, fail() {}, setVoies() {} };
  if (!root) return noop;

  const mode = pickMode();
  if (mode === "off") {
    root.remove();
    return noop;
  }
  if (mode === "quick") root.classList.add("is-quick");
  const minTime = reduceMotion() ? MIN_QUICK : mode === "quick" ? MIN_QUICK : MIN_FULL;
  const t0 = performance.now();

  // L'application reste hors d'atteinte (clavier, lecteur d'écran) pendant la séquence.
  if (app) app.inert = true;

  // Logo officiel, uniquement s'il a été fourni
  const logo = $("splashLogo");
  if (OFFICIAL_LOGO && logo) {
    const img = new Image();
    img.onload = () => {
      img.className = "splashLogo is-official";
      img.alt = "";
      logo.replaceWith(img);
    };
    img.src = OFFICIAL_LOGO;
  }

  // Une seule ligne d'état, toujours vraie.
  const note = $("splashNote");
  const setNote = (text) => note && (note.textContent = text);
  const setOnline = () => {
    if (!$("splashNote")) return; // écran déjà retiré
    if (!navigator.onLine) setNote("Hors connexion — données enregistrées sur l'appareil");
  };
  setOnline();

  // Progression réelle
  let progress = 0.04;
  const doneSteps = new Set();
  const bar = $("splashBar");
  const render = () => bar.style.setProperty("--p", progress.toFixed(3));
  render();

  let coreReady = false;
  let failed = false;
  let skipped = false;
  let leaving = false;

  const leave = () => {
    if (leaving) return;
    leaving = true;
    progress = 1;
    render();
    root.classList.add("is-ready");
    if (failed) setNote("Démarrage partiel — l'application reste utilisable");
    setTimeout(
      () => {
        root.classList.add("is-leaving");
        if (app) app.inert = false;
        const end = () => {
          root.remove();
          document.dispatchEvent(new CustomEvent("bv:splashdone"));
        };
        setTimeout(end, reduceMotion() ? 320 : 560);
      },
      skipped || reduceMotion() || root.classList.contains("is-quick") ? 60 : 160,
    );
  };

  const maybeLeave = () => {
    if (leaving || !coreReady) return;
    const wait = Math.max(0, (skipped ? 0 : minTime) - (performance.now() - t0));
    setTimeout(leave, wait);
  };

  // Écourter : toucher, clic, Échap ou Entrée
  const skip = (e) => {
    if (e.type === "keydown" && !["Escape", "Enter", " "].includes(e.key)) return;
    skipped = true;
    maybeLeave();
  };
  root.addEventListener("pointerdown", skip);
  window.addEventListener("keydown", skip);
  document.addEventListener("bv:splashdone", () => window.removeEventListener("keydown", skip), { once: true });

  // Garde-fou : jamais plus de 8 s, même si une étape reste bloquée.
  setTimeout(() => {
    if (!leaving) {
      failed = !coreReady;
      coreReady = true;
      leave();
    }
  }, MAX_TOTAL);

  // Les polices font partie du vrai chargement (le titre en dépend).
  (document.fonts?.ready || Promise.resolve()).then(() => api.step("fonts"));

  const api = {
    /** Une étape réelle du chargement est terminée. */
    step(name) {
      if (doneSteps.has(name) || !(name in STEPS)) return;
      doneSteps.add(name);
      progress = Math.min(0.98, progress + STEPS[name]);
      render();
      if (name === "ui") {
        coreReady = true;
        maybeLeave();
      }
    },
    /** L'application est utilisable (appelé après le premier rendu). */
    done() {
      coreReady = true;
      maybeLeave();
    },
    /** Erreur de démarrage : on sort quand même, en le disant. */
    fail() {
      failed = true;
      coreReady = true;
      maybeLeave();
    },
    /** Donnée réelle affichée en télémétrie (nombre de voies chargées). */
    setVoies(n) {
      if (n && navigator.onLine) setNote(`${n.toLocaleString("fr-FR")} voies d'Amiens chargées`);
    },
  };
  window.addEventListener("online", setOnline);
  window.addEventListener("offline", setOnline);
  return api;
}

export const splash = createSplash();
