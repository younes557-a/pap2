/* Porte-à-Porte – Ris-Orangis (client-only, offline-first)
 * - Import CSV (PapaParse)
 * - Filtres (bureau / recherche), tri, pagination
 * - Statuts + remarques éditables
 * - Export CSV (complet / vue / Favorables / Favorables+Indécis)
 * - Persistance locale (localStorage)
 */

(() => {
  // ==== Sélecteurs
  const els = {
    bureauFilter: document.getElementById('bureauFilter'),
    searchInput: document.getElementById('searchInput'),
    btnSearch: document.getElementById('btnSearch'),
    btnClearFilters: document.getElementById('btnClearFilters'),
    sortColumn: document.getElementById('sortColumn'),
    sortToggle: document.getElementById('sortToggle'),
    btnApplySort: document.getElementById('btnApplySort'),
    pageSize: document.getElementById('pageSize'),
    tbody: document.getElementById('tbody'),
    pageInfo: document.getElementById('pageInfo'),
    btnPrev: document.getElementById('btnPrev'),
    btnNext: document.getElementById('btnNext'),
    gotoInput: document.getElementById('gotoInput'),
    btnGoto: document.getElementById('btnGoto'),
    fileInput: document.getElementById('fileInput'),
    progress: document.getElementById('progress'),
    btnExport: document.getElementById('btnExport'),
    btnExportView: document.getElementById('btnExportView'),
    btnExportFav: document.getElementById('btnExportFav'),
    btnExportFavInd: document.getElementById('btnExportFavInd'),
  };

  // ==== État
  const LS_KEY_DATA = 'pap-data-v1';
  const LS_KEY_STATE = 'pap-ui-v1';
  const DEFAULT_STATUS = 'non_contacte';
  const STATUS_LABELS = {
    favorable: 'Favorable',
    indecis: 'Indécis',
    defavorable: 'Défavorable',
    absent: 'Absent',
    non_contacte: 'Non contacté',
  };
  const STATUS_ORDER = ['favorable', 'indecis', 'defavorable', 'absent', 'non_contacte'];

  let DATA = [];
  let UI = {
    bureau: '',
    q: '',
    sortCol: 'nom',
    sortDir: 'asc',
    page: 1,
    pageSize: Number(els.pageSize?.value || 1000),
  };

  // ==== Utils
  const saveAll = () => {
    localStorage.setItem(LS_KEY_DATA, JSON.stringify(DATA));
    localStorage.setItem(LS_KEY_STATE, JSON.stringify(UI));
  };
  const loadAll = () => {
    try {
      const d = localStorage.getItem(LS_KEY_DATA);
      if (d) DATA = JSON.parse(d);
      const u = localStorage.getItem(LS_KEY_STATE);
      if (u) UI = { ...UI, ...JSON.parse(u) };
    } catch {}
  };

  const uid = (() => { let n = 0; return () => 'row_' + Date.now().toString(36) + '_' + (++n).toString(36); })();
  const norm = (s) => (s ?? '').toString().trim();
  const lower = (s) => norm(s).toLowerCase();

  function normalizeRow(obj) {
    const map = new Map();
    Object.entries(obj).forEach(([k, v]) => map.set(lower(k), v));

    const row = {
      id: obj.id || uid(),
      nom: norm(map.get('nom') ?? map.get('name') ?? ''),
      prenom: norm(map.get('prenom') ?? map.get('prénom') ?? map.get('first') ?? ''),
      bureau: norm(map.get('bureau') ?? map.get('bureau de vote') ?? map.get('codebureau') ?? map.get('bv') ?? ''),
      adresse: norm(map.get('adresse') ?? map.get('addresse') ?? map.get('address') ?? ''),
      email: norm(map.get('email') ?? map.get('mail') ?? ''),
      telephone: norm(map.get('telephone') ?? map.get('téléphone') ?? map.get('tel') ?? ''),
      remarque: norm(map.get('remarque') ?? map.get('note') ?? map.get('commentaire') ?? ''),
      statut: (lower(map.get('statut')) || DEFAULT_STATUS)
                .replace('indécis','indecis')
                .replace('défavorable','defavorable'),
    };
    if (!Object.keys(STATUS_LABELS).includes(row.statut)) row.statut = DEFAULT_STATUS;
    return row;
  }

  function computeBureaux(list) {
    const set = new Set();
    list.forEach(r => { if (r.bureau) set.add(r.bureau); });
    return Array.from(set).sort((a,b) => a.localeCompare(b, 'fr'));
  }

  function setProgress(msg) { els.progress.textContent = msg; }

  function badgeClass(statut) {
    switch (statut) {
      case 'favorable': return 'badge badge-fav';
      case 'indecis': return 'badge badge-indecis';
      case 'defavorable': return 'badge badge-defav';
      case 'absent': return 'badge badge-absent';
      default: return 'badge badge-none';
    }
  }

  // ==== Import CSV
  function importCSV(file) {
    setProgress('Import en cours…');
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data.map(normalizeRow);
        DATA = rows;
        UI.page = 1;
        populateBureauFilter();
        render();
        saveAll();
        setProgress(`Import terminé : ${rows.length} lignes.`);
      },
      error: (err) => setProgress('Erreur import: ' + (err?.message || err))
    });
  }

  // ==== Export CSV
  function downloadCSV(rows, filename) {
    const csv = Papa.unparse(rows, { encoding: 'utf-8' });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  }
  const ts = () => {
    const d = new Date(), p = (n) => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
  };
  const exportFull   = () => downloadCSV(DATA, `electeurs_complet_${ts()}.csv`);
  const exportView   = () => downloadCSV(getViewRows().rows, `electeurs_vue_${ts()}.csv`);
  const exportFav    = () => downloadCSV(DATA.filter(r => r.statut === 'favorable'), `favorables_${ts()}.csv`);
  const exportFavInd = () => downloadCSV(DATA.filter(r => r.statut === 'favorable' || r.statut === 'indecis'), `favorables_indecis_${ts()}.csv`);

  // ==== Filtres / Tri
  function populateBureauFilter() {
    const opts = ['<option value="">Tous les bureaux</option>'];
    computeBureaux(DATA).forEach(bv => {
      const selected = (UI.bureau === bv) ? 'selected' : '';
      opts.push(`<option value="${escapeHtml(bv)}" ${selected}>${escapeHtml(bv)}</option>`);
    });
    els.bureauFilter.innerHTML = opts.join('');
  }

  function getFiltered() {
    const q = lower(UI.q);
    return DATA.filter(r => {
      if (UI.bureau && r.bureau !== UI.bureau) return false;
      if (!q) return true;
      const hay = [r.nom, r.prenom, r.adresse, r.email, r.telephone, r.remarque]
                    .map(lower).join(' ');
      return hay.includes(q);
    });
  }

  function getSorted(rows) {
    const col = UI.sortCol;
    const dir = UI.sortDir === 'asc' ? 1 : -1;
    const cmp = (a,b) => a.localeCompare(b, 'fr', { sensitivity:'base', numeric:true });
    const getVal = (r) => (r[col] ?? '').toString();
    return rows.slice().sort((A,B) => {
      const a = getVal(A), b = getVal(B);
      const primary = cmp(a,b);
      if (primary !== 0) return dir * primary;
      const s1 = cmp(A.nom + ' ' + A.prenom, B.nom + ' ' + B.prenom);
      return dir * s1;
    });
  }

  function paginate(rows) {
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / UI.pageSize));
    const page = Math.min(Math.max(1, UI.page), pages);
    const start = (page - 1) * UI.pageSize;
    return { page, pages, total, slice: rows.slice(start, start + UI.pageSize) };
  }

  function getViewRows() {
    const filtered = getFiltered();
    const sorted = getSorted(filtered);
    const pageData = paginate(sorted);
    return { rows: sorted, pageData };
  }

  // ==== Rendu
  function render() {
    els.searchInput.value = UI.q;
    els.sortColumn.value = UI.sortCol;
    els.sortToggle.textContent = UI.sortDir === 'asc' ? 'Asc' : 'Desc';
    els.pageSize.value = String(UI.pageSize);

    const { pageData } = getViewRows();
    const { page, pages, total, slice } = pageData;

    els.pageInfo.textContent = `Page ${page} / ${pages} — ${total} lignes`;
    els.gotoInput.value = String(page);

    els.tbody.innerHTML = slice.map(renderRow).join('');

    els.btnPrev.disabled = (page <= 1);
    els.btnNext.disabled = (page >= pages);
  }

  function renderRow(r) {
    const badge = `<span class="${badgeClass(r.statut)}">${STATUS_LABELS[r.statut] ?? r.statut}</span>`;
    return `
      <tr data-id="${r.id}">
        <td>${escapeHtml(r.nom)}</td>
        <td>${escapeHtml(r.prenom)}</td>
        <td>${escapeHtml(r.bureau)}</td>
        <td>${escapeHtml(r.adresse)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td>${escapeHtml(r.telephone)}</td>
        <td>
          <textarea class="input remark" rows="1" placeholder="Ajouter une remarque…">${escapeHtml(r.remarque)}</textarea>
        </td>
        <td>
          <div class="flex items-center gap-2">
            <select class="input status">
              ${STATUS_ORDER.map(s => `<option value="${s}" ${r.statut===s?'selected':''}>${STATUS_LABELS[s]}</option>`).join('')}
            </select>
            ${badge}
          </div>
        </td>
        <td>
          <div class="row-actions">
            <button class="mini act-save" title="Enregistrer">Enregistrer</button>
            <button class="mini act-cycle" title="Cycle statut">Cycle</button>
            <button class="mini act-del" title="Supprimer">Supprimer</button>
          </div>
        </td>
      </tr>
    `;
  }

  function escapeHtml(s) {
    return (s ?? '').toString()
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

  // ==== Events
  els.fileInput.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importCSV(f);
  });

  els.btnExport.addEventListener('click', exportFull);
  els.btnExportView.addEventListener('click', exportView);
  els.btnExportFav.addEventListener('click', exportFav);
  els.btnExportFavInd.addEventListener('click', exportFavInd);

  els.bureauFilter.addEventListener('change', () => {
    UI.bureau = els.bureauFilter.value;
    UI.page = 1; saveAll(); render();
  });

  els.btnSearch.addEventListener('click', () => {
    UI.q = els.searchInput.value.trim();
    UI.page = 1; saveAll(); render();
  });
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      UI.q = els.searchInput.value.trim();
      UI.page = 1; saveAll(); render();
    }
  });

  els.btnClearFilters.addEventListener('click', () => {
    UI.q = ''; UI.bureau = ''; UI.page = 1;
    els.searchInput.value = '';
    populateBureauFilter();
    saveAll(); render();
  });

  els.sortToggle.addEventListener('click', () => {
    UI.sortDir = UI.sortDir === 'asc' ? 'desc' : 'asc';
    els.sortToggle.textContent = UI.sortDir === 'asc' ? 'Asc' : 'Desc';
  });
  els.btnApplySort.addEventListener('click', () => {
    UI.sortCol = els.sortColumn.value;
    saveAll(); render();
  });

  els.pageSize.addEventListener('change', () => {
    UI.pageSize = Number(els.pageSize.value || 1000);
    UI.page = 1; saveAll(); render();
  });

  els.btnPrev.addEventListener('click', () => {
    UI.page = Math.max(1, UI.page - 1); saveAll(); render();
  });
  els.btnNext.addEventListener('click', () => {
    const { pageData } = getViewRows();
    UI.page = Math.min(pageData.pages, UI.page + 1); saveAll(); render();
  });
  els.btnGoto.addEventListener('click', () => {
    const v = Number(els.gotoInput.value || 1);
    const { pageData } = getViewRows();
    UI.page = Math.min(Math.max(1, v), pageData.pages); saveAll(); render();
  });

  // Délégation sur le tableau
  els.tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const tr = e.target.closest('tr[data-id]');
    const id = tr?.getAttribute('data-id');
    if (!id) return;
    const row = DATA.find(r => r.id === id);
    if (!row) return;

    if (btn.classList.contains('act-save')) {
      const remark = tr.querySelector('.remark')?.value ?? '';
      const statut = tr.querySelector('.status')?.value ?? row.statut;
      row.remarque = remark.trim();
      row.statut = statut;
      saveAll();
      // met à jour juste le badge
      const td = tr.children[7];
      td.querySelectorAll('.badge').forEach(b => b.remove());
      const span = document.createElement('span');
      span.className = badgeClass(row.statut);
      span.textContent = STATUS_LABELS[row.statut];
      td.querySelector('.flex').appendChild(span);
    }

    if (btn.classList.contains('act-cycle')) {
      const idx = STATUS_ORDER.indexOf(row.statut);
      row.statut = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
      const statusSel = tr.querySelector('.status');
      if (statusSel) statusSel.value = row.statut;
      saveAll(); render();
    }

    if (btn.classList.contains('act-del')) {
      if (confirm('Supprimer cette ligne ?')) {
        DATA = DATA.filter(r => r.id !== id);
        saveAll(); populateBureauFilter(); render();
      }
    }
  });

  els.tbody.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.getAttribute('data-id');
    const row = DATA.find(r => r.id === id);
    if (!row) return;

    if (e.target.classList.contains('status')) {
      row.statut = e.target.value;
      saveAll(); render();
    }
  });

  // Drag & drop pratique
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && (f.type.includes('csv') || f.name.endsWith('.csv'))) importCSV(f);
  });

  // ==== Boot
  loadAll();
  populateBureauFilter();
  render();
  if (!DATA.length) setProgress('Aucun fichier importé.');
})();
