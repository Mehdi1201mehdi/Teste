// État de la tournée + persistance locale (hors ligne) + suivi du temps.
// Tout est enregistré à chaque geste : rien n'est jamais perdu si le
// téléphone s'éteint. Aucun serveur : la donnée vit sur l'appareil.

const KEY = "brigade-suivi-v1";

function fresh() {
  return {
    agent: "",
    date: new Date().toISOString().slice(0, 10),
    startedAt: null, // ISO du premier contrôle (début réel de tournée)
    lastAt: null, // ISO du dernier geste
    streets: {}, // "Rue X": { fetched, nums:[{n,k,objs,note}], note, firstAt, lastAt }
  };
}

export const state = fresh();

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && typeof saved === "object") Object.assign(state, fresh(), saved);
  } catch (e) {
    /* stockage indisponible : on garde l'état par défaut, en mémoire */
  }
}

let saveTimer = null;
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    /* quota dépassé / navigation privée : la session continue en mémoire */
  }
}
/** Enregistrement groupé (anti-rafale) pour rester fluide lors des saisies. */
export function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}

/** Marque l'instant d'activité (démarre le chrono de tournée au 1er geste). */
export function touch() {
  const iso = new Date().toISOString();
  if (!state.startedAt) state.startedAt = iso;
  state.lastAt = iso;
}

export function resetAll() {
  const agent = state.agent;
  Object.assign(state, fresh(), { agent });
  save();
}

/** Retourne (en le créant au besoin) l'état d'une rue. */
export function streetState(name) {
  let d = state.streets[name];
  if (!d) {
    d = { fetched: false, nums: [], note: "", firstAt: null, lastAt: null };
    state.streets[name] = d;
  }
  return d;
}

/** Marque l'activité sur une rue (horodatage début/fin de contrôle). */
export function touchStreet(d) {
  const iso = new Date().toISOString();
  if (!d.firstAt) d.firstAt = iso;
  d.lastAt = iso;
  touch();
}

// ── Dérivés (une seule source de vérité pour compteurs et couleurs) ──
export function numCounts(d) {
  let ok = 0, pb = 0;
  for (const x of d.nums) {
    if (x.k === "ok") ok++;
    else if (x.k === "pb") pb++;
  }
  return { total: d.nums.length, ok, pb, seen: ok + pb };
}
export function streetHasPb(d) {
  return d.nums.some((x) => x.k === "pb");
}
export function streetIsDone(d) {
  const c = numCounts(d);
  return c.total > 0 && c.seen === c.total && c.pb === 0;
}
export function streetTouched(d) {
  return !!(d.note && d.note.trim()) || d.nums.some((x) => x.k) || streetHasPb(d);
}
