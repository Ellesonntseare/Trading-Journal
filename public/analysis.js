'use strict';
/* Analysis section (#/analysis): save chart analysis screenshots (before / after) with no trade attached.
   The screenshot boxes, paste, drag-drop, Draw and labels are the same ones the Add trade form uses. */

const anUi = { symbol: '', bias: '', q: '' };
const AN_TFS = ['1M', '5M', '15M', '30M', '1H', '4H', 'Daily', 'Weekly'];
let anList = [];

function viewAnalysis(arg, id) {
  if (arg === 'new') return viewAnalysisForm(null);
  if (arg === 'edit') return viewAnalysisForm(id || '');
  return viewAnalysisList();
}

async function anLoad() {
  anList = await api('/analyses');
  return anList;
}

/* ---------------- List ---------------- */
async function viewAnalysisList() {
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Analysis</h1><p class="sub" id="an-count">Loading…</p></div>
      <a class="btn gold" href="#/analysis/new">New analysis</a>
    </div>
    <div class="an-filters" id="an-filters"></div>
    <div class="an-grid" id="an-grid"></div>`;
  try {
    await anLoad();
  } catch (e) {
    $('#an-count').textContent = '';
    $('#an-grid').innerHTML = `<div class="empty-state"><h2>Could not load</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (!location.hash.startsWith('#/analysis') || location.hash.startsWith('#/analysis/new') || location.hash.startsWith('#/analysis/edit')) return;
  paintAnFilters();
  paintAnGrid();
}

function paintAnFilters() {
  const symbols = [...new Set(anList.map((a) => a.symbol).filter(Boolean))].sort();
  const box = $('#an-filters');
  if (!anList.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <label class="f">Pair<select id="an-f-symbol"><option value="">All pairs</option>${symbols.map((s) => `<option ${s === anUi.symbol ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    <label class="f">Bias<select id="an-f-bias"><option value="">Any</option>${['Bullish', 'Bearish', 'Neutral'].map((b) => `<option ${b === anUi.bias ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
    <label class="f an-f-grow">Search<input id="an-f-q" type="search" placeholder="Title, notes or tag" value="${esc(anUi.q)}"></label>`;
  $('#an-f-symbol').onchange = (e) => {
    anUi.symbol = e.target.value;
    paintAnGrid();
  };
  $('#an-f-bias').onchange = (e) => {
    anUi.bias = e.target.value;
    paintAnGrid();
  };
  $('#an-f-q').oninput = (e) => {
    anUi.q = e.target.value;
    paintAnGrid();
  };
}

function anShot(a, kind) {
  const files = a.images[kind];
  const label = kind === 'before' ? 'Before' : 'After';
  if (!files.length) return `<div class="an-shot empty"><span>No ${label.toLowerCase()} screenshot</span></div>`;
  return `<button type="button" class="an-shot" data-open="${kind}" data-file="${esc(files[0])}" aria-label="Open ${label} screenshot${files.length > 1 ? 's' : ''} of ${esc(a.title || a.symbol || 'analysis')}">
    <img src="${imgUrl(files[0])}" alt="${label} chart" loading="lazy">
    <span class="an-tag">${label}${files.length > 1 ? ` · ${files.length}` : ''}</span>
  </button>`;
}

function paintAnGrid() {
  const q = anUi.q.trim().toLowerCase();
  const rows = anList
    .filter((a) => (!anUi.symbol || a.symbol === anUi.symbol) && (!anUi.bias || a.bias === anUi.bias))
    .filter((a) => !q || [a.title, a.notes, a.symbol, a.timeframe, ...(a.tags || [])].join(' ').toLowerCase().includes(q))
    .sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.createdAt || '').localeCompare(x.createdAt || ''));
  $('#an-count').textContent = anList.length
    ? rows.length === anList.length
      ? `${anList.length} saved ${anList.length === 1 ? 'analysis' : 'analyses'}`
      : `Showing ${rows.length} of ${anList.length}`
    : 'Keep your chart analysis here, even for trades you never take.';
  const grid = $('#an-grid');
  if (!anList.length) {
    grid.innerHTML = `<div class="empty-state"><h2>No analysis saved yet</h2><p>Save a Before and After chart screenshot with your notes. No trade needed.</p><a class="btn gold" href="#/analysis/new">New analysis</a></div>`;
    return;
  }
  if (!rows.length) {
    grid.innerHTML = `<div class="empty-state"><h2>Nothing matches</h2><p>Try clearing the filters.</p></div>`;
    return;
  }
  grid.innerHTML = rows
    .map(
      (a) => `<article class="an-card" data-id="${esc(a.id)}">
        <div class="an-shots">${anShot(a, 'before')}${anShot(a, 'after')}</div>
        <div class="an-body">
          <div class="an-meta">
            ${a.symbol ? `<b>${esc(a.symbol)}</b>` : ''}
            ${a.timeframe ? `<span class="an-chip">${esc(a.timeframe)}</span>` : ''}
            ${a.bias ? `<span class="an-chip ${a.bias.toLowerCase()}">${esc(a.bias)}</span>` : ''}
            <span class="hint">${esc(fmtDay(a.date))}</span>
          </div>
          ${a.title ? `<h3>${esc(a.title)}</h3>` : ''}
          ${a.notes ? `<p class="an-notes">${esc(a.notes)}</p>` : ''}
          ${(a.tags || []).length ? `<div class="an-tags">${a.tags.map((t) => `<span class="an-chip">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="an-actions">
            <a class="btn small" href="#/analysis/edit/${esc(a.id)}">Edit</a>
            <button type="button" class="btn small danger" data-del>Delete</button>
          </div>
        </div>
      </article>`
    )
    .join('');
  grid.onclick = async (e) => {
    const card = e.target.closest('.an-card');
    if (!card) return;
    const a = anList.find((x) => x.id === card.dataset.id);
    if (!a) return;
    const shot = e.target.closest('.an-shot[data-open]');
    if (shot) {
      const files = [...a.images.before, ...a.images.after];
      const first = shot.dataset.open === 'before' ? 0 : a.images.before.length;
      return openLightbox(files, first, a.title || a.symbol || 'Analysis', a.captions || {});
    }
    if (e.target.closest('[data-del]')) {
      if (!confirm('Delete this analysis and its screenshots? This cannot be undone.')) return;
      try {
        await api('/analyses/' + a.id, 'DELETE');
        anList = anList.filter((x) => x.id !== a.id);
        paintAnFilters();
        paintAnGrid();
        toast('Analysis deleted');
      } catch (err) {
        toast(err.message, true);
      }
    }
  };
}

/* ---------------- Form ---------------- */
async function viewAnalysisForm(id) {
  let existing = null;
  if (id !== null) {
    view.innerHTML = `<p class="hint">Loading…</p>`;
    try {
      await anLoad();
    } catch (e) {
      view.innerHTML = `<div class="empty-state"><h2>Could not load</h2><p>${esc(e.message)}</p></div>`;
      return;
    }
    existing = anList.find((a) => a.id === id);
    if (!existing) {
      view.innerHTML = `<div class="empty-state"><h2>Analysis not found</h2><a class="btn" href="#/analysis">Back to Analysis</a></div>`;
      return;
    }
  }
  if (!location.hash.startsWith('#/analysis/')) return; // person already moved on
  const d = existing ? JSON.parse(JSON.stringify(existing)) : null;
  const today = localInput().slice(0, 10);
  const draft = {
    images: d ? d.images : { before: [], after: [] },
    captions: d ? d.captions || {} : {},
  };
  form = { mode: 'analysis', draft, active: 'before', fresh: new Set(), uploading: 0, manual: {}, editingId: d ? d.id : null, saved: false };
  const pairs = [...new Set([...(state.settings.pairs || []).map((p) => p.symbol), ...anList.map((a) => a.symbol)].filter(Boolean))];
  view.innerHTML = `
    <div class="page-head">
      <div><h1>${d ? 'Edit analysis' : 'New analysis'}</h1>
      <p class="sub">Click Before or After, then press Ctrl+V to paste a screenshot. No trade needed.</p></div>
    </div>
    <div class="zones" id="zones"></div>
    <form id="analysisForm" class="card an-form" novalidate>
      <div class="grid g4">
        <label class="f">Pair<input name="symbol" list="an-pairs" value="${esc(d ? d.symbol : pairs[0] || '')}" autocomplete="off" spellcheck="false" placeholder="XAUUSD"></label>
        <label class="f">Date<input name="date" type="date" value="${esc(d ? d.date : today)}"></label>
        <label class="f">Timeframe<input name="timeframe" list="an-tfs" value="${esc(d ? d.timeframe : '')}" autocomplete="off" placeholder="4H"></label>
        <label class="f">Bias<select name="bias">${['', 'Bullish', 'Bearish', 'Neutral'].map((b) => `<option value="${b}" ${d && d.bias === b ? 'selected' : ''}>${b || 'No bias'}</option>`).join('')}</select></label>
      </div>
      <datalist id="an-pairs">${pairs.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>
      <datalist id="an-tfs">${AN_TFS.map((t) => `<option value="${t}"></option>`).join('')}</datalist>
      <label class="f"><span>Title <span class="hint an-opt">optional</span></span><input name="title" maxlength="120" value="${esc(d ? d.title : '')}" placeholder="Example: Gold sweeps Asia low into London"></label>
      <label class="f"><span>Notes <span class="hint an-opt">optional</span></span><textarea name="notes" maxlength="8000" rows="6" placeholder="What you see, levels, what you expect, what you would look for.">${esc(d ? d.notes : '')}</textarea></label>
      <label class="f"><span>Tags <span class="hint an-opt">separate with commas</span></span><input name="tags" maxlength="200" value="${esc(d ? (d.tags || []).join(', ') : '')}" placeholder="Example: liquidity sweep, London, higher timeframe"></label>
      <p class="auth-error" id="anError" role="alert"></p>
      <div class="an-form-actions">
        <button class="btn" type="button" id="anCancel">Cancel</button>
        <button class="btn gold" type="submit" id="anSave">Save analysis</button>
      </div>
    </form>`;
  paintZones();
  wireZones();
  $('#anCancel').onclick = () => (location.hash = '#/analysis');
  $('#analysisForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveAnalysis();
  });
  cleanupView = () => {
    // Remove pasted images that were never saved.
    if (form && !form.saved) form.fresh.forEach((f) => api('/images/' + encodeURIComponent(f), 'DELETE').catch(() => {}));
    form = null;
  };
}

async function saveAnalysis() {
  const f = $('#analysisForm');
  const err = $('#anError');
  err.textContent = '';
  if (form.uploading) return (err.textContent = 'Wait a moment, an image is still saving.');
  const body = {
    symbol: f.elements.symbol.value.trim(),
    date: f.elements.date.value,
    timeframe: f.elements.timeframe.value.trim(),
    bias: f.elements.bias.value,
    title: f.elements.title.value.trim(),
    notes: f.elements.notes.value.trim(),
    tags: f.elements.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    images: form.draft.images,
    captions: form.draft.captions,
  };
  if (!body.images.before.length && !body.images.after.length && !body.title && !body.notes) {
    return (err.textContent = 'Add a screenshot or a note first.');
  }
  const btn = $('#anSave');
  btn.disabled = true;
  try {
    await api(form.editingId ? '/analyses/' + form.editingId : '/analyses', form.editingId ? 'PUT' : 'POST', body);
    form.saved = true;
    toast('Analysis saved');
    location.hash = '#/analysis';
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
  }
}
