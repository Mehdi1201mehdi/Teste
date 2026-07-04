// Point d'entrée : charge les données, restaure l'état, branche les événements,
// et démarre le rendu. Chaque module reste responsable de son propre domaine.

import { $ } from "./utils.js";
import { state, load, save } from "./storage.js";
import { toast, initOfflineBanner } from "./ui.js";
import { go, initRouter, renderStatus } from "./router.js";
import { loadStreets, showRueSuggest, updateSectorByAddress } from "./streets.js";
import { loadWaste, showWaste, addWaste, renderWastes } from "./waste.js";
import {
  initSectors,
  setSector,
  togglePrecision,
  refreshPrecisions,
  renderSummary,
  resetCurrent,
  addBp,
  duplicateLastAddress,
  renderBps,
} from "./bp.js";
import { generateMail } from "./mail.js";
import { loadSectorContours } from "./sectors.js";
import { locateNearestStreets } from "./geo.js";

function renderAll() {
  renderBps();
  renderWastes();
  refreshPrecisions();
  renderSummary();
  generateMail();
  renderStatus();
}

/** Montre ou cache le bouton "Ma position" selon le réglage GPS. */
function applyGpsSetting() {
  $("locateBtn").hidden = !state.gps;
  const btn = $("gpsToggle");
  btn.textContent = state.gps ? "📍 GPS : activé ✅" : "📍 GPS : désactivé ❌";
  btn.setAttribute("aria-pressed", String(state.gps));
}

function bind() {
  initSectors();

  $("date").value = state.date || new Date().toISOString().slice(0, 10);
  $("date").onchange = () => {
    generateMail();
    save();
  };

  $("streetInput").oninput = (e) => {
    showRueSuggest(e.target.value);
    save();
  };
  $("streetInput").onfocus = (e) => {
    if (e.target.value) showRueSuggest(e.target.value);
  };

  // 📍 GPS : bouton "Ma position" + option activé/désactivé (Autres options).
  $("locateBtn").onclick = locateNearestStreets;
  $("gpsToggle").onclick = () => {
    state.gps = !state.gps;
    applyGpsSetting();
    save();
    toast(state.gps ? "GPS activé" : "GPS désactivé");
  };

  $("numeroRue").oninput = () => {
    state.current.numero = $("numeroRue").value.trim();
    refreshPrecisions();
    clearTimeout(window._numT);
    window._numT = setTimeout(updateSectorByAddress, 450);
    save();
  };

  document.querySelectorAll(".qbtn").forEach((b) => {
    b.onclick = () => togglePrecision(b.dataset.key);
  });

  // Précision libre : l'aperçu et le récapitulatif se mettent à jour en direct.
  $("precCustom").oninput = () => {
    state.current.precisionCustom = $("precCustom").value;
    refreshPrecisions();
  };

  $("wasteInput").oninput = (e) => showWaste(e.target.value);
  $("wasteInput").onfocus = (e) => showWaste(e.target.value);
  $("wasteInput").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addWaste();
    }
  };
  $("addWaste").onclick = addWaste;

  $("addBp").onclick = addBp;
  // Double confirmation : sur le terrain, un pouce qui glisse ne doit pas
  // effacer la saisie en cours.
  $("resetCurrent").onclick = () => {
    if (
      confirm("Effacer la saisie en cours ?") &&
      confirm("Confirme : tout effacer ? Cette action est définitive.")
    ) {
      resetCurrent();
    }
  };
  $("duplicateLast").onclick = duplicateLastAddress;

  // 💾 Export de secours : toutes les BP dans un fichier JSON téléchargé.
  $("exportBps").onclick = () => {
    if (!state.bps.length) return toast("Aucune BP à sauvegarder");
    const data = JSON.stringify(
      { app: "brigade-verte-amiens", version: 3, date: state.date, bps: state.bps },
      null,
      2,
    );
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `brigade-verte-bp-${state.date || new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(state.bps.length + " BP sauvegardées 💾");
  };

  // 📂 Import : recharge les BP depuis un fichier exporté.
  $("importBps").onclick = () => $("importFile").click();
  $("importFile").onchange = async () => {
    const file = $("importFile").files[0];
    $("importFile").value = "";
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const bps = Array.isArray(json) ? json : json.bps;
      if (!Array.isArray(bps) || !bps.every((b) => b && b.rue && b.secteur)) {
        return toast("Fichier non reconnu");
      }
      if (state.bps.length && !confirm(`Remplacer les ${state.bps.length} BP actuelles par les ${bps.length} BP du fichier ?`)) {
        return;
      }
      state.bps = bps;
      state.mailCustom = "";
      renderBps();
      generateMail();
      save();
      toast(bps.length + " BP rechargées 📂");
    } catch (e) {
      toast("Fichier illisible");
    }
  };

  $("copyMail").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("mail").textContent);
      toast("Texte copié ✅");
    } catch (e) {
      toast("Copie impossible");
    }
  };

  // 📧 Ouvre Outlook avec l'objet et le texte pré-remplis.
  // 1. Tente l'application Outlook (schéma ms-outlook://, mobile et PC).
  // 2. Si Outlook ne s'ouvre pas en ~1,4 s, bascule sur mailto: (appli par défaut).
  // 3. Si le texte est trop long pour une URL, il est copié à la place.
  $("openMail").onclick = async () => {
    const body = $("mail").textContent;
    const [a, m, j] = ($("date").value || "").split("-");
    const subject = a ? `Dépôts sauvages — îlotage du ${j}/${m}/${a}` : "Dépôts sauvages";
    const params = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (params.length > 1800) {
      try {
        await navigator.clipboard.writeText(body);
        toast("Texte trop long pour le mail direct — copié à la place 📋");
      } catch (e) {
        toast("Texte trop long — utilise 📋 Copier");
      }
      return;
    }
    // Si Outlook s'ouvre, la page passe en arrière-plan et le repli est annulé.
    const fallback = setTimeout(() => {
      window.location.href = `mailto:?${params}`;
    }, 1400);
    const cancelFallback = () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(fallback);
        document.removeEventListener("visibilitychange", cancelFallback);
      }
    };
    document.addEventListener("visibilitychange", cancelFallback);
    window.location.href = `ms-outlook://compose?${params}`;
  };

  // ✏ Modification manuelle du texte de la BP : un clic ouvre l'édition,
  // un second la termine et enregistre. Le texte modifié survit au rechargement.
  $("editMail").onclick = () => {
    const mailEl = $("mail");
    const btn = $("editMail");
    const editing = mailEl.getAttribute("contenteditable") === "true";
    if (editing) {
      mailEl.setAttribute("contenteditable", "false");
      btn.textContent = "✏ Modifier le texte";
      btn.classList.remove("on");
      const txt = mailEl.innerText.trim();
      state.mailCustom = txt;
      generateMail();
      save();
      toast("Texte enregistré ✅");
    } else {
      mailEl.setAttribute("contenteditable", "true");
      btn.textContent = "✔ Terminer";
      btn.classList.add("on");
      mailEl.focus();
      toast("Tape directement dans le texte");
    }
  };

  // 🗑 Supprime les modifications manuelles et rétablit le texte automatique.
  $("resetMail").onclick = () => {
    if (state.mailCustom && !confirm("Supprimer tes modifications et rétablir le texte automatique ?")) {
      return;
    }
    state.mailCustom = "";
    const mailEl = $("mail");
    mailEl.setAttribute("contenteditable", "false");
    $("editMail").textContent = "✏ Modifier le texte";
    $("editMail").classList.remove("on");
    generateMail();
    save();
    toast("Texte automatique rétabli");
  };

  // ✏ Modifier la sélection de rue déjà validée : on garde le numéro,
  // les précisions et les déchets — seule la rue est à rechoisir.
  $("changeStreet").onclick = () => {
    state.current.rue = null;
    setSector(null);
    $("chosenBox").classList.remove("show");
    const input = $("streetInput");
    input.focus();
    input.select();
    save();
    toast("Choisis la nouvelle rue");
  };

  document.querySelectorAll("[data-next]").forEach((b) => {
    b.onclick = () => go(+b.dataset.next);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) {
      document.querySelectorAll(".suggest").forEach((x) => x.classList.remove("show"));
    }
  });

  // Clavier mobile : une fois le clavier ouvert (≈300 ms), recentre le champ
  // actif pour qu'il reste visible au-dessus du clavier, sur Android et iOS.
  document.querySelectorAll("input, .mail").forEach((el) => {
    el.addEventListener("focus", () => {
      setTimeout(() => {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 300);
    });
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // Quand une nouvelle version de l'appli est installée, la page se recharge
  // une fois automatiquement pour que HTML et JavaScript restent synchronisés.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  const register = () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  };
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register);
  }
}

async function main() {
  registerServiceWorker();
  // Demande au navigateur de protéger le stockage local contre le nettoyage
  // automatique (Android/iOS sous pression mémoire).
  navigator.storage?.persist?.().catch(() => {});
  load();
  await Promise.all([loadStreets(), loadWaste()]);
  bind();
  initRouter();
  initOfflineBanner();

  if (state.current.rue) {
    $("streetInput").value = state.current.rue.rue;
    $("chosenBox").classList.add("show");
    $("chosenRue").textContent = state.current.rue.rue;
  }
  $("numeroRue").value = state.current.numero || "";
  $("precCustom").value = state.current.precisionCustom || "";
  if (typeof state.gps !== "boolean") state.gps = true;
  applyGpsSetting();
  setSector(state.current.secteur || state.current.rue?.secteur || null);

  renderAll();
  go(Math.min(state.step || 1, 5));

  save();
  loadSectorContours();
}

main();
