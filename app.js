/* Porte-à-Porte – version boutons de statut + champs éditables */
(() => {
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
    btnResetAll: document.getElementById('btnResetAll'),
  };

  const LS_KEY_DATA = 'pap-data-v1';
  const LS_KEY_STATE = 'pap-ui-v1';

  const STATUS = ['favorable','indecis','defavorable','absent','non_contacte'];
  const LABEL = {
    favorable:'Favorable', indecis:'Indécis', defavorable:'Défavorable',
    absent:'Absent', non_contacte:'Non contacté'
  };

  let DATA = [];
  let UI = { bureau:'', q:'', sortCol:'nom', sortDir:'asc', page:1, pageSize:Number(els.pageSize?.value||1000) };

  // ---------- utils
  const saveAll = ()=>{ localStorage.setItem(LS_KEY_DATA, JSON.stringify(DATA)); localStorage.setItem(LS_KEY_STATE, JSON.stringify(UI)); };
  const loadAll = ()=>{ try{ const d=localStorage.getItem(LS_KEY_DATA); if(d) DATA=JSON.parse(d); const u=localStorage.getItem(LS_KEY_STATE); if(u) UI={...UI,...JSON.parse(u)};}catch{} };
  const uid = (()=>{let i=0;return()=>`row_${Date.now().toString(36)}_${(++i).toString(36)}`})(); 
  const norm = s => (s??'').toString().trim();
  const lower = s => norm(s).toLowerCase();
  const stripAccents = s => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const keyify = h => stripAccents(h).toLowerCase().replace(/[^a-z0-9]+/g,'').trim();
  const badgeClass = s => ({
    favorable:'badge badge-fav', indecis:'badge badge-indecis',
    defavorable:'badge badge-defav', absent:'badge badge-absent',
    non_contacte:'badge badge-none'
  }[s] || 'badge badge-none');

  const pick = (obj, keys) => { for (const k of keys) { const v=obj[k]; if (v!==undefined && String(v).trim()!=='') return v; } return ''; };
  const sanitizeStatut = s => {
    const x=lower(stripAccents(s));
    if (x.startsWith('fav')) return 'favorable';
    if (x.startsWith('inde')) return 'indecis';
    if (x.startsWith('defa')||x.startsWith('opp')||x.startsWith('contre')) return 'defavorable';
    if (x.startsWith('abs')) return 'absent';
    return 'non_contacte';
  };

  // ---------- normalisation CSV
  function buildAddress(obj) {
    let adr = pick(obj,['adresse','adressecomplete','address','addresse','adr','libellevoie','voie']);
    if (!adr) {
      const num = pick(obj,['numero','numvoie','num','numadr']);
      const voie= pick(obj,['voie','libellevoie','rue']);
      const comp= pick(obj,['complement','complementadresse','bat','appt']);
      const cp  = pick(obj,['cp','codepostal','postalcode']);
      const vil = pick(obj,['ville','commune','localite','city']);
      adr = [[num,voie].filter(Boolean).join(' '), comp, [cp,vil].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    }
    return norm(adr);
  }

  function normalizeRow(obj) {
    return {
      id: obj.id || uid(),
      nom:      norm(pick(obj,['nom','nomdefamille','nomnaissance','lastname','name'])),
      prenom:   norm(pick(obj,['prenom','prenoms','firstname','first','givenname'])),
      bureau:   norm(pick(obj,['bureau','bureaudevote','codebureau','bv','codebv','bureauvote'])),
      adresse:  buildAddress(obj),
      email:    norm(pick(obj,['email','mail','courriel'])),
      telephone:norm(pick(obj,['telephone','tel','telephoneportable','mobile','gsm','phone'])),
      remarque: norm(pick(obj,['remarque','commentaire','note','notes','observations'])),
      statut:   obj.statut ? sanitizeStatut(obj.statut) : 'non_contacte',
    };
  }

  function importCSV(file) {
    setProgress('Import en cours…');
    Papa.parse(file, {
      header:true, skipEmptyLines:true,
      beforeFirstChunk: (chunk) => {
        if (chunk.charCodeAt(0)===0xFEFF) chunk = chunk.slice(1);
        const lines = chunk.split(/\r?\n/);
        if (lines[0] && /^sep=./i.test(lines[0])) lines.shift();
        return lines.join('\n');
      },
      transformHeader: (h)=> keyify(h),
      complete: (res)=>{
        const rows = res.data.map(normalizeRow)
          .filter(r => r.nom || r.prenom || r.adresse);
        DATA = rows;
        UI.page = 1;
        populateBureauFilter(); render(); saveAll();
        setProgress(`Import terminé : ${rows.length} lignes.`);
      },
      error: err => setProgress('Erreur import: '+(err?.message||err))
    });
  }

  // ---------- filtres/tri/vue
  function computeBureaux(list){ return Array.from(new Set(list.map(r=>r.bureau).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'fr')); }
  function populateBureauFilter(){
    const opts=['<option value="">Tous les bureaux</option>'];
    computeBureaux(DATA).forEach(bv=>opts.push(`<option value="${escapeHtml(bv)}"${UI.bureau===bv?' selected':''}>${escapeHtml(bv)}</option>`));
    els.bureauFilter.innerHTML=opts.join('');
  }
  function getFiltered(){
    const q=lower(UI.q);
    return DATA.filter(r=>{
      if (UI.bureau && r.bureau!==UI.bureau) return false;
      if (!q) return true;
      return [r.nom,r.prenom,r.adresse,r.email,r.telephone,r.remarque].map(lower).join(' ').includes(q);
    });
  }
  function getSorted(rows){
    const col=UI.sortCol, dir=UI.sortDir==='asc'?1:-1;
    const cmp=(a,b)=>a.localeCompare(b,'fr',{sensitivity:'base',numeric:true});
    return rows.slice().sort((A,B)=>{
      const p=cmp((A[col]??'').toString(),(B[col]??'').toString());
      if (p!==0) return dir*p;
      return dir*cmp(A.nom+' '+A.prenom, B.nom+' '+B.prenom);
    });
  }
  function paginate(rows){
    const total=rows.length, pages=Math.max(1,Math.ceil(total/UI.pageSize));
    const page=Math.min(Math.max(1,UI.page),pages);
    const start=(page-1)*UI.pageSize;
    return {page,pages,total,slice:rows.slice(start,start+UI.pageSize)};
  }
  function getViewRows(){ const f=getFiltered(); const s=getSorted(f); const p=paginate(s); return {rows:s, pageData:p}; }

  // ---------- rendu (boutons statut + inputs)
  function render(){
    els.searchInput.value=UI.q;
    els.sortColumn.value=UI.sortCol;
    els.sortToggle.textContent=UI.sortDir==='asc'?'Asc':'Desc';
    els.pageSize.value=String(UI.pageSize);

    const {pageData}=getViewRows();
    const {page,pages,total,slice}=pageData;
    els.pageInfo.textContent=`Page ${page} / ${pages} — ${total} lignes`;
    els.gotoInput.value=String(page);

    els.tbody.innerHTML = slice.map(renderRow).join('');

    els.btnPrev.disabled=(page<=1);
    els.btnNext.disabled=(page>=pages);
  }

  function renderRow(r){
    return `
      <tr data-id="${r.id}">
        <td>${escapeHtml(r.nom)}</td>
        <td>${escapeHtml(r.prenom)}</td>
        <td>${escapeHtml(r.bureau)}</td>
        <td>${escapeHtml(r.adresse)}</td>
        <td><input class="input inp-email" type="email" placeholder="email@exemple.fr" value="${escapeAttr(r.email)}" /></td>
        <td><input class="input inp-tel" type="tel" placeholder="06..." value="${escapeAttr(r.telephone)}" /></td>
        <td><input class="input inp-remark" type="text" placeholder="Remarque…" value="${escapeAttr(r.remarque)}" /></td>
        <td>
          <div class="row-actions">
            ${STATUS.map(s=>`<button class="mini act-status" data-status="${s}" title="${LABEL[s]}">${LABEL[s]}</button>`).join('')}
            <span class="${badgeClass(r.statut)}">${LABEL[r.statut]}</span>
          </div>
        </td>
        <td>
          <div class="row-actions">
            <button class="mini act-save" title="Enregistrer">Enregistrer</button>
            <button class="mini act-del" title="Supprimer">Supprimer</button>
          </div>
        </td>
      </tr>
    `;
  }

  function escapeHtml(s){return (s??'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}
  function escapeAttr(s){return escapeHtml(s).replaceAll('"','&quot;').replaceAll("'",'&#039;');}
  const setProgress = (m)=> els.progress.textContent = m;

  // ---------- export
  function downloadCSV(rows, filename){
    const csv = Papa.unparse(rows,{encoding:'utf-8'});
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  const ts=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;};
  const exportFull   =()=>downloadCSV(DATA, `electeurs_complet_${ts()}.csv`);
  const exportView   =()=>downloadCSV(getViewRows().rows, `electeurs_vue_${ts()}.csv`);
  const exportFav    =()=>downloadCSV(DATA.filter(r=>r.statut==='favorable'), `favorables_${ts()}.csv`);
  const exportFavInd =()=>downloadCSV(DATA.filter(r=>r.statut==='favorable'||r.statut==='indecis'), `favorables_indecis_${ts()}.csv`);

  // ---------- events UI
  els.fileInput.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) importCSV(f); });
  els.btnExport.addEventListener('click', exportFull);
  els.btnExportView.addEventListener('click', exportView);
  els.btnExportFav.addEventListener('click', exportFav);
  els.btnExportFavInd.addEventListener('click', exportFavInd);

  els.bureauFilter.addEventListener('change', ()=>{ UI.bureau=els.bureauFilter.value; UI.page=1; saveAll(); render(); });
  els.btnSearch.addEventListener('click', ()=>{ UI.q=els.searchInput.value.trim(); UI.page=1; saveAll(); render(); });
  els.searchInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ UI.q=els.searchInput.value.trim(); UI.page=1; saveAll(); render(); }});
  els.btnClearFilters.addEventListener('click', ()=>{ UI={...UI,bureau:'',q:'',page:1}; els.searchInput.value=''; populateBureauFilter(); saveAll(); render(); });

  els.sortToggle.addEventListener('click', ()=>{ UI.sortDir=UI.sortDir==='asc'?'desc':'asc'; els.sortToggle.textContent=UI.sortDir==='asc'?'Asc':'Desc'; });
  els.btnApplySort.addEventListener('click', ()=>{ UI.sortCol=els.sortColumn.value; saveAll(); render(); });
  els.pageSize.addEventListener('change', ()=>{ UI.pageSize=Number(els.pageSize.value||1000); UI.page=1; saveAll(); render(); });
  els.btnPrev.addEventListener('click', ()=>{ UI.page=Math.max(1,UI.page-1); saveAll(); render(); });
  els.btnNext.addEventListener('click', ()=>{ const {pageData}=getViewRows(); UI.page=Math.min(pageData.pages, UI.page+1); saveAll(); render(); });
  els.btnGoto.addEventListener('click', ()=>{ const v=Number(els.gotoInput.value||1); const {pageData}=getViewRows(); UI.page=Math.min(Math.max(1,v), pageData.pages); saveAll(); render(); });

  // délégation pour les lignes
  els.tbody.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const tr = e.target.closest('tr[data-id]'); if(!tr) return;
    const id = tr.getAttribute('data-id');
    const row = DATA.find(r=>r.id===id); if(!row) return;

    if (btn.classList.contains('act-status')) {
      row.statut = btn.dataset.status;
      saveAll();
      // maj badge seulement
      const td = tr.children[7];
      const span = td.querySelector('.badge');
      span.className = badgeClass(row.statut);
      span.textContent = LABEL[row.statut];
      return;
    }

    if (btn.classList.contains('act-save')) {
      row.email = tr.querySelector('.inp-email')?.value.trim() || '';
      row.telephone = tr.querySelector('.inp-tel')?.value.trim() || '';
      row.remarque = tr.querySelector('.inp-remark')?.value.trim() || '';
      saveAll();
      return;
    }

    if (btn.classList.contains('act-del')) {
      if (!confirm('Supprimer cette ligne ?')) return;
      DATA = DATA.filter(r=>r.id!==id);
      saveAll(); populateBureauFilter(); render();
      return;
    }
  });

  els.btnResetAll?.addEventListener('click', ()=>{
    if (!confirm('Effacer toutes les données locales ?')) return;
    localStorage.removeItem(LS_KEY_DATA);
    localStorage.removeItem(LS_KEY_STATE);
    DATA=[]; UI={ bureau:'', q:'', sortCol:'nom', sortDir:'asc', page:1, pageSize:Number(els.pageSize?.value||1000) };
    populateBureauFilter(); render(); setProgress('Aucun fichier importé.');
  });

  window.addEventListener('dragover', e=>e.preventDefault());
  window.addEventListener('drop', e=>{
    e.preventDefault();
    const f=e.dataTransfer?.files?.[0];
    if (f && (f.type.includes('csv') || f.name.endsWith('.csv'))) importCSV(f);
  });

  function setProgress(msg){ els.progress.textContent = msg; }

  // ---------- boot
  loadAll(); populateBureauFilter(); render();
  if (!DATA.length) setProgress('Aucun fichier importé.');
})();
