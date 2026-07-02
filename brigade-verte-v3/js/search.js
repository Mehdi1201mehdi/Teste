// Moteur de recherche générique (utilisé par la recherche de rue et de déchets) :
// filtre "contient", puis fait remonter les résultats qui commencent par la saisie.

import { norm } from "./utils.js";

/**
 * @param {Array<T>} items
 * @param {string} query
 * @param {(item:T) => string} keyFn texte à comparer pour chaque item
 * @param {number} limit
 * @returns {Array<T>}
 */
export function fuzzySearch(items, query, keyFn, limit = 12) {
  const nq = norm(query);
  if (!nq) return [];
  const matches = items
    .map((item) => [item, norm(keyFn(item))])
    .filter(([, key]) => key.includes(nq));
  const starts = matches.filter(([, key]) => key.startsWith(nq));
  const rest = matches.filter(([, key]) => !key.startsWith(nq));
  return [...starts, ...rest].slice(0, limit).map(([item]) => item);
}
