// Icônes SVG (jeu Lucide, licence ISC) référencées depuis le sprite inline
// de index.html. `icon(name)` renvoie le balisage <svg><use></use></svg>.
export function icon(name) {
  return `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}
