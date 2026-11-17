// Composants réutilisables : combobox (suggestions + clavier), pastilles,
// carte de bon de passage (ticket) avec consultation détaillée.

import { esc, bpWhen } from "./utils.js";
import { icon } from "./icons.js";
import { secStyle, TITRE } from "./sectors.js";
import { mailLine } from "./bp.js";

/**
 * Affiche une liste de suggestions accessibles.
 * @param {HTMLElement} box   conteneur role=listbox
 * @param {Array<{html:string,onClick:Function}>} entries
 * @param {string} emptyMessage
 */
export function showSuggestions(box, entries, emptyMessage) {
  box._entries = entries;
  box._active = -1;
  // Le champ associé n'est « ouvert » que s'il y a des options à parcourir ;
  // le message « aucun résultat » est annoncé par le lecteur d'écran.
  const input = box.id ? document.querySelector(`[aria-controls="${box.id}"]`) : null;
  input?.setAttribute("aria-expanded", String(entries.length > 0));
  if (!entries.length) {
    box.innerHTML = emptyMessage ? `<div class="none" role="status">${esc(emptyMessage)}</div>` : "";
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
      const hadFocus = document.activeElement === btn;
      btn.classList.add("removing");
      setTimeout(() => {
        onRemove(i);
        // Clavier / lecteur d'écran : le focus passe à la pastille suivante
        // (ou au champ de saisie) au lieu de retomber en haut de la page.
        if (!hadFocus) return;
        const left = container.querySelectorAll(".chip");
        const next = left[Math.min(i, left.length - 1)] || document.getElementById(container.dataset.focusAfter || "");
        next?.focus({ preventScroll: true });
      }, 120);
    };
  });
}

/** « CENTRE » → « Centre » (libellé court d'un secteur). */
export function sectorName(s) {
  return s ? s.charAt(0) + s.slice(1).toLowerCase() : "Secteur ?";
}

/** Date et heure complètes d'un horodatage ISO (« mardi 17 novembre 2026 à 14:32 »), "" si invalide. */
export function fullStamp(iso) {
  const t = Date.parse(iso || "");
  if (!t) return "";
  const d = new Date(t);
  const day = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${day} à ${hm}`;
}

/**
 * Ticket de bon de passage.
 * Le numéro affiché est l'ordre de saisie (index + 1) : c'est celui du rapport.
 * @param {object} bp
 * @param {object} o  { num, index, address, quartier, actions:boolean, preview:boolean,
 *                      editing:boolean, open:boolean (consultation détaillée dépliée),
 *                      level: niveau de titre de l'adresse (3 par défaut) }
 */
export function ticketHtml(bp, o) {
  const id = o.actions ? `bp-${o.index}` : "";
  const lvl = [2, 3, 4, 5].includes(o.level) ? o.level : 3; // niveau de titre de l'adresse
  const wastes = (bp.wastes || []).map((w) => `<li>${esc(w)}</li>`).join("");
  const precs = (bp.precisions || []).join(", ");
  const when = bpWhen(bp);
  const open = !!(o.actions && o.open);
  const created = fullStamp(bp.createdAt);
  const updated = fullStamp(bp.updatedAt);
  const details = o.actions
    ? `<div class="ticketDetails" id="${id}-details"${open ? "" : " hidden"}>
        <dl>
          <div class="ticketDetails__line"><dt>Ligne du rapport</dt><dd class="mono">• ${esc(mailLine(bp))}</dd></div>
          <div><dt>Secteur</dt><dd>${esc(TITRE[bp.secteur] || "Secteur non renseigné")}</dd></div>
          <div><dt>Quartier</dt><dd>${esc(o.quartier || "Non déterminé")}</dd></div>
          <div><dt>Emplacement précis</dt><dd>${esc(precs || "Aucune précision")}</dd></div>
          <div><dt>Enregistré le</dt><dd>${created ? esc(created) : "Heure non enregistrée"}</dd></div>
          ${updated ? `<div><dt>Modifié le</dt><dd>${esc(updated)}</dd></div>` : ""}
        </dl>
      </div>`
    : "";
  const actions = o.actions
    ? `<div class="ticketActions">
        <button class="tAct tAct--details" type="button" data-action="details" data-i="${o.index}" aria-expanded="${open}" aria-controls="${id}-details">${icon("chevron")}<span>Détails</span></button>
        <button class="tAct" type="button" data-action="edit" data-i="${o.index}" aria-label="Modifier le bon n°${o.num}">${icon("pencil")}<span>Modifier</span></button>
        <button class="tAct" type="button" data-action="duplicate" data-i="${o.index}" aria-label="Dupliquer le bon n°${o.num}">${icon("copy")}<span>Dupliquer</span></button>
        <button class="tAct tAct--danger" type="button" data-action="delete" data-i="${o.index}" aria-label="Supprimer le bon n°${o.num}">${icon("trash")}<span>Supprimer</span></button>
      </div>`
    : "";
  const cls = ["ticket", o.preview ? "is-preview" : "", o.editing ? "is-editing" : "", open ? "is-open" : ""].join(" ").replace(/\s+/g, " ").trim();
  const attrs = o.actions ? ` id="${id}" tabindex="-1" data-i="${o.index}" data-id="${esc(bp.id || "")}" aria-labelledby="${id}-title"` : ` aria-label="Bon de passage n°${o.num}"`;
  return `<article class="${cls}"${attrs} style="${secStyle(bp.secteur)}">
    <div class="ticketHead">
      <div class="ticketStub" aria-hidden="true"><small>BP</small><b>${o.num}</b></div>
      <h${lvl} class="ticketAddr"${id ? ` id="${id}-title"` : ""}><span class="visually-hidden">Bon n°${o.num} : </span>${esc(o.address)}</h${lvl}>
      ${o.editing ? `<span class="ticketBadge">En cours de modification</span>` : ""}
    </div>
    <div class="ticketBody">
      <div class="ticketMeta"><span class="sectorChip">${esc(sectorName(bp.secteur))}</span>${o.quartier ? `<span class="ticketQuartier">${esc(o.quartier)}</span>` : ""}</div>
      ${precs ? `<p class="ticketPrec">${icon("map-pin")}<span><span class="visually-hidden">Emplacement précis : </span>${esc(precs)}</span></p>` : ""}
      ${wastes ? `<ul class="ticketWaste" aria-label="Déchets constatés">${wastes}</ul>` : ""}
      <p class="ticketTime${when ? "" : " is-unknown"}">${icon("calendar")}<span>${when ? `<span class="visually-hidden">Relevé : </span>${esc(when)}` : "Heure non enregistrée"}</span></p>
      ${details}
    </div>
    ${actions}
  </article>`;
}

/**
 * Délègue les actions d'un ticket vers les gestionnaires
 * ({ edit, duplicate, delete, details } : chacun reçoit l'index du bon).
 * `toggle` : un appui sur la carte elle-même (hors bouton, hors sélection de
 * texte) déplie ou replie la consultation détaillée.
 */
export function bindTicketActions(container, handlers) {
  container.querySelectorAll("[data-action]").forEach((btn) => {
    const i = +btn.dataset.i;
    btn.onclick = (e) => {
      e.stopPropagation();
      handlers[btn.dataset.action]?.(i, btn);
    };
  });
  if (!handlers.details) return;
  container.querySelectorAll(".ticket[data-i]").forEach((t) => {
    t.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, select, textarea, .ticketDetails")) return;
      if (String(window.getSelection?.() || "").length) return; // l'agent sélectionne du texte
      handlers.details(+t.dataset.i, t.querySelector('[data-action="details"]'));
    });
  });
}
