/* ============ Price Radar — SPA vanilla JS ============ */
const view = document.getElementById('view');
let chart = null;

/* ---------------- utilitaires ---------------- */
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Erreur ' + res.status);
  return data;
}
const eur = (v) => v == null ? '—' : Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const pct = (v) => v == null ? '—' : Number(v).toFixed(1).replace('.', ',') + ' %';
const dt = (iso) => iso ? new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 3800);
}

const levelBadge = (level) => `<span class="badge ${esc(level)}">${esc(level)}</span>`;
const riskBadge = (risk) => {
  const labels = { faible: 'risque faible', moyen: 'risque moyen', eleve: 'risque élevé' };
  return `<span class="badge risk-${esc(risk)}">${labels[risk] || risk}</span>`;
};
const stockBadge = (a) => {
  if (a === 'in_stock') return '<span class="badge stock-in">en stock</span>';
  if (a === 'out_of_stock') return '<span class="badge stock-out">rupture</span>';
  return '<span class="badge stock-unknown">inconnu</span>';
};
const scoreCell = (s) => `<span class="score-bar"><i style="width:${s}%"></i></span>${s}`;

function productCell(p) {
  const img = p.image_url ? `<img src="${esc(p.image_url)}" loading="lazy" onerror="this.style.visibility='hidden'">` : '<img style="visibility:hidden">';
  return `<div class="product-cell">${img}
    <div><a class="name" href="#/produit/${p.id}">${esc(p.name || p.url)}</a>
    <div class="site">${esc(p.website || '')} ${p.seller ? '· ' + esc(p.seller) : ''}</div></div></div>`;
}

function opportunityRow(c) {
  const p = c.product || {};
  return `<tr>
    <td>${productCell(p)}</td>
    <td><b>${eur(c.price)}</b>${c.old_price ? `<div class="price-strike">${eur(c.old_price)}</div>` : ''}</td>
    <td>${eur(c.market_price)}</td>
    <td class="gap-positive">${c.gap_eur > 0 ? '−' + eur(c.gap_eur) : eur(c.gap_eur)}</td>
    <td class="gap-positive">${pct(c.gap_percent)}</td>
    <td><b>${eur(c.margin_eur)}</b></td>
    <td>${scoreCell(c.score)}</td>
    <td>${levelBadge(c.opportunity_level)}</td>
    <td>${riskBadge(c.risk_level)}</td>
    <td>${stockBadge(c.availability)}</td>
    <td class="muted">${dt(c.created_at)}</td>
  </tr>`;
}

const OPP_HEADERS = `<tr>
  <th>Produit</th><th data-sort="price" class="sortable">Prix trouvé ↕</th><th>Prix marché</th>
  <th>Différence</th><th data-sort="gap" class="sortable">Écart % ↕</th>
  <th data-sort="margin" class="sortable">Marge est. ↕</th><th data-sort="score" class="sortable">Score ↕</th>
  <th>Niveau</th><th>Risque</th><th>Stock</th><th data-sort="date" class="sortable">Détecté ↕</th></tr>`;

/* ---------------- pages ---------------- */
async function pageDashboard() {
  const d = await api('/dashboard');
  const s = d.stats;
  view.innerHTML = `
    <h1>Tableau de bord</h1>
    <p class="subtitle">Meilleures opportunités détectées ces 7 derniers jours</p>
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Produits surveillés</div><div class="value">${s.products_watched}</div></div>
      <div class="stat-card"><div class="label">Relevés (7 j)</div><div class="value">${s.checks_7d}</div></div>
      <div class="stat-card"><div class="label">Opportunités (7 j)</div><div class="value" style="color:var(--orange)">${s.opportunities_7d}</div></div>
      <div class="stat-card"><div class="label">Meilleure marge (7 j)</div><div class="value" style="color:var(--green)">${eur(s.best_margin_7d)}</div></div>
      <div class="stat-card"><div class="label">Alertes non lues</div><div class="value" style="color:var(--red)">${s.alerts_unread}</div></div>
    </div>
    <div class="card">
      <div class="card-header">🔥 Top opportunités <a href="#/opportunites" style="margin-left:auto;font-size:13px">Tout voir →</a></div>
      <div class="table-wrap"><table><thead>${OPP_HEADERS}</thead>
      <tbody>${d.top_opportunities.map(opportunityRow).join('') || '<tr><td colspan="11" class="empty">Aucune opportunité détectée. Lancez <code>python seed.py</code> pour des données de test.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

async function pageOpportunities() {
  const [cats, sites] = await Promise.all([api('/categories'), api('/websites')]);
  view.innerHTML = `
    <h1>Opportunités</h1>
    <p class="subtitle">Toutes les erreurs de prix et promos anormales détectées</p>
    <div class="filters">
      <div class="field"><label>Catégorie</label><select id="f-cat"><option value="">Toutes</option>${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Site</label><select id="f-site"><option value="">Tous</option>${sites.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Niveau</label><select id="f-level"><option value="">Tous</option><option>moyen</option><option>fort</option><option>exceptionnel</option></select></div>
      <div class="field"><label>Marge min (€)</label><input id="f-margin" type="number" style="width:110px" placeholder="0"></div>
      <div class="field"><label>Écart min (%)</label><input id="f-gap" type="number" style="width:110px" placeholder="0"></div>
      <div class="field"><label>Prix min</label><input id="f-pmin" type="number" style="width:100px"></div>
      <div class="field"><label>Prix max</label><input id="f-pmax" type="number" style="width:100px"></div>
      <div class="field"><label>Stock</label><select id="f-stock"><option value="">Tous</option><option value="in_stock">En stock</option><option value="out_of_stock">Rupture</option></select></div>
      <div class="field"><label>Période</label><select id="f-days"><option value="7">7 jours</option><option value="30" selected>30 jours</option><option value="90">90 jours</option></select></div>
      <button class="btn" id="f-apply">Filtrer</button>
    </div>
    <div class="card">
      <div class="card-header"><span id="opp-count"></span></div>
      <div class="table-wrap"><table><thead>${OPP_HEADERS}</thead><tbody id="opp-body"></tbody></table></div>
    </div>`;

  let sort = 'score', order = 'desc';
  async function load() {
    const params = new URLSearchParams({ sort, order, since_days: document.getElementById('f-days').value });
    const map = { category_id: 'f-cat', website_id: 'f-site', level: 'f-level', min_margin: 'f-margin', min_gap_percent: 'f-gap', min_price: 'f-pmin', max_price: 'f-pmax', availability: 'f-stock' };
    for (const [key, id] of Object.entries(map)) {
      const value = document.getElementById(id).value;
      if (value) params.set(key, value);
    }
    const search = document.getElementById('global-search').value.trim();
    if (search) params.set('search', search);
    const d = await api('/opportunities?' + params);
    document.getElementById('opp-count').textContent = `${d.total} opportunité(s)`;
    document.getElementById('opp-body').innerHTML =
      d.items.map(opportunityRow).join('') || '<tr><td colspan="11" class="empty">Aucun résultat avec ces filtres</td></tr>';
  }
  document.getElementById('f-apply').onclick = load;
  view.querySelectorAll('th.sortable').forEach((th) => th.onclick = () => {
    const s = th.dataset.sort;
    order = (sort === s && order === 'desc') ? 'asc' : 'desc';
    sort = s;
    load();
  });
  await load();
}

const FREE_BADGE = {
  'free': 'stock-in', 'open-data': 'risk-faible',
  'open-source': 'moyen', 'free-tier': 'risk-moyen',
};
const FREE_LABEL = {
  'free': 'Gratuit', 'open-data': 'Open data',
  'open-source': 'Open source', 'free-tier': 'Free tier',
};

async function pageVeillePrix() {
  view.innerHTML = `
    <h1>Veille prix</h1>
    <p class="subtitle">Tape un mot-clé → les produits avec la plus forte baisse, classés. Pour aligner tes prix.</p>
    <div class="card">
      <div class="card-header">📉 Chercher les baisses</div>
      <div class="form-grid">
        <div class="field full"><label>Mot-clé</label>
          <input id="vp-q" placeholder="ex : PC gaming, TV, perceuse…"></div>
        <div class="field"><label>Résultats max / source</label>
          <select id="vp-limit"><option>5</option><option selected>10</option><option>15</option></select></div>
      </div>
      <div style="padding:0 18px 8px;display:flex;gap:8px;flex-wrap:wrap">
        <span class="muted" style="align-self:center">Préréglages :</span>
        ${['PC gaming', 'TV', 'outil bricolage', 'aspirateur', 'casque'].map((p) =>
          `<button class="btn small secondary vp-preset" data-q="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>
      <div class="form-actions"><button class="btn" id="vp-go">Chercher les baisses</button>
        <span class="muted" id="vp-hint" style="align-self:center"></span></div>
    </div>
    <div id="vp-results"></div>`;

  const run = async (query) => {
    document.getElementById('vp-q').value = query;
    const btn = document.getElementById('vp-go');
    btn.disabled = true; btn.textContent = '⏳ Recherche des baisses…';
    document.getElementById('vp-hint').textContent = 'API + sites accessibles… peut prendre 20-40 s.';
    try {
      const limit = document.getElementById('vp-limit').value;
      const r = await api(`/pricewatch/keyword?q=${encodeURIComponent(query)}&limit=${limit}`);
      renderVeille(r, query);
    } catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.textContent = 'Chercher les baisses';
    document.getElementById('vp-hint').textContent = '';
  };
  document.getElementById('vp-go').onclick = () => {
    const q = document.getElementById('vp-q').value.trim();
    if (!q) return toast('Entre un mot-clé', true);
    run(q);
  };
  document.getElementById('vp-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('vp-go').click();
  });
  view.querySelectorAll('.vp-preset').forEach((b) => b.onclick = () => run(b.dataset.q));
}

function renderVeille(r, query) {
  const lvlBadge = (l) => l ? `<span class="badge ${l === 'baisse-urgente' ? 'exceptionnel' : l === 'baisse-forte' ? 'fort' : 'moyen'}">${esc(l)}</span>` : '';
  const per = (r.per_source || []).map((p) => {
    const cls = p.status === 'ok' ? 'risk-faible' : p.status === 'non_configuré' ? 'stock-unknown' : 'risk-eleve';
    const label = p.status === 'non_disponible' ? 'non disponible' : p.status;
    return `<span class="badge ${cls}" style="margin-right:6px">${esc(p.source)} : ${esc(label)}${p.found ? ' (' + p.found + ')' : ''}</span>`;
  }).join('');
  const rows = (r.deals || []).map((d) => `<tr>
    <td><div class="product-cell">${d.image ? `<img src="${esc(d.image)}" loading="lazy" onerror="this.style.visibility='hidden'">` : '<img style="visibility:hidden">'}
      <div><a class="name" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a>
      <div class="site">${esc(d.source)}</div></div></div></td>
    <td>${eur(d.old_price)}</td>
    <td><b>${eur(d.price)}</b></td>
    <td class="gap-positive">−${eur(d.discount_amount)}</td>
    <td class="gap-positive"><b>−${pct(d.discount_percent)}</b></td>
    <td>${scoreCell(d.score)}</td>
    <td>${lvlBadge(d.level)}</td>
    <td>${stockBadge(d.availability)}</td>
    <td class="muted" style="white-space:normal;max-width:220px">${esc(d.advice)}</td>
  </tr>`).join('');
  document.getElementById('vp-results').innerHTML = `
    <div class="card">
      <div class="card-header">${r.count} baisse(s) pour « ${esc(r.query)} »
        <span style="margin-left:auto">Export :
          <a href="/api/pricewatch/export?q=${encodeURIComponent(query)}&format=csv" target="_blank">CSV</a> ·
          <a href="/api/pricewatch/export?q=${encodeURIComponent(query)}&format=xlsx" target="_blank">Excel</a> ·
          <a href="/api/pricewatch/export?q=${encodeURIComponent(query)}&format=json" target="_blank">JSON</a></span>
      </div>
      <div class="preview-box">${per || '<span class="muted">Aucune source</span>'}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Produit</th><th>Ancien prix</th><th>Prix actuel</th><th>Baisse €</th><th>Baisse %</th><th>Score</th><th>Niveau</th><th>Stock</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="9" class="empty">Aucune baisse trouvée. Les sources sans prix barré (ou bloquées) n'apparaissent pas. Configure une clé eBay (page Comparateur) ou ajoute des sites accessibles.</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

async function pageSources() {
  const [cats, sources, auto] = await Promise.all([
    api('/datasources/categories'), api('/datasources'), api('/datasources/autocollect'),
  ]);
  window._dsCats = cats;
  view.innerHTML = `
    <h1>Sources API gratuites</h1>
    <p class="subtitle">${sources.length} sources — API officielles, open data, free tier et frameworks. Priorité aux API, jamais de contournement anti-bot.</p>
    <div class="card"><div class="preview-box" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span>🤖 Auto-collecte : ${auto.enabled
        ? `<span class="badge risk-faible">active · toutes les ${auto.minutes} min</span>`
        : `<span class="badge stock-unknown">désactivée</span> <span class="muted">(active-la avec DATASOURCE_AUTO_COLLECT=true dans .env)</span>`}</span>
      <button class="btn small" id="ds-collect-all" style="margin-left:auto">▶ Tout collecter maintenant</button>
    </div></div>
    <div class="filters">
      <div class="field"><label>Catégorie</label><select id="ds-cat"><option value="">Toutes</option>
        ${Object.entries(cats).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label>Recherche</label><input id="ds-search" placeholder="nom, id…"></div>
      <button class="btn" id="ds-filter">Filtrer</button>
    </div>
    <div id="ds-list"></div>
    <div class="card">
      <div class="card-header">🧾 Logs & historique
        <button class="btn small secondary" id="ds-logs-refresh" style="margin-left:auto">Rafraîchir</button></div>
      <div class="table-wrap" id="ds-logs"></div>
    </div>`;

  document.getElementById('ds-filter').onclick = loadSourcesList;
  document.getElementById('ds-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSourcesList(); });
  document.getElementById('ds-logs-refresh').onclick = loadDsLogs;
  document.getElementById('ds-collect-all').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = '⏳ Collecte de toutes les sources prêtes…';
    try {
      const r = await api('/datasources/collect-all', { method: 'POST' });
      toast(`Auto-collecte : ${r.collected} source(s) collectée(s), ${r.skipped} ignorée(s)`);
      loadDsLogs();
    } catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = '▶ Tout collecter maintenant';
  };
  await loadSourcesList();
  await loadDsLogs();
}

async function loadSourcesList() {
  const cat = document.getElementById('ds-cat').value;
  const search = document.getElementById('ds-search').value.trim();
  const params = new URLSearchParams();
  if (cat) params.set('category', cat);
  if (search) params.set('search', search);
  const sources = await api('/datasources?' + params);
  const rows = sources.map((s) => {
    const statut = s.kind !== 'api'
      ? `<span class="badge stock-unknown">${s.kind === 'framework' ? 'framework' : 'liste'}</span>`
      : s.configured ? '<span class="badge risk-faible">prêt ✔</span>'
      : `<span class="badge stock-unknown">clé requise</span>`;
    const keyField = (s.authType !== 'none' && s.kind === 'api' && !s.configured)
      ? `<div style="display:flex;gap:4px;margin-top:4px"><input class="ds-key" data-env="${esc(s.envKey)}" placeholder="${esc(s.envKey)}" style="width:150px;padding:5px 8px;font-size:12px">
         <button class="btn small secondary" data-savekey="${esc(s.envKey)}">💾</button></div>` : '';
    return `<tr data-id="${esc(s.id)}">
      <td><div><b>${esc(s.name)}</b> ${s.enabled ? '' : '<span class="badge stock-out">off</span>'}
        <div class="site"><a href="${esc(s.docs)}" target="_blank" rel="noopener" class="muted">docs ↗</a> · ${esc(s.rateLimit || '')}</div>${keyField}</div></td>
      <td class="muted">${esc(window._dsCats[s.category] || s.category)}</td>
      <td><span class="badge ${FREE_BADGE[s.freeType] || 'stock-unknown'}">${FREE_LABEL[s.freeType] || s.freeType}</span></td>
      <td class="muted">${esc(s.authType)}</td>
      <td>${statut}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn small secondary" data-test="${esc(s.id)}">Tester</button>
        ${s.kind === 'api' ? `<button class="btn small" data-collect="${esc(s.id)}">Collecter</button>` : ''}
        <button class="btn small secondary" data-toggle="${esc(s.id)}">${s.enabled ? 'Désactiver' : 'Activer'}</button>
      </div>
      <div class="ds-result" data-result="${esc(s.id)}"></div></td>
    </tr>`;
  }).join('');
  document.getElementById('ds-list').innerHTML = `
    <div class="card"><div class="card-header">${sources.length} source(s)</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Source</th><th>Catégorie</th><th>Type</th><th>Auth</th><th>Statut</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty">Aucune source</td></tr>'}</tbody>
    </table></div></div>`;

  const box = (id) => document.querySelector(`[data-result="${CSS.escape(id)}"]`);
  view.querySelectorAll('[data-test]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.test; b.disabled = true; b.textContent = '…';
    try {
      const r = await api(`/datasources/${id}/test`, { method: 'POST' });
      const cls = r.status === 'ok' ? 'risk-faible' : r.status === 'info' ? 'stock-unknown' : 'risk-eleve';
      box(id).innerHTML = `<span class="badge ${cls}" style="margin-top:6px">${esc(r.status)}${r.ms != null ? ' · ' + r.ms + ' ms' : ''}</span>
        <span class="muted"> ${esc(r.message || '')}${r.alternative ? ' → ' + esc(r.alternative) : ''}</span>`;
    } catch (err) { toast(err.message, true); }
    b.disabled = false; b.textContent = 'Tester'; loadDsLogs();
  });
  view.querySelectorAll('[data-collect]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.collect; b.disabled = true; b.textContent = '…';
    try {
      const r = await api(`/datasources/${id}/collect`, { method: 'POST', body: JSON.stringify({}) });
      if (r.ok) {
        box(id).innerHTML = `<span class="badge risk-faible" style="margin-top:6px">${r.count} résultat(s)</span>
          <span style="margin-left:6px">Export :
          <a href="/api/datasources/${id}/export?format=json" target="_blank">JSON</a> ·
          <a href="/api/datasources/${id}/export?format=csv" target="_blank">CSV</a> ·
          <a href="/api/datasources/${id}/export?format=xlsx" target="_blank">Excel</a></span>
          <pre style="max-height:120px;overflow:auto;margin-top:6px">${esc(JSON.stringify(r.records.slice(0, 3), null, 1))}</pre>`;
      } else {
        box(id).innerHTML = `<span class="badge risk-eleve" style="margin-top:6px">${esc(r.status)}</span> <span class="muted">${esc(r.message || '')}${r.alternative ? ' → ' + esc(r.alternative) : ''}</span>`;
      }
    } catch (err) { toast(err.message, true); }
    b.disabled = false; b.textContent = 'Collecter'; loadDsLogs();
  });
  view.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
    await api(`/datasources/${b.dataset.toggle}/toggle`, { method: 'PUT' });
    loadSourcesList();
  });
  view.querySelectorAll('[data-savekey]').forEach((b) => b.onclick = async () => {
    const env = b.dataset.savekey;
    const input = view.querySelector(`.ds-key[data-env="${CSS.escape(env)}"]`);
    if (!input.value.trim()) return toast('Entre une clé', true);
    try {
      await api('/datasources/keys', { method: 'POST', body: JSON.stringify({ env_key: env, value: input.value.trim() }) });
      toast('Clé enregistrée (jamais réaffichée) ✔'); loadSourcesList();
    } catch (err) { toast(err.message, true); }
  });
}

async function loadDsLogs() {
  const logs = await api('/datasources/logs?limit=40');
  const badge = (s) => ({ ok: 'risk-faible', error: 'risk-eleve', unconfigured: 'stock-unknown', info: 'stock-unknown' }[s] || 'stock-unknown');
  document.getElementById('ds-logs').innerHTML = `<table>
    <thead><tr><th>Date</th><th>Source</th><th>Action</th><th>Statut</th><th>HTTP</th><th>Durée</th><th>Message</th></tr></thead>
    <tbody>${logs.map((l) => `<tr>
      <td class="muted">${dt(l.created_at)}</td><td>${esc(l.source_id)}</td>
      <td class="muted">${esc(l.action)}</td><td><span class="badge ${badge(l.status)}">${esc(l.status)}</span></td>
      <td class="muted">${l.http ?? ''}</td><td class="muted">${l.duration_ms != null ? l.duration_ms + ' ms' : ''}</td>
      <td class="muted" style="white-space:normal;max-width:340px">${esc(l.message || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aucun log</td></tr>'}</tbody></table>`;
}

async function pageComparateur() {
  const conns = await api('/api-connectors');
  const price = conns.filter((c) => c.kind === 'price');
  const catalog = conns.filter((c) => c.kind === 'catalog');
  const geo = conns.filter((c) => c.kind === 'geo');
  const statusBadge = (c) => c.configured
    ? '<span class="badge risk-faible">configuré ✔</span>'
    : `<span class="badge stock-unknown" title="Variables .env : ${esc(c.required_env.join(', ') || 'aucune')}">${c.required_env.length ? 'clé requise' : 'sans clé'}</span>`;
  const connLine = (c) => `<tr><td>${esc(c.label)}</td><td><span class="badge stock-unknown">${esc(c.kind)}</span></td>
    <td>${statusBadge(c)}</td><td><a href="${esc(c.docs)}" target="_blank" rel="noopener" class="muted">docs ↗</a></td></tr>`;

  view.innerHTML = `
    <h1>Comparateur (API officielles)</h1>
    <p class="subtitle">Compare les offres issues des API officielles et bases publiques — sans scraping</p>

    <div class="card">
      <div class="card-header">⚖️ Comparer par mot-clé (sources de prix)</div>
      <div class="form-grid">
        <div class="field full"><label>Produit à comparer</label>
          <input id="cmp-q" placeholder="ex : PS5, iPhone 15, casque Sony…"></div>
        <div class="field"><label>Résultats max / source</label>
          <select id="cmp-limit"><option>5</option><option selected>8</option><option>12</option></select></div>
      </div>
      <div class="form-actions"><button class="btn" id="btn-compare">Comparer les prix</button>
        <span class="muted" id="cmp-hint" style="align-self:center"></span></div>
      <div id="cmp-results"></div>
    </div>

    <div class="card">
      <div class="card-header">🔖 Rechercher par code-barres (EAN / UPC)</div>
      <div class="form-grid">
        <div class="field full"><label>Code-barres</label>
          <input id="bc-ean" placeholder="ex : 3017620422003 (Nutella)"></div>
      </div>
      <div class="form-actions"><button class="btn secondary" id="btn-barcode">Rechercher</button></div>
      <div id="bc-results"></div>
    </div>

    <div class="card">
      <div class="card-header">🔌 Connecteurs d'API (${conns.length})</div>
      <div class="preview-box muted" style="padding-bottom:0">Sources de <b>prix</b> — ${price.length} · bases <b>catalogue</b> — ${catalog.length} · <b>géo</b> — ${geo.length}. Renseigne les clés dans <code>.env</code> pour activer les sources fermées.</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Source</th><th>Type</th><th>Statut</th><th>Doc</th></tr></thead>
        <tbody>${conns.map(connLine).join('')}</tbody>
      </table></div>
    </div>`;

  document.getElementById('btn-compare').onclick = async (e) => {
    const q = document.getElementById('cmp-q').value.trim();
    if (!q) return toast('Entre un mot-clé', true);
    e.target.disabled = true; e.target.textContent = '⏳ Comparaison…';
    document.getElementById('cmp-hint').textContent = 'Interrogation des API configurées…';
    try {
      const r = await api(`/compare?q=${encodeURIComponent(q)}&limit=${document.getElementById('cmp-limit').value}`);
      renderComparison(r);
    } catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = 'Comparer les prix';
    document.getElementById('cmp-hint').textContent = '';
  };
  document.getElementById('btn-barcode').onclick = async (e) => {
    const ean = document.getElementById('bc-ean').value.trim();
    if (!/^\d+$/.test(ean)) return toast('Code-barres invalide (chiffres uniquement)', true);
    e.target.disabled = true; e.target.textContent = '⏳…';
    try { renderBarcode(await api(`/barcode/${ean}`)); }
    catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = 'Rechercher';
  };
}

function offerRows(offers) {
  return offers.map((o) => `<tr>
    <td>${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title || '(sans titre)')}</a>` : esc(o.title || '(sans titre)')}</td>
    <td><b>${o.price != null ? eur(o.price) + (o.currency && o.currency !== 'EUR' ? ' ' + esc(o.currency) : '') : '—'}</b></td>
    <td>${esc(o.seller || '')}</td>
    <td class="muted">${esc(o.source)}</td>
    <td>${o.condition ? esc(o.condition) : ''}</td>
  </tr>`).join('');
}

function renderComparison(r) {
  const s = r.stats || {};
  const per = (r.per_source || []).map((p) => {
    const cls = p.status === 'ok' ? 'risk-faible' : p.status === 'non_configuré' ? 'stock-unknown' : 'risk-eleve';
    return `<span class="badge ${cls}" style="margin-right:6px">${esc(p.label)} : ${p.found}</span>`;
  }).join('');
  const statsHtml = s.count_priced ? `
    <div class="hist-stats" style="padding:14px 18px">
      <div>Prix mini<b style="color:var(--green)">${eur(s.min_price)}</b></div>
      <div>Prix maxi<b style="color:var(--red)">${eur(s.max_price)}</b></div>
      <div>Prix moyen<b>${eur(s.avg_price)}</b></div>
      <div>Économie potentielle<b style="color:var(--green)">${eur(s.potential_saving)}</b></div>
      <div>Écart<b>${pct(s.spread_percent)}</b></div>
    </div>` : '';
  document.getElementById('cmp-results').innerHTML = `
    <div style="border-top:1px solid var(--border);margin-top:6px">
      <div class="preview-box">${per || '<span class="muted">Aucune source de prix configurée — renseigne une clé (eBay, Amazon…) dans .env</span>'}</div>
      ${statsHtml}
      <div class="table-wrap"><table>
        <thead><tr><th>Offre</th><th>Prix</th><th>Vendeur</th><th>Source</th><th>État</th></tr></thead>
        <tbody>${offerRows(r.offers || []) || '<tr><td colspan="5" class="empty">Aucune offre. Configure au moins une API de prix.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

function renderBarcode(r) {
  const p = r.product || {};
  const cmp = r.comparison || { offers: [], stats: {} };
  document.getElementById('bc-results').innerHTML = `
    <div style="border-top:1px solid var(--border);margin-top:6px" class="detail-head">
      ${p.image ? `<img src="${esc(p.image)}" onerror="this.remove()">` : ''}
      <div class="info">
        <h2>${esc(p.name || '(produit inconnu)')}</h2>
        <p class="muted">Marque : ${esc(p.brand || '—')} · Catégorie : ${esc(p.category || '—')} · EAN ${esc(p.ean)}</p>
        <p class="muted">Sources : ${esc((p.sources || []).join(', ') || 'aucune base ne connaît ce code')}</p>
        ${p.description ? `<p>${esc(p.description)}</p>` : ''}
      </div>
    </div>
    ${(cmp.offers && cmp.offers.length) ? `<div class="table-wrap"><table>
      <thead><tr><th>Offre</th><th>Prix</th><th>Vendeur</th><th>Source</th><th>État</th></tr></thead>
      <tbody>${offerRows(cmp.offers)}</tbody></table></div>` : ''}`;
}

async function pageSearch() {
  const sites = await api('/websites');
  const searchable = sites.filter((s) => s.search_url_template);
  view.innerHTML = `
    <h1>Recherche multi-sites</h1>
    <p class="subtitle">Cherche un produit sur les sites que tu as configurés, compare les prix et détecte les écarts</p>
    ${searchable.length === 0 ? `<div class="card"><div class="preview-box">
      ⚠️ Aucun site n'a d'URL de recherche configurée. Va dans
      <a href="#/ajouter">Ajouter une surveillance</a> → section « Sites », et renseigne le champ
      <b>URL de recherche</b> (ex : <code>https://boutique.fr/recherche?q={query}</code>).
      </div></div>` : ''}
    <div class="card">
      <div class="card-header">🔎 Rechercher</div>
      <div class="form-grid">
        <div class="field full"><label>Mot-clé (produit à chercher)</label>
          <input id="q" placeholder="ex : PS5, iPhone 15, aspirateur Dyson…" ${searchable.length ? '' : 'disabled'}></div>
        <div class="field"><label>Résultats max par site</label>
          <select id="q-max"><option>3</option><option selected>5</option><option>8</option><option>10</option></select></div>
        <div class="field"><label style="display:flex;gap:8px;align-items:center;margin-top:22px">
          <input type="checkbox" id="q-add"> Ajouter automatiquement les résultats à la surveillance</label></div>
      </div>
      <div class="field" style="padding:0 18px 12px">
        <label>Sites à interroger</label>
        <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:6px">
          ${searchable.map((s) => `<label style="display:flex;gap:6px;align-items:center">
            <input type="checkbox" class="q-site" value="${s.id}" checked> ${esc(s.name)}</label>`).join('') || '<span class="muted">—</span>'}
        </div>
      </div>
      <div class="form-actions"><button class="btn" id="btn-search" ${searchable.length ? '' : 'disabled'}>Lancer la recherche</button>
        <span class="muted" id="q-hint" style="align-self:center"></span></div>
    </div>
    <div id="search-results"></div>`;

  document.getElementById('btn-search').onclick = async (e) => {
    const query = document.getElementById('q').value.trim();
    if (!query) return toast('Entre un mot-clé', true);
    const ids = [...document.querySelectorAll('.q-site:checked')].map((c) => Number(c.value));
    if (!ids.length) return toast('Sélectionne au moins un site', true);
    e.target.disabled = true; e.target.textContent = '⏳ Recherche en cours…';
    document.getElementById('q-hint').textContent = 'Cela peut prendre 20 s à 1 min selon le nombre de sites…';
    try {
      const r = await api('/search', { method: 'POST', body: JSON.stringify({
        query, website_ids: ids,
        max_per_site: Number(document.getElementById('q-max').value),
        add_to_monitoring: document.getElementById('q-add').checked,
      }) });
      renderSearchResults(r);
    } catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = 'Lancer la recherche';
    document.getElementById('q-hint').textContent = '';
  };
}

function renderSearchResults(r) {
  const rows = (r.results || []).map((i) => `<tr>
    <td>${i.image_url ? '' : ''}<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.name || i.url)}</a></td>
    <td><b>${eur(i.price)}</b>${i.old_price ? `<div class="price-strike">${eur(i.old_price)}</div>` : ''}</td>
    <td>${esc(i.site)}</td>
    <td>${stockBadge(i.availability)}</td>
    <td>${i.opportunity_level ? levelBadge(i.opportunity_level) : '<span class="muted">—</span>'}</td>
    <td>${i.gap_percent != null ? pct(i.gap_percent) : '—'}</td>
    <td>${i.monitored ? (i.product_id ? `<a href="#/produit/${i.product_id}">✅ suivi</a>` : '✅') : '<span class="muted">non</span>'}</td>
  </tr>`).join('');
  const perSite = (r.per_site || []).map((s) =>
    `<span class="badge ${s.status === 'success' ? 'risk-faible' : 'risk-eleve'}" style="margin-right:6px" title="${esc(s.status)}">${esc(s.site)} : ${s.found}</span>`).join('');
  document.getElementById('search-results').innerHTML = `
    <div class="card">
      <div class="card-header">Résultats pour « ${esc(r.query)} » — ${r.results.length} produit(s) sur ${r.sites_searched} site(s)</div>
      <div class="preview-box">${perSite}
        ${r.sites_without_template ? `<span class="muted"> · ${r.sites_without_template} site(s) sans URL de recherche (ignorés)</span>` : ''}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Produit</th><th>Prix</th><th>Site</th><th>Stock</th><th>Niveau</th><th>Écart %</th><th>Surveillé</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty">Aucun produit trouvé. Vérifie l\'URL de recherche des sites (le site bloque peut-être le scraping, ou charge ses résultats en JavaScript → coche « Site JS »).</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

async function pageAdd() {
  const [cats, sites] = await Promise.all([api('/categories'), api('/websites')]);
  view.innerHTML = `
    <h1>Ajouter une surveillance</h1>
    <p class="subtitle">Ajoutez une URL produit — le scraping récupère automatiquement nom, prix, image, stock…</p>
    <div class="card">
      <div class="card-header">🔍 Tester une URL (aperçu sans enregistrer)</div>
      <div class="form-grid">
        <div class="field full"><label>URL du produit</label><input id="add-url" placeholder="https://exemple.com/produit/…"></div>
      </div>
      <div class="form-actions">
        <button class="btn secondary" id="btn-preview">Tester l'extraction</button>
      </div>
      <div id="preview-result"></div>
    </div>
    <div class="card">
      <div class="card-header">➕ Surveiller ce produit</div>
      <div class="form-grid">
        <div class="field"><label>Nom (auto si vide)</label><input id="add-name"></div>
        <div class="field"><label>Catégorie</label><select id="add-cat"><option value="">—</option>${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Site (auto-détecté si vide)</label><select id="add-site"><option value="">—</option>${sites.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Prix moyen du marché (€) — vide = calcul auto</label><input id="add-market" type="number" step="0.01"></div>
        <div class="field"><label>Fréquence de vérification</label><select id="add-freq">
          <option value="60">Toutes les heures</option><option value="360" selected>Toutes les 6 h</option>
          <option value="720">Toutes les 12 h</option><option value="1440">1 fois par jour</option></select></div>
        <div class="field"><label>EAN / référence</label><input id="add-ean"></div>
      </div>
      <div class="form-actions"><button class="btn" id="btn-add">Ajouter et scraper maintenant</button></div>
    </div>
    <div class="card">
      <div class="card-header">🌐 Sites e-commerce suivis</div>
      <div class="table-wrap"><table><thead><tr><th>Nom</th><th>Domaine</th><th>Recherche</th><th>Fiable</th><th>Produits</th><th></th></tr></thead>
      <tbody>${sites.map(w => `<tr><td>${esc(w.name)}</td><td class="muted">${esc(w.domain)}</td>
        <td>${w.search_url_template ? '🔎 ✅' : '<span class="muted">—</span>'}</td>
        <td>${w.trusted ? '✅' : '—'}</td><td>${w.products}</td>
        <td><button class="btn danger small" data-del-site="${w.id}">Supprimer</button></td></tr>`).join('')}</tbody></table></div>
      <div class="form-grid">
        <div class="field"><label>Nom</label><input id="site-name" placeholder="MonShop"></div>
        <div class="field"><label>Domaine</label><input id="site-domain" placeholder="monshop.fr"></div>
        <div class="field full"><label>URL de recherche (pour la recherche multi-sites) — utilisez <code>{query}</code></label>
          <input id="site-search" placeholder="https://monshop.fr/recherche?q={query}"></div>
        <div class="field"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="site-trusted"> Vendeur fiable</label>
          <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="site-pw"> Site JS (Playwright)</label></div>
      </div>
      <div class="form-actions"><button class="btn secondary" id="btn-add-site">Ajouter le site</button></div>
    </div>
    <div class="card">
      <div class="card-header">🏷️ Catégories surveillées</div>
      <div class="table-wrap"><table><tbody>${cats.map(c => `<tr><td>${esc(c.name)}</td><td class="muted">${esc(c.watch_url || '')}</td><td>${c.products} produit(s)</td>
        <td style="display:flex;gap:6px">
          ${c.watch_url ? `<button class="btn small secondary" data-discover="${c.id}">🔎 Découvrir</button>` : ''}
          <button class="btn danger small" data-del-cat="${c.id}">Supprimer</button></td></tr>`).join('') || '<tr><td class="empty">Aucune catégorie</td></tr>'}</tbody></table></div>
      <div class="form-grid">
        <div class="field"><label>Nom</label><input id="cat-name" placeholder="High-tech"></div>
        <div class="field full"><label>URL de catégorie à surveiller (optionnel)</label><input id="cat-url" placeholder="https://exemple.com/categorie/tv"></div>
      </div>
      <div class="form-actions"><button class="btn secondary" id="btn-add-cat">Ajouter la catégorie</button></div>
    </div>`;

  document.getElementById('btn-preview').onclick = async (e) => {
    const url = document.getElementById('add-url').value.trim();
    if (!url) return toast('Renseignez une URL', true);
    e.target.disabled = true; e.target.textContent = 'Scraping en cours…';
    try {
      const r = await api('/scrape/preview', { method: 'POST', body: JSON.stringify({ url }) });
      const box = document.getElementById('preview-result');
      if (!r.ok) {
        box.innerHTML = `<div class="preview-box"><span class="badge risk-eleve">échec : ${esc(r.status)}</span> <span class="muted">${esc(r.error)}</span></div>`;
      } else {
        const d = r.data;
        box.innerHTML = `<div class="preview-box">
          <span class="badge risk-faible">extrait via ${esc(r.method)} (${r.duration_ms} ms)</span>
          <p style="margin-top:10px"><b>${esc(d.name || '(nom non trouvé)')}</b> — ${eur(d.price)}
          ${d.old_price ? `<span class="price-strike">${eur(d.old_price)}</span>` : ''} ${stockBadge(d.availability)}</p>
          <p class="muted" style="font-size:13px">EAN : ${esc(d.ean || '—')} · Vendeur : ${esc(d.seller || '—')} · Livraison : ${d.shipping_cost != null ? eur(d.shipping_cost) : '—'} · Sources : ${esc((d.sources || []).join(', '))}</p></div>`;
        if (d.name) document.getElementById('add-name').value = d.name;
        if (d.ean) document.getElementById('add-ean').value = d.ean;
      }
    } catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = "Tester l'extraction";
  };

  document.getElementById('btn-add').onclick = async (e) => {
    const url = document.getElementById('add-url').value.trim();
    if (!url) return toast('Renseignez une URL', true);
    e.target.disabled = true; e.target.textContent = 'Ajout + scraping…';
    try {
      const p = await api('/products', { method: 'POST', body: JSON.stringify({
        url,
        name: document.getElementById('add-name').value,
        ean: document.getElementById('add-ean').value,
        category_id: Number(document.getElementById('add-cat').value) || null,
        website_id: Number(document.getElementById('add-site').value) || null,
        market_price: Number(document.getElementById('add-market').value) || null,
        market_price_auto: !document.getElementById('add-market').value,
        check_frequency_minutes: Number(document.getElementById('add-freq').value),
      }) });
      toast('Produit ajouté ✔');
      location.hash = '#/produit/' + p.id;
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Ajouter et scraper maintenant'; }
  };

  document.getElementById('btn-add-site').onclick = async () => {
    try {
      await api('/websites', { method: 'POST', body: JSON.stringify({
        name: document.getElementById('site-name').value,
        domain: document.getElementById('site-domain').value.replace(/^www\./, ''),
        trusted: document.getElementById('site-trusted').checked,
        needs_playwright: document.getElementById('site-pw').checked,
        search_url_template: document.getElementById('site-search').value.trim(),
      }) });
      toast('Site ajouté ✔'); pageAdd();
    } catch (err) { toast(err.message, true); }
  };
  view.querySelectorAll('[data-discover]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = '⏳ Découverte…';
    try {
      const r = await api('/categories/' + b.dataset.discover + '/discover', {
        method: 'POST', body: JSON.stringify({ max_items: 20, add_to_monitoring: true }) });
      if (r.error) { toast(r.error, true); b.disabled = false; b.textContent = '🔎 Découvrir'; return; }
      toast(`${r.results.length} produit(s) découvert(s) et mis sous surveillance sur ${r.found_links} lien(s)`);
      location.hash = '#/produits';
    } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = '🔎 Découvrir'; }
  });
  document.getElementById('btn-add-cat').onclick = async () => {
    try {
      await api('/categories', { method: 'POST', body: JSON.stringify({
        name: document.getElementById('cat-name').value,
        watch_url: document.getElementById('cat-url').value,
      }) });
      toast('Catégorie ajoutée ✔'); pageAdd();
    } catch (err) { toast(err.message, true); }
  };
  view.querySelectorAll('[data-del-site]').forEach((b) => b.onclick = async () => {
    if (!confirm('Supprimer ce site ?')) return;
    await api('/websites/' + b.dataset.delSite, { method: 'DELETE' }); pageAdd();
  });
  view.querySelectorAll('[data-del-cat]').forEach((b) => b.onclick = async () => {
    if (!confirm('Supprimer cette catégorie ?')) return;
    await api('/categories/' + b.dataset.delCat, { method: 'DELETE' }); pageAdd();
  });
}

async function pageProducts() {
  const search = document.getElementById('global-search').value.trim();
  const products = await api('/products' + (search ? '?search=' + encodeURIComponent(search) : ''));
  view.innerHTML = `
    <h1>Produits surveillés</h1>
    <p class="subtitle">${products.length} produit(s) · gérez la surveillance et la fréquence de vérification</p>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Produit</th><th>Dernier prix</th><th>Prix marché</th><th>Stock</th><th>Fréquence</th><th>Dernier check</th><th>Surveillance</th><th>Actions</th></tr></thead>
      <tbody>${products.map((p) => `<tr>
        <td>${productCell(p)}</td>
        <td><b>${eur(p.last_price)}</b>${p.last_old_price ? `<div class="price-strike">${eur(p.last_old_price)}</div>` : ''}</td>
        <td>${eur(p.market_price)}${p.market_price_auto ? ' <span class="muted" title="calculé automatiquement">ⓐ</span>' : ''}</td>
        <td>${stockBadge(p.last_availability)}</td>
        <td><select data-freq="${p.id}">
          ${[[60, '1 h'], [360, '6 h'], [720, '12 h'], [1440, '24 h']].map(([v, l]) => `<option value="${v}" ${p.check_frequency_minutes == v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></td>
        <td class="muted">${dt(p.last_checked_at)}</td>
        <td><input type="checkbox" data-active="${p.id}" ${p.active ? 'checked' : ''} title="activer / désactiver"></td>
        <td style="display:flex;gap:6px">
          <button class="btn small secondary" data-check="${p.id}">Vérifier</button>
          <button class="btn small danger" data-del="${p.id}">✕</button>
        </td></tr>`).join('') || '<tr><td colspan="8" class="empty">Aucun produit surveillé</td></tr>'}
      </tbody></table></div></div>`;

  view.querySelectorAll('[data-check]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = '…';
    try {
      const r = await api('/products/' + b.dataset.check + '/check', { method: 'POST' });
      toast(r.job.status === 'success' ? 'Vérifié ✔ ' + eur(r.product.last_price) : 'Échec : ' + (r.job.error || r.job.status), r.job.status !== 'success');
      pageProducts();
    } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Vérifier'; }
  });
  view.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Supprimer ce produit et son historique ?')) return;
    await api('/products/' + b.dataset.del, { method: 'DELETE' });
    toast('Produit supprimé'); pageProducts();
  });
  view.querySelectorAll('[data-active]').forEach((c) => c.onchange = () =>
    api('/products/' + c.dataset.active, { method: 'PATCH', body: JSON.stringify({ active: c.checked }) })
      .then(() => toast(c.checked ? 'Surveillance activée' : 'Surveillance désactivée')));
  view.querySelectorAll('[data-freq]').forEach((s) => s.onchange = () =>
    api('/products/' + s.dataset.freq, { method: 'PATCH', body: JSON.stringify({ check_frequency_minutes: Number(s.value) }) })
      .then(() => toast('Fréquence mise à jour')));
}

async function pageProductDetail(id) {
  const d = await api(`/products/${id}/history`);
  const p = d.product, st = d.stats;
  const last = d.checks[d.checks.length - 1];
  view.innerHTML = `
    <h1>Détail produit</h1>
    <p class="subtitle"><a href="#/produits">← Retour aux produits surveillés</a></p>
    <div class="card"><div class="detail-head">
      ${p.image_url ? `<img src="${esc(p.image_url)}" onerror="this.remove()">` : ''}
      <div class="info">
        <h2>${esc(p.name || p.url)}</h2>
        <p class="muted">${esc(p.website || '')} · ${esc(p.category || 'sans catégorie')} · EAN ${esc(p.ean || '—')} · <a href="${esc(p.url)}" target="_blank" rel="noopener">voir la page ↗</a></p>
        <div class="price-now">${eur(p.last_price)} ${p.last_old_price ? `<span class="price-strike" style="font-size:16px">${eur(p.last_old_price)}</span>` : ''}</div>
        <p>${last ? levelBadge(last.opportunity_level) + ' ' + riskBadge(last.risk_level) + ' ' + stockBadge(last.availability) : ''}
           ${last && last.margin_eur != null ? `· marge estimée <b class="gap-positive">${eur(last.margin_eur)}</b> (${pct(last.margin_percent)})` : ''}</p>
      </div>
      <div><button class="btn" id="btn-check-now">Vérifier maintenant</button></div>
    </div></div>
    <div class="card">
      <div class="card-header">📈 Historique du prix</div>
      <div class="chart-box"><canvas id="price-chart"></canvas></div>
      <div class="hist-stats">
        <div>Prix le plus bas<b style="color:var(--green)">${eur(st.min_price)}</b></div>
        <div>Prix le plus haut<b style="color:var(--red)">${eur(st.max_price)}</b></div>
        <div>Prix moyen<b>${eur(st.avg_price)}</b></div>
        <div>Meilleure opportunité<b>${st.best_opportunity ? eur(st.best_opportunity.price) + ' le ' + dt(st.best_opportunity.date) : '—'}</b></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header">🧾 Relevés récents</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Prix</th><th>Prix marché</th><th>Écart %</th><th>Marge</th><th>Score</th><th>Niveau</th><th>Stock</th><th>Méthode</th></tr></thead>
        <tbody>${[...d.checks].reverse().slice(0, 30).map((c) => `<tr>
          <td class="muted">${dt(c.created_at)}</td><td><b>${eur(c.price)}</b></td>
          <td>${eur(c.market_price)}</td><td class="gap-positive">${pct(c.gap_percent)}</td>
          <td>${eur(c.margin_eur)}</td><td>${scoreCell(c.score)}</td>
          <td>${levelBadge(c.opportunity_level)}</td><td>${stockBadge(c.availability)}</td>
          <td class="muted">${esc(c.method)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  document.getElementById('btn-check-now').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Scraping…';
    try {
      const r = await api(`/products/${id}/check`, { method: 'POST' });
      toast(r.job.status === 'success' ? 'Relevé effectué ✔' : 'Échec : ' + (r.job.error || r.job.status), r.job.status !== 'success');
      pageProductDetail(id);
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Vérifier maintenant'; }
  };

  if (chart) { chart.destroy(); chart = null; }
  if (typeof Chart === 'undefined') {
    document.querySelector('.chart-box').innerHTML = '<div class="empty">Chart.js non chargé — graphique indisponible</div>';
    return;
  }
  chart = new Chart(document.getElementById('price-chart'), {
    type: 'line',
    data: {
      labels: d.checks.map((c) => dt(c.created_at)),
      datasets: [
        { label: 'Prix relevé', data: d.checks.map((c) => c.price), borderColor: '#4f8cff', backgroundColor: 'rgba(79,140,255,.12)', fill: true, tension: .25, pointRadius: 2 },
        { label: 'Prix moyen marché', data: d.checks.map((c) => c.market_price), borderColor: '#ffab3d', borderDash: [6, 4], pointRadius: 0, tension: .25 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#8b98b8', maxTicksLimit: 10, maxRotation: 0 }, grid: { color: '#263353' } },
        y: { ticks: { color: '#8b98b8', callback: (v) => v + ' €' }, grid: { color: '#263353' } },
      },
      plugins: { legend: { labels: { color: '#e8edf7' } } },
    },
  });
}

async function pageAlerts() {
  const alerts = await api('/alerts');
  view.innerHTML = `
    <h1>Alertes</h1>
    <p class="subtitle">Notifications d'opportunités — dashboard, email, Telegram, Discord</p>
    <div class="card">
      <div class="card-header">🔔 ${alerts.length} alerte(s)
        <button class="btn small secondary" id="btn-read-all" style="margin-left:auto">Tout marquer comme lu</button></div>
      ${alerts.map((a) => `<div class="alert-item ${a.read ? '' : 'unread'}">
        <div style="flex:1">
          <div class="title">${levelBadge(a.level)} ${esc(a.title)}</div>
          <pre>${esc(a.message)}</pre>
          <div class="alert-channels">📅 ${dt(a.created_at)}
            · 📧 email ${a.sent_email ? '✔' : '—'} · ✈️ Telegram ${a.sent_telegram ? '✔' : '—'} · 🎮 Discord ${a.sent_discord ? '✔' : '—'}
            · <a href="#/produit/${a.product_id}">voir le produit →</a></div>
        </div>
        ${a.read ? '' : `<button class="btn small secondary" data-read="${a.id}">Lu</button>`}
      </div>`).join('') || '<div class="empty">Aucune alerte pour le moment</div>'}
    </div>`;
  view.querySelectorAll('[data-read]').forEach((b) => b.onclick = async () => {
    await api('/alerts/' + b.dataset.read + '/read', { method: 'POST' });
    pageAlerts(); refreshAlertBadge();
  });
  document.getElementById('btn-read-all').onclick = async () => {
    await api('/alerts/read-all', { method: 'POST' });
    pageAlerts(); refreshAlertBadge();
  };
}

async function pageSettings() {
  const s = await api('/settings');
  view.innerHTML = `
    <h1>Paramètres</h1>
    <p class="subtitle">Seuils d'alerte personnalisables — appliqués à chaque relevé</p>
    <div class="card">
      <div class="card-header">🎯 Seuils d'alerte</div>
      <div class="form-grid">
        <div class="field"><label>Alerte si écart supérieur à (%)</label>
          <input id="set-gap" type="number" step="1" value="${s.alert_min_gap_percent}"></div>
        <div class="field"><label>Alerte si marge estimée supérieure à (€)</label>
          <input id="set-margin" type="number" step="1" value="${s.alert_min_margin_eur}"></div>
        <div class="field"><label style="display:flex;gap:8px;align-items:center;margin-top:22px">
          <input type="checkbox" id="set-stock" ${s.alert_only_in_stock ? 'checked' : ''}> Alerter uniquement si produit en stock</label></div>
      </div>
      <div class="form-actions"><button class="btn" id="btn-save">Enregistrer</button></div>
    </div>
    <div class="card">
      <div class="card-header">📡 Canaux d'alerte (configurés via .env)</div>
      <div class="form-grid">
        <div class="field"><label>Email (SMTP)</label><div>${s.channels.email ? '<span class="badge risk-faible">configuré ✔</span>' : '<span class="badge stock-unknown">non configuré</span>'}</div></div>
        <div class="field"><label>Telegram</label><div>${s.channels.telegram ? '<span class="badge risk-faible">configuré ✔</span>' : '<span class="badge stock-unknown">non configuré</span>'}</div></div>
        <div class="field"><label>Discord</label><div>${s.channels.discord ? '<span class="badge risk-faible">configuré ✔</span>' : '<span class="badge stock-unknown">non configuré</span>'}</div></div>
      </div>
      <p class="muted" style="padding:0 18px 18px;font-size:13px">Renseignez SMTP_*, TELEGRAM_* ou DISCORD_WEBHOOK_URL dans le fichier <code>.env</code> puis redémarrez le serveur.</p>
    </div>
    <div class="card">
      <div class="card-header">🕸️ Scraping (configuré via .env)</div>
      <div class="form-grid">
        <div class="field"><label>robots.txt respecté</label><div>${s.scraping.respect_robots_txt ? '✅ oui' : '⚠️ non'}</div></div>
        <div class="field"><label>Fallback Playwright</label><div>${s.scraping.playwright_fallback ? '✅ activé' : '— désactivé'}</div></div>
        <div class="field"><label>Délai entre requêtes (même domaine)</label><div>${s.scraping.min_delay} – ${s.scraping.max_delay} s</div></div>
      </div>
    </div>`;
  document.getElementById('btn-save').onclick = async () => {
    await api('/settings', { method: 'PUT', body: JSON.stringify({
      alert_min_gap_percent: Number(document.getElementById('set-gap').value),
      alert_min_margin_eur: Number(document.getElementById('set-margin').value),
      alert_only_in_stock: document.getElementById('set-stock').checked,
    }) });
    toast('Paramètres enregistrés ✔');
  };
}

async function pageProxies() {
  const [stats, sources, proxies] = await Promise.all([
    api('/proxies/stats'), api('/proxies/sources'), api('/proxies?alive_only=true&limit=100'),
  ]);
  view.innerHTML = `
    <h1>Proxies</h1>
    <p class="subtitle">Pool de proxies publics gratuits — téléchargés, fusionnés, testés, scorés et renouvelés automatiquement</p>
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Pool</div><div class="value">${stats.enabled ? '<span style="color:var(--green)">actif</span>' : '<span style="color:var(--muted)">désactivé</span>'}</div></div>
      <div class="stat-card"><div class="label">Proxies vivants</div><div class="value" style="color:var(--green)">${stats.alive}</div></div>
      <div class="stat-card"><div class="label">Total en base</div><div class="value">${stats.total}</div></div>
      <div class="stat-card"><div class="label">Meilleure latence</div><div class="value">${stats.best_latency_ms != null ? stats.best_latency_ms + ' ms' : '—'}</div></div>
      <div class="stat-card"><div class="label">Rafraîchissement</div><div class="value">${stats.refresh_minutes} min</div></div>
    </div>
    ${stats.enabled ? '' : '<div class="card"><div class="preview-box muted">⚠️ Le pool est désactivé. Activez-le avec <code>PROXY_POOL_ENABLED=true</code> dans <code>.env</code> pour la rotation automatique pendant le scraping. Vous pouvez tout de même tester le pool ci-dessous.</div></div>'}
    <div class="card">
      <div class="card-header">Proxies vivants par protocole
        <button class="btn small" id="btn-refresh-proxies" style="margin-left:auto">🔄 Rafraîchir maintenant</button></div>
      <div class="preview-box">
        ${['http', 'https', 'socks4', 'socks5'].map((p) => `<span class="badge stock-in" style="margin-right:8px">${p} : ${stats.alive_by_protocol[p] || 0}</span>`).join('')}
        <span class="muted"> · ${stats.test_limit_per_cycle} proxies testés par cycle</span>
      </div>
    </div>
    <div class="card">
      <div class="card-header">📍 Vérifier l'IP du scan
        <button class="btn small secondary" id="btn-ipcheck" style="margin-left:auto">Vérifier mon IP</button></div>
      <div class="preview-box" id="ipcheck-box"><span class="muted">Confirme quelle IP publique sert au scan (directe ou via un proxy vivant du pool).</span></div>
    </div>
    <div class="card">
      <div class="card-header">🌐 Sources (panneau admin) — ${sources.length} source(s)
        <button class="btn small secondary" id="btn-reload-sources" style="margin-left:auto">↻ Recharger depuis le fichier</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Source</th><th>Protocole</th><th>URL</th><th>Dernier fetch</th><th>Proxies</th><th>État</th><th>Actions</th></tr></thead>
        <tbody>${sources.map((s) => `<tr>
          <td>${esc(s.name)}</td>
          <td><span class="badge stock-unknown">${esc(s.protocol)}</span></td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis" title="${esc(s.url)}"><span class="muted">${esc(s.url)}</span></td>
          <td class="muted">${dt(s.last_fetched_at)}</td>
          <td>${s.last_error ? `<span class="badge risk-eleve" title="${esc(s.last_error)}">erreur</span>` : s.last_count}</td>
          <td>${s.enabled ? '<span class="badge risk-faible">activée</span>' : '<span class="badge stock-unknown">désactivée</span>'}</td>
          <td style="display:flex;gap:6px">
            <button class="btn small secondary" data-toggle-src="${s.id}">${s.enabled ? 'Désactiver' : 'Activer'}</button>
            <button class="btn small danger" data-del-src="${s.id}">✕</button>
          </td></tr>`).join('')}</tbody>
      </table></div>
      <div class="form-grid">
        <div class="field"><label>Nom</label><input id="src-name" placeholder="Ma source"></div>
        <div class="field"><label>Protocole</label><select id="src-proto"><option>http</option><option>https</option><option>socks4</option><option>socks5</option><option value="auto">auto (détecté)</option></select></div>
        <div class="field"><label>Format</label><select id="src-format"><option value="text">texte (ip:port)</option><option value="geonode">Geonode (JSON)</option></select></div>
        <div class="field full"><label>URL de la liste</label><input id="src-url" placeholder="https://exemple.com/proxies.txt"></div>
      </div>
      <div class="form-actions"><button class="btn secondary" id="btn-add-src">Ajouter la source</button></div>
    </div>
    <div class="card">
      <div class="card-header">✅ Top proxies vivants (${proxies.length})</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Proxy</th><th>Protocole</th><th>Latence</th><th>Score</th><th>Succès</th><th>Échecs</th><th>Testé</th></tr></thead>
        <tbody>${proxies.map((p) => `<tr>
          <td><code>${esc(p.host)}:${p.port}</code></td>
          <td><span class="badge stock-unknown">${esc(p.protocol)}</span></td>
          <td>${p.latency_ms != null ? p.latency_ms + ' ms' : '—'}</td>
          <td>${scoreCell(p.score)}</td>
          <td class="muted">${p.success_count}</td><td class="muted">${p.fail_count}</td>
          <td class="muted">${dt(p.last_checked_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aucun proxy vivant. Cliquez « Rafraîchir maintenant » pour lancer un cycle.</td></tr>'}
      </tbody></table></div>
    </div>`;

  document.getElementById('btn-refresh-proxies').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = '⏳ Cycle en cours (peut prendre 1 min)…';
    try {
      const r = await api('/proxies/refresh', { method: 'POST' });
      const s = r.summary;
      toast(`Cycle terminé : ${s.alive_in_db} vivants / ${s.collected_unique} collectés, ${s.purged_dead} morts purgés`);
      pageProxies();
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = '🔄 Rafraîchir maintenant'; }
  };
  document.getElementById('btn-ipcheck').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = '⏳…';
    const box = document.getElementById('ipcheck-box');
    try {
      const r = await api('/proxies/ip-check');
      if (r.ok) {
        const g = r.geo || {};
        box.innerHTML = `<span class="badge risk-faible">IP : ${esc(r.ip)}</span>
          <span class="muted"> ${g.country ? '· ' + esc(g.country) + (g.city ? ' (' + esc(g.city) + ')' : '') : ''} ${g.isp ? '· ' + esc(g.isp) : ''} ${r.via_proxy ? '· via proxy' : '· connexion directe'}</span>`;
      } else {
        box.innerHTML = `<span class="badge risk-eleve">${esc(r.error || 'échec')}</span>`;
      }
    } catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = 'Vérifier mon IP';
  };
  document.getElementById('btn-reload-sources').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = '⏳…';
    try {
      const r = await api('/proxies/sources/reload', { method: 'POST' });
      toast(r.added ? `${r.added} nouvelle(s) source(s) importée(s)` : 'Aucune nouvelle source à importer');
      pageProxies();
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = '↻ Recharger depuis le fichier'; }
  };
  document.getElementById('btn-add-src').onclick = async () => {
    try {
      await api('/proxies/sources', { method: 'POST', body: JSON.stringify({
        name: document.getElementById('src-name').value,
        url: document.getElementById('src-url').value,
        protocol: document.getElementById('src-proto').value,
        format: document.getElementById('src-format').value,
      }) });
      toast('Source ajoutée ✔'); pageProxies();
    } catch (err) { toast(err.message, true); }
  };
  view.querySelectorAll('[data-toggle-src]').forEach((b) => b.onclick = async () => {
    await api('/proxies/sources/' + b.dataset.toggleSrc + '/toggle', { method: 'PUT' });
    pageProxies();
  });
  view.querySelectorAll('[data-del-src]').forEach((b) => b.onclick = async () => {
    if (!confirm('Supprimer cette source ?')) return;
    await api('/proxies/sources/' + b.dataset.delSrc, { method: 'DELETE' });
    toast('Source supprimée'); pageProxies();
  });
}

async function pageLogs() {
  const logs = await api('/logs');
  const badge = (s) => ({ success: 'risk-faible', blocked: 'risk-eleve', error: 'risk-eleve', robots_denied: 'risk-moyen', no_price: 'risk-moyen', pending: 'stock-unknown' }[s] || 'stock-unknown');
  view.innerHTML = `
    <h1>Logs scraping</h1>
    <p class="subtitle">Historique des jobs — erreurs 403/429, captchas et blocages y apparaissent</p>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>URL</th><th>Statut</th><th>Méthode</th><th>Durée</th><th>Erreur</th></tr></thead>
      <tbody>${logs.map((j) => `<tr>
        <td class="muted">${dt(j.created_at)}</td>
        <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis">${j.product_id ? `<a href="#/produit/${j.product_id}">${esc(j.url)}</a>` : esc(j.url)}</td>
        <td><span class="badge ${badge(j.status)}">${esc(j.status)}</span></td>
        <td class="muted">${esc(j.method || '—')}</td>
        <td class="muted">${j.duration_ms != null ? j.duration_ms + ' ms' : '—'}</td>
        <td class="muted" style="max-width:300px;white-space:normal">${esc(j.error || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Aucun job pour le moment</td></tr>'}
      </tbody></table></div></div>`;
}

/* ---------------- routeur ---------------- */
const routes = {
  dashboard: pageDashboard,
  opportunites: pageOpportunities,
  'veille-prix': pageVeillePrix,
  recherche: pageSearch,
  comparateur: pageComparateur,
  'sources-api': pageSources,
  ajouter: pageAdd,
  produits: pageProducts,
  alertes: pageAlerts,
  proxies: pageProxies,
  parametres: pageSettings,
  logs: pageLogs,
};

async function router() {
  const hash = location.hash.replace(/^#\//, '') || 'dashboard';
  const [route, arg] = hash.split('/');
  document.querySelectorAll('.sidebar nav a').forEach((a) =>
    a.classList.toggle('active', a.dataset.route === route || (route === 'produit' && a.dataset.route === 'produits')));
  document.getElementById('sidebar').classList.remove('open');
  view.innerHTML = '<div class="empty">Chargement…</div>';
  try {
    if (route === 'produit' && arg) await pageProductDetail(Number(arg));
    else await (routes[route] || pageDashboard)();
  } catch (err) {
    view.innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`;
  }
}

async function refreshAlertBadge() {
  try {
    const d = await api('/dashboard');
    const badge = document.getElementById('alert-badge');
    badge.hidden = !d.stats.alerts_unread;
    badge.textContent = d.stats.alerts_unread;
  } catch { /* serveur indisponible */ }
}

document.getElementById('burger').onclick = () =>
  document.getElementById('sidebar').classList.toggle('open');
document.getElementById('topbar-date').textContent =
  new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
document.getElementById('global-search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const route = location.hash.replace(/^#\//, '') || 'dashboard';
  if (route === 'produits') pageProducts();
  else location.hash = '#/opportunites', setTimeout(router, 0);
});

window.addEventListener('hashchange', router);
router();
refreshAlertBadge();
setInterval(refreshAlertBadge, 60000);
