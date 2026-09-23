// Composants réutilisables : combobox (suggestions + clavier), pastilles,
// ticket de bon de passage.

import { esc } from "./utils.js";
import { icon } from "./icons.js";
import { secStyle } from "./sectors.js";

/**
 * Affiche une liste de suggestions accessibles.
 * @param {HTMLElement} box   conteneur role=listbox
 * @param {Array<{html:string,onClick:Function}>} entries
 * @param {string} emptyMessage
 */
export function showSuggestions(box, entries, emptyMessage) {
  box._entries = entries;
  box._active = -1;
  if (!entries.length) {
    box.innerHTML = emptyMessage ? `<div class="none">${esc(emptyMessage)}</div>` : "";
    box.classList.toggle("show", !!emptyMessage);
    return;
  }
  box.innerHTML = entries
    .map(
      (e, i) =>
        `<button type="button" class="sug" role="option" id="${box.id}-o${i}" aria-selected="false" tabindex="-1" data-i="${i}">${e.html}</button>`,
    )
    .join("");
  box.classList.add("show");
  box.querySelectorAll(".sug").forEach((btn, i) => {
    // pointerdown + preventDefault : le champ garde le focus (clavier mobile ouvert)
    btn.addEventListener("pointerdown", (ev) => ev.preventDefault());
    btn.onclick = entries[i].onClick;
  });
}

export function hideSuggestions(box, input) {
  box.classList.remove("show");
  box._active = -1;
  if (input) {
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
}

/**
 * Navigation clavier d'une combobox : ↑ ↓ pour parcourir, Entrée pour choisir,
 * Échap pour fermer. `onEnterFree` est appelé si Entrée sans option active.
 */
export function bindComboKeys(input, box, onEnterFree) {
  input.addEventListener("keydown", (e) => {
    const open = box.classList.contains("show");
    const opts = [...box.querySelectorAll(".sug")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open || !opts.length) return;
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      box._active = (box._active + dir + opts.length) % opts.length;
      opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === box._active)));
      const cur = opts[box._active];
      input.setAttribute("aria-activedescendant", cur.id);
      cur.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (open && box._active >= 0 && opts[box._active]) {
        e.preventDefault();
        opts[box._active].click();
      } else if (onEnterFree) {
        e.preventDefault();
        onEnterFree();
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      hideSuggestions(box, input);
    }
  });
}

/**
 * Pastilles amovibles (déchets constatés).
 * `fresh` : libellé qui vient d'être ajouté (animé à l'entrée).
 */
export function renderChips(container, items, onRemove, emptyMessage, fresh) {
  container.innerHTML = items.length
    ? items
        .map(
          (w, i) =>
            `<button type="button" class="chip${w === fresh ? " is-new" : ""}" data-i="${i}" aria-label="${esc(w)} — retirer">${esc(w)}<span class="x" aria-hidden="true">${icon("x")}</span></button>`,
        )
        .join("")
    : `<p class="none">${esc(emptyMessage)}</p>`;
  container.querySelectorAll(".chip").forEach((btn, i) => {
    btn.onclick = () => {
      btn.classList.add("removing");
      setTimeout(() => onRemove(i), 120);
    };
  });
}

/**
 * Ticket de bon de passage.
 * @param {object} bp
 * @param {object} o  { num, address, actions:boolean, preview:boolean, editing:boolean }
 */
export function ticketHtml(bp, o) {
  const wastes = (bp.wastes || []).map((w) => `<span>${esc(w)}</span>`).join("");
  const precs = (bp.precisions || []).join(", ");
  const actions = o.actions
    ? `<div class="ticketActions">
        <button class="linkBtn" type="button" data-action="edit" data-i="${o.index}">${icon("pencil")}Modifier</button>
        <button class="linkBtn" type="button" data-action="duplicate" data-i="${o.index}">${icon("copy")}Dupliquer</button>
        <button class="linkBtn linkBtn--danger" type="button" data-action="delete" data-i="${o.index}" aria-label="Supprimer le bon n°${o.num}">${icon("trash")}</button>
      </div>`
    : "";
  const cls = ["ticket", o.preview ? "is-preview" : "", o.editing ? "is-editing" : ""].join(" ").trim();
  return `<article class="${cls}" style="${secStyle(bp.secteur)}" aria-label="Bon de passage n°${o.num}">
    <div class="ticketStub"><small>BP</small><b>${o.num}</b></div>
    <div class="ticketBody">
      <div class="ticketAddr">${esc(o.address)}</div>
      <div class="ticketMeta"><span class="sectorChip">${esc(bp.secteur || "Secteur ?")}</span>${o.quartier ? `<span>${esc(o.quartier)}</span>` : ""}${precs ? `<span>${esc(precs)}</span>` : ""}</div>
      ${wastes ? `<div class="ticketWaste">${wastes}</div>` : ""}
      ${actions}
    </div>
  </article>`;
}

/** Délègue les actions d'un ticket vers les gestionnaires. */
export function bindTicketActions(container, handlers) {
  container.querySelectorAll("[data-action]").forEach((btn) => {
    const i = +btn.dataset.i;
    btn.onclick = () => handlers[btn.dataset.action]?.(i);
  });
}
