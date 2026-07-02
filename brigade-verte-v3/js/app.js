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

function renderAll() {
  renderBps();
  renderWastes();
  refreshPrecisions();
  renderSummary();
  generateMail();
  renderStatus();
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
  $("resetCurrent").onclick = () => {
    if (confirm("Effacer la saisie en cours ?")) resetCurrent();
  };
  $("duplicateLast").onclick = duplicateLastAddress;

  $("copyMail").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("mail").textContent);
      toast("Texte copié ✅");
    } catch (e) {
      toast("Copie impossible");
    }
  };

  document.querySelectorAll("[data-next]").forEach((b) => {
    b.onclick = () => go(+b.dataset.next);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) {
      document.querySelectorAll(".suggest").forEach((x) => x.classList.remove("show"));
    }
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (document.readyState === "complete") {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
}

async function main() {
  registerServiceWorker();
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
  setSector(state.current.secteur || state.current.rue?.secteur || null);

  renderAll();
  go(Math.min(state.step || 1, 5));

  save();
  loadSectorContours();
}

main();
