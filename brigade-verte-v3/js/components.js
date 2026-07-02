// Générateurs de balisage réutilisables (listes de suggestions, pastilles, cartes BP).

import { esc } from "./utils.js";

/**
 * Affiche une liste de suggestions dans un menu déroulant tactile.
 * @param {HTMLElement} box
 * @param {Array<{html:string,onClick:Function}>} entries
 * @param {string} emptyMessage
 */
export function showSuggestions(box, entries, emptyMessage) {
  if (!entries.length) {
    box.innerHTML = `<div class="none">${esc(emptyMessage)}</div>`;
    box.classList.add("show");
    return;
  }
  box.innerHTML = entries
    .map((e, i) => `<button type="button" class="sug" role="option" data-i="${i}">${e.html}</button>`)
    .join("");
  box.classList.add("show");
  box.querySelectorAll(".sug").forEach((btn, i) => {
    btn.onclick = entries[i].onClick;
  });
}

export function hideSuggestions(box) {
  box.classList.remove("show");
}

/**
 * Affiche des pastilles amovibles (ex : déchets ajoutés).
 * @param {HTMLElement} container
 * @param {string[]} items
 * @param {(index:number) => void} onRemove
 * @param {string} emptyMessage
 */
export function renderChips(container, items, onRemove, emptyMessage) {
  container.innerHTML = items.length
    ? items
        .map((w, i) => `<button type="button" class="chip" data-i="${i}">${esc(w)} <span class="x" aria-hidden="true">×</span><span class="visually-hidden"> — retirer</span></button>`)
        .join("")
    : `<div class="none">${esc(emptyMessage)}</div>`;
  container.querySelectorAll(".chip").forEach((btn, i) => {
    btn.onclick = () => onRemove(i);
  });
}

/**
 * Construit le HTML d'une carte BP (bon de passage) avec ses actions.
 */
export function bpCardHtml(bp, i, adresseText, bpLine) {
  return `<div class="bp">
    <div class="bpTop">
      <div class="num">${i + 1}</div>
      <div class="bpText"><b>${esc(adresseText(bp))}</b><small>${esc(bp.secteur)} · ${esc(bpLine(bp))}</small></div>
    </div>
    <div class="bpBtns">
      <button class="mini" type="button" data-action="edit" data-i="${i}">✏ Modifier</button>
      <button class="mini" type="button" data-action="duplicate" data-i="${i}">⧉ Dupliquer</button>
      <button class="mini" type="button" data-action="delete" data-i="${i}">🗑 Suppr.</button>
    </div>
  </div>`;
}

/** Délègue les clics des boutons d'une carte BP vers les bons gestionnaires. */
export function bindBpActions(container, handlers) {
  container.querySelectorAll("[data-action]").forEach((btn) => {
    const i = +btn.dataset.i;
    btn.onclick = () => handlers[btn.dataset.action]?.(i);
  });
}
