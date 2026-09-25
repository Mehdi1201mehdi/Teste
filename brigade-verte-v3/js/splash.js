// Séquence de démarrage — pilotage.
//
// · La barre suit le VRAI chargement : app.js déclare chaque étape terminée
//   (polices, rues, déchets, carte, interface) via splash.step().
// · Les voyants disent vrai : « SECURE CONNECTION » seulement en HTTPS,
//   « SYSTEM ONLINE » seulement avec réseau (sinon « HORS LIGNE »).
// · Durée : séquence complète au premier lancement du jour (≈ 2,8 s sortie
//   comprise), courte ensuite (≈ 1,2 s) — un agent ouvre l'appli des dizaines de fois par jour.
//   Un toucher (ou Échap / Entrée) écourte ; jamais plus de 8 s au total.
// · Aucun logo officiel n'est inventé : l'emblème de l'application est
//   affiché ; pour le logo officiel, déposez le fichier fourni par la
//   collectivité dans assets/logo/ et renseignez OFFICIAL_LOGO ci-dessous
//   (ajoutez-le aussi à SHELL_ASSETS dans service-worker.js).

const OFFICIAL_LOGO = null; // ex. "assets/logo/police-municipale-amiens.svg"

const DAY_KEY = "bv_splash_day";
const MIN_FULL = 2000;
const MIN_QUICK = 600;
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

/* ─── Poussière numérique : quelques dizaines de points, jamais plus ─── */
function startDust(canvas) {
  if (!canvas || reduceMotion()) return () => {};
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0;
  let h = 0;
  const count = window.innerWidth < 600 ? 22 : 38;
  const dots = [];
  const resize = () => {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  for (let i = 0; i < count; i++) {
    dots.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.5 + Math.random() * 1.1,
      vy: -(0.05 + Math.random() * 0.18),
      vx: (Math.random() - 0.5) * 0.06,
      a: 0.08 + Math.random() * 0.35,
      tw: Math.random() * Math.PI * 2,
    });
  }
  let raf = 0;
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(48, now - last) / 16.7;
    last = now;
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.tw += 0.03 * dt;
      if (d.y < -4) {
        d.y = h + 4;
        d.x = Math.random() * w;
      }
      ctx.globalAlpha = d.a * (0.65 + 0.35 * Math.sin(d.tw));
      ctx.fillStyle = "#7effb2";
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.addEventListener("resize", resize);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
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
      logo.src = OFFICIAL_LOGO;
      logo.classList.add("is-official");
    };
    img.src = OFFICIAL_LOGO;
  }

  // Voyants honnêtes
  const secure = window.location.protocol === "https:" || /^(localhost|127\.)/.test(window.location.hostname);
  const setOnline = () => {
    const on = navigator.onLine;
    $("splashOnline").textContent = on ? "SYSTEM ONLINE" : "HORS LIGNE · DONNÉES LOCALES";
    $("splashOnlineDot").classList.toggle("is-warn", !on);
  };
  $("splashSecure").textContent = secure ? "SECURE CONNECTION" : "CONNEXION NON CHIFFRÉE";
  $("splashSecureDot").classList.toggle("is-warn", !secure);
  $("splashProto").textContent = secure ? "HTTPS · TLS" : "HTTP";
  setOnline();

  // Horloge et date réelles
  const clock = $("splashClock");
  const tick = () => {
    const d = new Date();
    clock.textContent =
      d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
      " · " +
      d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };
  tick();
  const clockTimer = setInterval(tick, 1000);

  const stopDust = startDust($("splashDust"));

  // Progression réelle
  let progress = 0.04;
  const doneSteps = new Set();
  const bar = $("splashBar");
  const pct = $("splashPct");
  const render = () => {
    bar.style.setProperty("--p", progress.toFixed(3));
    pct.textContent = String(Math.round(progress * 100)).padStart(3, "0") + " %";
  };
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
    $("splashStatus").textContent = failed ? "MODE DÉGRADÉ" : "SYSTÈME OPÉRATIONNEL";
    // Laisser lire « SYSTÈME OPÉRATIONNEL » un instant, puis sortir en fondu.
    setTimeout(
      () => {
        root.classList.add("is-leaving");
        if (app) app.inert = false;
        const end = () => {
          clearInterval(clockTimer);
          stopDust();
          root.remove();
          document.dispatchEvent(new CustomEvent("bv:splashdone"));
        };
        setTimeout(end, reduceMotion() ? 320 : 560);
      },
      // « SYSTÈME OPÉRATIONNEL » reste lisible un instant (sauf séquence courte).
      skipped || reduceMotion() || root.classList.contains("is-quick") ? 140 : 300,
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
      const el = $("splashVoies");
      if (el && n) el.textContent = `${n.toLocaleString("fr-FR")} VOIES INDEXÉES`;
    },
  };
  window.addEventListener("online", setOnline);
  window.addEventListener("offline", setOnline);
  return api;
}

export const splash = createSplash();
