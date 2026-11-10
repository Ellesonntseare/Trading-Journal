'use strict';

/* =========================================================
   Small helpers
   ========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { trades: [], settings: null, config: null };
const view = $('#view');

const PRESET_MISTAKES = [
  'Entered early', 'Entered late', 'Moved stop loss', 'No stop loss', 'Over-risked',
  'Revenge trade', 'Chased price', 'Closed too early', 'Held too long', 'Ignored my plan', 'FOMO',
];

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.auth) window.dispatchEvent(new Event('edge-auth-lost'));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), bad ? 4500 : 2400);
}

const isNum = (v) => typeof v === 'number' && isFinite(v);
const toNum = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
};
const isClosed = (t) => isNum(t.pnl);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

function money(n, withSign = false) {
  if (!isNum(n)) return '–';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-' : withSign && n > 0 ? '+' : '') + '$' + s;
}
const signClass = (n) => (!isNum(n) || n === 0 ? '' : n > 0 ? 'pos' : 'neg');
const fmtNum = (n, d = 2) => (isNum(n) ? String(round(n, d)) : '–');

const pad = (n) => String(n).padStart(2, '0');
const localInput = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = (t) => (t.closedAt || t.openedAt || '').slice(0, 10);
const closeTime = (t) => t.closedAt || t.openedAt || '';
function fmtDateTime(s) {
  if (!s) return '–';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtDay(key) {
  const d = new Date(key + 'T00:00');
  return isNaN(d) ? key : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
const imgUrl = (f) => '/images/' + encodeURIComponent(f);

// Older trades saved before captions and rules existed
function normTrade(t) {
  t.captions = t.captions || {};
  t.rulesAll = t.rulesAll || [];
  t.rulesChecked = t.rulesChecked || [];
  t.mistakes = t.mistakes || [];
  t.images = t.images || { before: [], after: [] };
  return t;
}

const pipUnit = (sym) => (state.settings.pairs.find((p) => p.symbol === sym) || {}).unit || 1;
function calcPips(t) {
  if (!isNum(t.entry) || !isNum(t.exit)) return null;
  return round(((t.side === 'Sell' ? -1 : 1) * (t.exit - t.entry)) / pipUnit(t.symbol), 1);
}
function calcR(t) {
  const dir = t.side === 'Sell' ? -1 : 1;
  if (isNum(t.riskUsd) && t.riskUsd > 0 && isNum(t.pnl)) return round(t.pnl / t.riskUsd, 2);
  if (isNum(t.entry) && isNum(t.sl) && isNum(t.exit) && t.entry !== t.sl) {
    return round((dir * (t.exit - t.entry)) / Math.abs(t.entry - t.sl), 2);
  }
  return null;
}

// Zoom and pan that several image "stages" can share (used by the viewer and the compare view).
// Each stage is an element that contains images marked with data-zoom.
function makeZoom(stages) {
  const z = { s: 1, x: 0, y: 0 };
  const apply = () =>
    stages.forEach((st) =>
      $$('[data-zoom]', st).forEach((im) => (im.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`))
    );
  const clamp = (st) => {
    z.x = Math.min(0, Math.max(st.clientWidth * (1 - z.s), z.x));
    z.y = Math.min(0, Math.max(st.clientHeight * (1 - z.s), z.y));
  };
  const zoomAt = (st, px, py, f) => {
    const s2 = Math.min(12, Math.max(1, z.s * f));
    const k = s2 / z.s;
    z.x = px - (px - z.x) * k;
    z.y = py - (py - z.y) * k;
    z.s = s2;
    clamp(st);
    apply();
  };
  stages.forEach((st) => {
    const ptrs = new Map();
    st.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = st.getBoundingClientRect();
      zoomAt(st, e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    }, { passive: false });
    st.addEventListener('pointerdown', (e) => {
      st.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    st.addEventListener('pointermove', (e) => {
      const prev = ptrs.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      if (ptrs.size === 1 && z.s > 1) {
        z.x += cur.x - prev.x;
        z.y += cur.y - prev.y;
        clamp(st);
        apply();
      } else if (ptrs.size === 2) {
        const other = [...ptrs.entries()].find(([id]) => id !== e.pointerId)[1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
        const r = st.getBoundingClientRect();
        if (d0 > 0) zoomAt(st, (cur.x + other.x) / 2 - r.left, (cur.y + other.y) / 2 - r.top, d1 / d0);
      }
      ptrs.set(e.pointerId, cur);
    });
    const end = (e) => ptrs.delete(e.pointerId);
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
    st.addEventListener('dblclick', () => ((z.s = 1), (z.x = 0), (z.y = 0), apply()));
  });
  return {
    reset() { z.s = 1; z.x = 0; z.y = 0; apply(); },
    by(f) { const st = stages[0]; zoomAt(st, st.clientWidth / 2, st.clientHeight / 2, f); },
  };
}

function sessionFor(openedAt) {
  const h = Number((openedAt || '').slice(11, 13));
  if (isNaN(h) || !state.settings) return '';
  const s = state.settings.sessions;
  const list = [['Asia', s.asia], ['London', s.london], ['New York', s.newyork]].sort((a, b) => a[1] - b[1]);
  let pick = list[list.length - 1][0]; // before the first start hour = the last session of the day before
  for (const [name, start] of list) if (h >= start) pick = name;
  return pick;
}

/* =========================================================
   Copy image (Ctrl+C / buttons), lightbox
   ========================================================= */
async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('convert'))), 'image/png'));
}

async function copyImage(file) {
  const url = imgUrl(file);
  const canCopy = window.isSecureContext && navigator.clipboard && window.ClipboardItem;
  if (!canCopy) {
    window.open(url, '_blank');
    toast('Your browser blocks copying on this link. The image opened: press and hold it to copy or save.', true);
    return;
  }
  try {
    const pngPromise = fetch(url).then((r) => r.blob()).then((b) => (b.type === 'image/png' ? b : toPng(b)));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
    toast('Image copied. Press Ctrl+V where you want it.');
  } catch (e) {
    toast('Could not copy this image. Use "Open" and save it instead.', true);
  }
}

const lb = { files: [], i: 0, caps: {} };
const lbZoom = makeZoom([$('#lb-stage')]);
function openLightbox(files, i, title, caps) {
  lb.files = files;
  lb.i = i;
  lb.title = title || '';
  lb.caps = caps || {};
  drawLightbox();
  const d = $('#lightbox');
  if (!d.open) d.showModal();
}
function drawLightbox() {
  const f = lb.files[lb.i];
  $('#lb-img').src = imgUrl(f);
  $('#lb-img').dataset.file = f;
  $('#lb-open').href = imgUrl(f);
  const cap = lb.caps[f] ? ' - ' + lb.caps[f] : '';
  $('#lb-title').textContent = (lb.title || '') + cap + (lb.files.length > 1 ? `  (${lb.i + 1} of ${lb.files.length})` : '');
  $('#lb-prev').hidden = $('#lb-next').hidden = lb.files.length < 2;
  lbZoom.reset();
}
$('#lb-zin').onclick = () => lbZoom.by(1.4);
$('#lb-zout').onclick = () => lbZoom.by(1 / 1.4);
$('#lb-fit').onclick = () => lbZoom.reset();
const lbStep = (n) => {
  lb.i = (lb.i + n + lb.files.length) % lb.files.length;
  drawLightbox();
};
$('#lb-close').onclick = () => $('#lightbox').close();
$('#lb-prev').onclick = () => lbStep(-1);
$('#lb-next').onclick = () => lbStep(1);
$('#lb-copy').onclick = () => copyImage(lb.files[lb.i]);
$('#lightbox').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox') e.target.close();
});

// The image the person points at (hover) or has focused — used for Ctrl+C.
let hoverFile = null;
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest && e.target.closest('[data-file]');
  hoverFile = el ? el.dataset.file : null;
});
document.addEventListener('keydown', (e) => {
  const dlg = $('#lightbox');
  if (dlg.open) {
    if (e.key === 'ArrowLeft' && lb.files.length > 1) lbStep(-1);
    if (e.key === 'ArrowRight' && lb.files.length > 1) lbStep(1);
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ($('#annot').open) return;
    if (String(window.getSelection && window.getSelection()).length) return;
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-file]');
    const file = dlg.open ? lb.files[lb.i] : focused ? focused.dataset.file : hoverFile;
    if (file) {
      e.preventDefault();
      copyImage(file);
    }
  }
});

/* =========================================================
   Router
   ========================================================= */
let cleanupView = null;
function route() {
  if (cleanupView) {
    cleanupView();
    cleanupView = null;
  }
  const [, page = 'journal', arg] = location.hash.split('/');
  $$('.nav').forEach((a) => a.classList.toggle('on', a.dataset.route === (page === 'edit' || page === 'trade' || page === 'replay' ? 'journal' : page)));
  window.scrollTo(0, 0);
  if (page === 'add') return viewForm(null, arg === 'from' ? location.hash.split('/')[3] : null);
  if (page === 'edit') return viewForm(state.trades.find((t) => t.id === arg));
  if (page === 'trade') return viewDetail(state.trades.find((t) => t.id === arg));
  if (page === 'replay') return viewReplay(state.trades.find((t) => t.id === arg));
  if (page === 'review') return viewReview();
  if (page === 'setups') return viewSetups();
  if (page === 'stats') return viewStats();
  if (page === 'insights') return viewInsights();
  if (page === 'settings') return viewSettings();
  if (page === 'admin') return viewAdmin();
  if (page === 'analysis') return viewAnalysis(arg, location.hash.split('/')[3]);
  if (page === 'buffer') return viewBuffer();
  return viewJournal();
}
window.addEventListener('hashchange', route);

async function boot() {
  let me = null;
  try {
    me = await fetch('/api/auth/me').then((r) => r.json());
  } catch (e) {
    view.innerHTML = `<div class="empty-state"><h2>Cannot reach the journal server</h2><p>Make sure the server window is still open, then refresh this page.</p></div>`;
    document.body.classList.remove('logged-out');
    return;
  }
  if (!me.user) return showAuth(me);
  state.user = me.user;
  document.body.classList.remove('logged-out');
  renderUserMenu(me.user);
  try {
    [state.trades, state.settings, state.config] = await Promise.all([api('/trades'), api('/settings'), api('/config')]);
    state.trades.forEach(normTrade);
    state.settings.rules = state.settings.rules || [];
  } catch (e) {
    view.innerHTML = `<div class="empty-state"><h2>Cannot reach the journal server</h2><p>Make sure the server window is still open, then refresh this page.</p></div>`;
    return;
  }
  route();
}

/* =========================================================
   Journal list
   ========================================================= */
const filters = { symbol: '', session: '', result: '', side: '', strategy: '', from: '', to: '', q: '' };
window.__edgeFilters = filters;
window.__edgeApplyFilters = (next = {}) => { Object.assign(filters, next); location.hash = '#/journal'; };

function applyFilters(list) {
  return list
    .filter((t) => {
      if (filters.symbol && t.symbol !== filters.symbol) return false;
      if (filters.session && t.session !== filters.session) return false;
      if (filters.side && t.side !== filters.side) return false;
      if (filters.strategy && t.strategy !== filters.strategy) return false;
      if (filters.result === 'win' && !(isClosed(t) && t.pnl > 0)) return false;
      if (filters.result === 'loss' && !(isClosed(t) && t.pnl < 0)) return false;
      if (filters.result === 'open' && isClosed(t)) return false;
      const d = dayKey(t);
      if (filters.from && d < filters.from) return false;
      if (filters.to && d > filters.to) return false;
      if (filters.q) {
        const hay = [t.symbol, t.strategy, t.notes.why, t.notes.feelings, t.notes.lesson, ...t.mistakes].join(' ').toLowerCase();
        if (!hay.includes(filters.q.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''));
}

function thumb(file, label) {
  return file
    ? `<span class="th"><img loading="lazy" src="${imgUrl(file)}" alt="${label} screenshot"><i>${label}</i></span>`
    : `<span class="th none"><span>No ${label.toLowerCase()} shot</span></span>`;
}

function tradeRow(t) {
  const closed = isClosed(t);
  const nOk = t.rulesChecked.length;
  const nAll = t.rulesAll.length;
  const rulesChip = nAll ? `<span class="chip ${nOk === nAll ? 'ok' : ''}">${nOk}/${nAll} rules</span>` : '';
  const chips = rulesChip + t.mistakes.map((m) => `<span class="chip warn">${esc(m)}</span>`).join('');
  return `<div class="trade">
    <div class="shots">${thumb(t.images.before[0], 'Before')}${thumb(t.images.after[0], 'After')}</div>
    <div>
      <div class="top"><a class="go" href="#/trade/${t.id}"><span class="sym">${esc(t.symbol)}</span></a><span class="side ${t.side}">${t.side}</span>${closed ? '' : '<span class="badge">Open</span>'}</div>
      <div class="meta"><span>${fmtDateTime(t.openedAt)}</span>${t.session ? `<span>${esc(t.session)}</span>` : ''}${t.strategy ? `<span>${esc(t.strategy)}</span>` : ''}</div>
      ${chips ? `<div class="chips">${chips}</div>` : ''}
    </div>
    <div class="res">
      <div class="big ${signClass(t.pnl)}">${closed ? money(t.pnl, true) : '–'}</div>
      <div class="small">${isNum(t.r) ? fmtNum(t.r) + ' R' : ''}${isNum(t.r) && isNum(t.pips) ? '  ' : ''}${isNum(t.pips) ? fmtNum(t.pips, 1) + ' pips' : ''}</div>
      ${closed ? '' : `<button class="btn small gold" data-close="${t.id}">Close now</button>`}
    </div>
  </div>`;
}

function viewJournal() {
  const symbols = [...new Set([...state.settings.pairs.map((p) => p.symbol), ...state.trades.map((t) => t.symbol)])];
  const strategies = [...new Set(state.trades.map((t) => t.strategy).filter(Boolean))].sort();
  const opt = (list, cur) => list.map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const hasFilter = Object.values(filters).some(Boolean);

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Journal</h1><p class="sub" id="count"></p></div>
      <a class="btn gold" href="#/add">Add trade</a>
    </div>
    <details class="filters" ${hasFilter ? 'open' : ''}>
      <summary>Filters${hasFilter ? ' (on)' : ''}</summary>
      <div class="filter-grid">
        <label class="f">Pair<select data-f="symbol"><option value="">All</option>${opt(symbols, filters.symbol)}</select></label>
        <label class="f">Session<select data-f="session"><option value="">All</option>${opt(['Asia', 'London', 'New York'], filters.session)}</select></label>
        <label class="f">Result<select data-f="result">
          <option value="">All</option>
          <option value="win" ${filters.result === 'win' ? 'selected' : ''}>Wins</option>
          <option value="loss" ${filters.result === 'loss' ? 'selected' : ''}>Losses</option>
          <option value="open" ${filters.result === 'open' ? 'selected' : ''}>Open</option></select></label>
        <label class="f">Buy / Sell<select data-f="side"><option value="">All</option>${opt(['Buy', 'Sell'], filters.side)}</select></label>
        <label class="f">Strategy<select data-f="strategy"><option value="">All</option>${opt(strategies, filters.strategy)}</select></label>
        <label class="f">From<input type="date" data-f="from" value="${esc(filters.from)}"></label>
        <label class="f">To<input type="date" data-f="to" value="${esc(filters.to)}"></label>
        <label class="f">Search notes<input type="search" data-f="q" placeholder="Words in notes" value="${esc(filters.q)}"></label>
        <button class="btn" id="clear-filters" ${hasFilter ? '' : 'disabled'}>Clear filters</button>
      </div>
    </details>
    <div class="summary-strip" id="strip"></div>
    <div class="trades" id="list"></div>`;

  const paint = () => {
    const list = applyFilters(state.trades);
    const closed = list.filter(isClosed);
    const net = sum(closed.map((t) => t.pnl));
    const wins = closed.filter((t) => t.pnl > 0).length;
    $('#count').textContent = `${state.trades.length} trade${state.trades.length === 1 ? '' : 's'} saved`;
    $('#strip').innerHTML = list.length
      ? `<span>Showing<b>${list.length}</b></span><span>Net result<b class="${signClass(net)}">${money(net, true)}</b></span><span>Win rate<b>${closed.length ? Math.round((wins / closed.length) * 100) + '%' : '–'}</b></span>`
      : '';
    $('#list').innerHTML = list.length
      ? list.map(tradeRow).join('')
      : state.trades.length
        ? `<div class="empty-state"><h2>No trades match these filters</h2><p>Change or clear the filters to see more.</p></div>`
        : `<div class="empty-state"><h2>Your journal is empty</h2><p>Take a screenshot before you enter a trade, press Ctrl+V on the Add trade page, and it is saved.</p><a class="btn gold" href="#/add">Add your first trade</a></div>`;
  };
  paint();
  $('#list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-close]');
    if (b) openQuickClose(state.trades.find((t) => t.id === b.dataset.close));
  });

  $$('[data-f]').forEach((el) =>
    el.addEventListener('input', () => {
      filters[el.dataset.f] = el.value;
      paint();
      const on = Object.values(filters).some(Boolean);
      $('#clear-filters').disabled = !on;
      $('.filters summary').textContent = 'Filters' + (on ? ' (on)' : '');
    })
  );
  $('#clear-filters').onclick = () => {
    Object.keys(filters).forEach((k) => (filters[k] = ''));
    viewJournal();
  };
}

/* =========================================================
   Trade detail
   ========================================================= */
function balanceBefore(t) {
  const prior = state.trades.filter((x) => x.id !== t.id && isClosed(x) && closeTime(x) < closeTime(t));
  return state.settings.startingBalance + sum(prior.map((x) => x.pnl));
}

function viewDetail(t) {
  if (!t) {
    view.innerHTML = `<div class="empty-state"><h2>Trade not found</h2><a class="btn" href="#/journal">Back to journal</a></div>`;
    return;
  }
  const closed = isClosed(t);
  const shotCol = (kind, label) => {
    const files = t.images[kind];
    return `<div class="shot-col"><h3>${label}</h3>${
      files.length
        ? files
            .map(
              (f, i) => `<figure class="shot" style="margin:0 0 10px" data-file="${esc(f)}" data-kind="${kind}" data-i="${i}" tabindex="0" aria-label="${label} screenshot ${i + 1}">
              <div class="imgbox"><img src="${imgUrl(f)}" alt="${label} screenshot ${i + 1}">
              <div class="tools"><button class="btn small gold" data-copy>Copy</button></div></div>
              ${t.captions[f] ? `<figcaption class="cap-text">${esc(t.captions[f])}</figcaption>` : ''}</figure>`
            )
            .join('')
        : `<div class="none">No ${label.toLowerCase()} screenshot yet</div>`
    }</div>`;
  };
  let riskPct = '';
  if (isNum(t.riskUsd)) {
    const bal = balanceBefore(t);
    if (bal > 0) riskPct = round((t.riskUsd / bal) * 100, 2) + '% of balance';
  }
  const fact = (label, val, cls = '') => (val === '' || val == null || val === '–' ? '' : `<div class="fact"><span>${label}</span><b class="${cls}">${esc(val)}</b></div>`);
  const note = (h, v) => (v ? `<div class="note"><h3>${h}</h3><p>${esc(v)}</p></div>` : '');
  const rulesBlock = t.rulesAll.length
    ? `<div class="note"><h3>Rules: ${t.rulesChecked.length} of ${t.rulesAll.length} followed</h3><ul class="rules">${t.rulesAll
        .map((r) => {
          const ok = t.rulesChecked.includes(r);
          return `<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '✓' : '✗'}</span><span class="sr">${ok ? 'Followed: ' : 'Not followed: '}</span>${esc(r)}</li>`;
        })
        .join('')}</ul></div>`
    : '';
  const both = t.images.before.length && t.images.after.length;

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${esc(t.symbol)} <span class="side ${t.side}" style="vertical-align:middle">${t.side}</span> ${closed ? '' : '<span class="badge" style="vertical-align:middle">Open</span>'}</h1>
        <p class="sub">${fmtDateTime(t.openedAt)}${t.session ? ' – ' + esc(t.session) + ' session' : ''}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="#/journal">Back</a>
        ${both ? '<button class="btn" id="cmp-open">Compare before and after</button>' : ''}
        <a class="btn" href="#/replay/${t.id}">Trade replay</a>
        <a class="btn" href="#/add/from/${t.id}">Use as template</a>
        ${closed ? '' : '<button class="btn gold" id="close-now">Close now</button>'}
        <a class="btn ${closed ? 'gold' : ''}" href="#/edit/${t.id}">Edit</a>
        <button class="btn danger" id="del">Delete</button>
      </div>
    </div>
    <div class="detail-shots">${shotCol('before', 'Before the trade')}${shotCol('after', 'After the trade')}</div>
    <div class="card section">
      <div class="facts">
        ${fact('Result', closed ? money(t.pnl, true) : '', signClass(t.pnl))}
        ${fact('R multiple', isNum(t.r) ? fmtNum(t.r) + ' R' : '', signClass(t.r))}
        ${fact('Pips / points', isNum(t.pips) ? fmtNum(t.pips, 1) : '', signClass(t.pips))}
        ${fact('Entry', isNum(t.entry) ? String(t.entry) : '')}
        ${fact('Stop loss', isNum(t.sl) ? String(t.sl) : '')}
        ${fact('Take profit', isNum(t.tp) ? String(t.tp) : '')}
        ${fact('Exit', isNum(t.exit) ? String(t.exit) : '')}
        ${fact('Lot size', isNum(t.lots) ? String(t.lots) : '')}
        ${fact('Risk', isNum(t.riskUsd) ? money(t.riskUsd) + (riskPct ? ' (' + riskPct + ')' : '') : '')}
        ${fact('Strategy', t.strategy)}
        ${fact('Closed', t.closedAt ? fmtDateTime(t.closedAt) : '')}
      </div>
      ${t.mistakes.length ? `<div class="chips" style="margin-top:16px">${t.mistakes.map((m) => `<span class="chip warn">${esc(m)}</span>`).join('')}</div>` : ''}
      ${rulesBlock}
      ${note('Why I took this trade', t.notes.why)}${note('How I felt', t.notes.feelings)}${note('What I learned', t.notes.lesson)}
      <div class="case-study">
        <div class="case-step"><span>01</span><b>SETUP</b><em>${esc(t.strategy || 'No setup recorded')}</em></div>
        <div class="case-line"></div>
        <div class="case-step"><span>02</span><b>EXECUTION</b><em>${t.rulesAll.length ? `${t.rulesChecked.length}/${t.rulesAll.length} rules followed` : 'No rules recorded'}</em></div>
        <div class="case-line"></div>
        <div class="case-step"><span>03</span><b>OUTCOME</b><em class="${signClass(t.pnl)}">${closed ? money(t.pnl, true) + (isNum(t.r) ? ` · ${fmtNum(t.r)}R` : '') : 'Trade still open'}</em></div>
        <div class="case-line"></div>
        <div class="case-step"><span>04</span><b>LESSON</b><em>${esc(t.notes.lesson || (t.mistakes.length ? t.mistakes[0] : 'Add a lesson after reviewing this trade'))}</em></div>
      </div>
    </div>`;

  view.onclick = (e) => {
    const fig = e.target.closest('figure[data-file]');
    if (!fig) return;
    if (e.target.closest('[data-copy]')) return copyImage(fig.dataset.file);
    const kind = fig.dataset.kind;
    openLightbox(t.images[kind], Number(fig.dataset.i), kind === 'before' ? 'Before' : 'After', t.captions);
  };
  cleanupView = () => (view.onclick = null);
  const cmp = $('#cmp-open');
  if (cmp) cmp.onclick = () => openCompare(t);
  const cn = $('#close-now');
  if (cn) cn.onclick = () => openQuickClose(t);
  $('#del').onclick = async () => {
    if (!confirm('Delete this trade and its screenshots from your folder? This cannot be undone.')) return;
    try {
      await api('/trades/' + t.id, 'DELETE');
      state.trades = state.trades.filter((x) => x.id !== t.id);
      toast('Trade deleted');
      location.hash = '#/journal';
    } catch (e) {
      toast(e.message, true);
    }
  };
}

/* =========================================================
   Add / edit trade (paste zones + form)
   ========================================================= */
let form = null; // { draft, active, fresh:Set, manual:{pips,r,session}, editingId }

function blankDraft() {
  const now = localInput();
  return {
    openedAt: now, closedAt: '', symbol: state.settings.pairs[0]?.symbol || 'XAUUSD', side: 'Buy',
    entry: null, sl: null, tp: null, exit: null, lots: null, riskUsd: null, pnl: null, pips: null, r: null,
    strategy: '', session: sessionFor(now), mistakes: [], captions: {},
    rulesAll: [...state.settings.rules], rulesChecked: [],
    notes: { why: '', feelings: '', lesson: '' }, images: { before: [], after: [] },
  };
}
const nv = (v) => (isNum(v) ? v : '');

function viewForm(existing, templateId) {
  const editing = !!existing;
  if (location.hash.startsWith('#/edit') && !existing) {
    view.innerHTML = `<div class="empty-state"><h2>Trade not found</h2><a class="btn" href="#/journal">Back to journal</a></div>`;
    return;
  }
  const draft = editing ? JSON.parse(JSON.stringify(existing)) : blankDraft();
  normTrade(draft);
  const tpl = !editing && templateId ? state.trades.find((t) => t.id === templateId) : null;
  if (tpl) {
    draft.symbol = tpl.symbol;
    draft.side = tpl.side;
    draft.strategy = tpl.strategy;
    draft.lots = tpl.lots;
    draft.riskUsd = tpl.riskUsd;
  }
  if (!draft.rulesAll.length) draft.rulesAll = [...state.settings.rules];
  form = {
    draft, active: draft.images.before.length && !draft.images.after.length ? 'after' : 'before',
    fresh: new Set(), uploading: 0, editingId: editing ? existing.id : null,
    manual: { pips: editing && isNum(draft.pips), r: editing && isNum(draft.r), session: editing && !!draft.session },
    saved: false, rulesTouched: false, hadRules: editing && existing.rulesAll.length > 0,
  };
  const strategies = [...new Set(state.trades.map((t) => t.strategy).filter(Boolean))].sort();
  const pairs = state.settings.pairs.map((p) => p.symbol);
  if (!pairs.includes(draft.symbol)) pairs.push(draft.symbol);
  const d = draft;
  const recent = [...state.trades].sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || '')).slice(0, 12);

  view.innerHTML = `
    <div class="page-head">
      <div><h1>${editing ? 'Edit trade' : 'Add trade'}</h1>
      <p class="sub">${tpl ? `Pair, direction, strategy, lot size and risk are copied from your ${esc(tpl.symbol)} ${tpl.side} trade. Change anything you need.` : 'Take a screenshot (Win + Shift + S), click Before or After, then press Ctrl+V.'}</p></div>
      ${!editing && recent.length ? `<label class="f" style="min-width:min(300px,100%)">Start from an earlier trade<select id="tplSel">
        <option value="">Empty form</option>
        ${recent.map((t) => `<option value="${t.id}" ${tpl && t.id === tpl.id ? 'selected' : ''}>${esc(t.symbol)} ${t.side}, ${fmtDateTime(t.openedAt)}${t.strategy ? ' - ' + esc(t.strategy) : ''}</option>`).join('')}
      </select></label>` : ''}
    </div>
    <div class="zones" id="zones"></div>
    <form id="tradeForm" autocomplete="off">
      <div class="card section">
        <h2>The trade</h2>
        <div class="grid g4">
          <label class="f">Pair<select name="symbol">${pairs.map((p) => `<option ${p === d.symbol ? 'selected' : ''}>${esc(p)}</option>`).join('')}<option value="__new">Other pair...</option></select></label>
          <div class="f">Buy or Sell
            <div class="side-toggle" role="radiogroup" aria-label="Buy or Sell">
              <label><input type="radio" name="side" value="Buy" ${d.side === 'Buy' ? 'checked' : ''}><span class="b">Buy</span></label>
              <label><input type="radio" name="side" value="Sell" ${d.side === 'Sell' ? 'checked' : ''}><span class="s">Sell</span></label>
            </div>
          </div>
          <label class="f">Opened<input type="datetime-local" name="openedAt" value="${esc(d.openedAt)}" required></label>
          <label class="f">Closed (when it ends)<input type="datetime-local" name="closedAt" value="${esc(d.closedAt)}"></label>
        </div>
      </div>

      <div class="card section">
        <h2>Prices and size</h2>
        <div class="grid g3" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
          <label class="f">Entry price<input name="entry" inputmode="decimal" value="${nv(d.entry)}"></label>
          <label class="f">Stop loss<input name="sl" inputmode="decimal" value="${nv(d.sl)}"></label>
          <label class="f">Take profit<input name="tp" inputmode="decimal" value="${nv(d.tp)}"></label>
          <label class="f">Exit price<input name="exit" inputmode="decimal" value="${nv(d.exit)}"></label>
          <label class="f">Lot size<input name="lots" inputmode="decimal" value="${nv(d.lots)}"></label>
          <label class="f">Money at risk ($)<input name="riskUsd" inputmode="decimal" value="${nv(d.riskUsd)}"></label>
        </div>
      </div>

      <div class="card section">
        <h2>Result</h2>
        <div class="grid g3" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
          <label class="f">Profit or loss ($)<input name="pnl" inputmode="decimal" value="${nv(d.pnl)}" placeholder="Example: 45 or -25"></label>
          <label class="f">Pips / points<input name="pips" inputmode="decimal" value="${nv(d.pips)}"></label>
          <label class="f">R multiple<input name="r" inputmode="decimal" value="${nv(d.r)}"></label>
        </div>
        <p class="hint" style="margin-top:10px">Use a minus sign for a loss. Leave the result empty if the trade is still open. Pips and R fill in by themselves from your prices and risk, and you can type your own numbers instead.</p>
      </div>

      <div class="card section">
        <h2>Context</h2>
        <div class="grid g2">
          <label class="f">Strategy or setup<input name="strategy" list="strategies" value="${esc(d.strategy)}" placeholder="Example: Break and retest">
            <datalist id="strategies">${strategies.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>
          <label class="f">Session<select name="session">
            <option value="">Not set</option>
            ${['Asia', 'London', 'New York'].map((s) => `<option ${s === d.session ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        </div>
        <h3 style="margin:18px 0 10px">Mistakes <span class="hint">(pick any that happened)</span></h3>
        <div class="tag-pick" id="tags"></div>
        <div class="tag-add"><input id="newTag" placeholder="Add your own mistake" maxlength="40"><button type="button" class="btn" id="addTag">Add</button></div>
      </div>

      ${d.rulesAll.length ? `<div class="card section">
        <h2>My rules <span class="hint" id="ruleCount" style="margin-left:8px"></span></h2>
        <div class="rule-pick" id="rules"></div>
        <p class="hint" style="margin-top:10px">Tick every rule you followed. If you do not touch the boxes at all, this trade is not counted in your rule stats. Change the list in Settings.</p>
      </div>` : ''}

      <div class="card section">
        <h2>Notes</h2>
        <div class="grid">
          <label class="f">Why did I take this trade?<textarea name="why">${esc(d.notes.why)}</textarea></label>
          <label class="f">How did I feel?<textarea name="feelings">${esc(d.notes.feelings)}</textarea></label>
          <label class="f">What did I learn?<textarea name="lesson">${esc(d.notes.lesson)}</textarea></label>
        </div>
      </div>

      <div class="savebar">
        <span class="error" id="formError" role="alert"></span>
        <button type="button" class="btn" id="cancel">Cancel</button>
        <button type="submit" class="btn gold" id="save">Save trade</button>
      </div>
    </form>`;

  paintZones();
  paintTags();
  paintRules();
  wireForm();
  const sel = $('#tplSel');
  if (sel) sel.onchange = () => (location.hash = sel.value ? '#/add/from/' + sel.value : '#/add');
  cleanupView = () => {
    // Remove pasted images that were never saved.
    if (form && !form.saved) form.fresh.forEach((f) => api('/images/' + encodeURIComponent(f), 'DELETE').catch(() => {}));
    form = null;
  };
}

function paintZones() {
  const z = $('#zones');
  if (!z || !form) return;
  const one = (kind, title, tip) => {
    const files = form.draft.images[kind];
    const loading = form.uploading && form.active === kind ? '<div class="thumb loading">Saving...</div>' : '';
    return `<section class="zone ${form.active === kind ? 'active' : ''}" data-kind="${kind}" tabindex="0" aria-label="${title} screenshots. Press Ctrl+V to paste.">
      <div class="zone-head"><h3>${title}</h3><span class="hint">${form.active === kind ? 'Ready. Press Ctrl+V now' : 'Click here to paste ' + title.toLowerCase()}</span></div>
      ${files.length || loading ? `<div class="thumbs">${files.map((f, i) => `
        <figure class="thumb" style="margin:0" data-file="${esc(f)}" data-i="${i}" tabindex="0" aria-label="${title} screenshot ${i + 1}">
          <div class="imgbox"><img src="${imgUrl(f)}" alt="${title} screenshot ${i + 1}">
            <div class="tools"><button type="button" class="btn small gold" data-copy>Copy</button><button type="button" class="btn small" data-draw>Draw</button><button type="button" class="btn small danger" data-remove>Remove</button></div></div>
          <input class="cap" data-cap maxlength="80" placeholder="Label (example: 1H chart)" aria-label="Label for ${title} screenshot ${i + 1}" value="${esc(form.draft.captions[f] || '')}">
        </figure>`).join('')}${loading}</div>` : `<div class="zone-empty"><div>${tip}</div></div>`}
      <div class="zone-foot"><label class="btn small">Add photo or file<input type="file" accept="image/*" multiple hidden></label></div>
    </section>`;
  };
  z.innerHTML =
    one('before', 'Before', form.mode === 'analysis' ? '<b>Your analysis</b><br>Press Win + Shift + S, select your chart, then press Ctrl+V.' : '<b>Before you enter the trade</b><br>Press Win + Shift + S, select your chart, then press Ctrl+V.') +
    one('after', 'After', form.mode === 'analysis' ? '<b>What happened</b><br>Take the screenshot the same way, then press Ctrl+V.' : '<b>After the trade is closed</b><br>Take the screenshot the same way, then press Ctrl+V.');
}

function paintTags() {
  const el = $('#tags');
  if (!el || !form) return;
  const used = state.trades.flatMap((t) => t.mistakes);
  const all = [...new Set([...PRESET_MISTAKES, ...used, ...form.draft.mistakes])];
  el.innerHTML = all
    .map((m) => `<label><input type="checkbox" value="${esc(m)}" ${form.draft.mistakes.includes(m) ? 'checked' : ''}><span>${esc(m)}</span></label>`)
    .join('');
}

function readNumbers() {
  const f = $('#tradeForm');
  const g = (n) => toNum(f.elements[n].value);
  return { entry: g('entry'), sl: g('sl'), tp: g('tp'), exit: g('exit'), lots: g('lots'), riskUsd: g('riskUsd'), pnl: g('pnl') };
}

function paintRules() {
  const el = $('#rules');
  if (!el || !form) return;
  const d = form.draft;
  el.innerHTML = d.rulesAll
    .map((r) => `<label><input type="checkbox" value="${esc(r)}" ${d.rulesChecked.includes(r) ? 'checked' : ''}><span>${esc(r)}</span></label>`)
    .join('');
  updateRuleCount();
}
function updateRuleCount() {
  const c = $('#ruleCount');
  if (c && form) c.textContent = `${form.draft.rulesChecked.length} of ${form.draft.rulesAll.length} followed`;
}

function autoFill() {
  if (!form) return;
  const f = $('#tradeForm');
  const tmp = { symbol: f.elements.symbol.value, side: f.elements.side.value, ...readNumbers() };
  if (!form.manual.pips) {
    const v = calcPips(tmp);
    f.elements.pips.value = v === null ? '' : v;
  }
  if (!form.manual.r) {
    const v = calcR(tmp);
    f.elements.r.value = v === null ? '' : v;
  }
}

function wireZones() {
  const zones = $('#zones');

  // Zones: choose where the next paste goes
  zones.addEventListener('click', (e) => {
    if (!form) return;
    if (e.target.closest('input[data-cap]')) return;
    const fig = e.target.closest('figure[data-file]');
    const zone = e.target.closest('.zone');
    if (fig && e.target.closest('[data-copy]')) return copyImage(fig.dataset.file);
    if (fig && e.target.closest('[data-draw]')) return openAnnotate(zone.dataset.kind, Number(fig.dataset.i));
    if (fig && e.target.closest('[data-remove]')) return removeImage(zone.dataset.kind, Number(fig.dataset.i));
    if (e.target.closest('label.btn')) return; // file picker
    if (fig && e.target.tagName === 'IMG') {
      const kind = zone.dataset.kind;
      return openLightbox(form.draft.images[kind], Number(fig.dataset.i), kind === 'before' ? 'Before' : 'After', form.draft.captions);
    }
    if (zone && form.active !== zone.dataset.kind) {
      form.active = zone.dataset.kind;
      paintZones();
    }
    if (zone) $(`.zone[data-kind="${zone.dataset.kind}"]`).focus({ preventScroll: true });
  });
  zones.addEventListener('input', (e) => {
    if (!e.target.matches('[data-cap]')) return;
    const fig = e.target.closest('figure[data-file]');
    if (fig) form.draft.captions[fig.dataset.file] = e.target.value;
  });
  zones.addEventListener('focusin', (e) => {
    const zone = e.target.closest('.zone');
    if (zone && form && form.active !== zone.dataset.kind && e.target === zone) {
      form.active = zone.dataset.kind;
      paintZones();
      $(`.zone[data-kind="${zone.dataset.kind}"]`).focus({ preventScroll: true });
    }
  });
  zones.addEventListener('change', (e) => {
    if (e.target.type !== 'file') return;
    const kind = e.target.closest('.zone').dataset.kind;
    [...e.target.files].forEach((file) => addImage(kind, file));
  });
  zones.addEventListener('dragover', (e) => {
    e.preventDefault();
    const z = e.target.closest('.zone');
    $$('.zone', zones).forEach((x) => x.classList.toggle('drag', x === z));
  });
  zones.addEventListener('dragleave', (e) => {
    if (!zones.contains(e.relatedTarget)) $$('.zone', zones).forEach((x) => x.classList.remove('drag'));
  });
  zones.addEventListener('drop', (e) => {
    e.preventDefault();
    $$('.zone', zones).forEach((x) => x.classList.remove('drag'));
    const z = e.target.closest('.zone');
    const files = [...(e.dataTransfer?.files || [])].filter((x) => x.type.startsWith('image/'));
    if (z && files.length) files.forEach((file) => addImage(z.dataset.kind, file));
  });
}

function wireForm() {
  const f = $('#tradeForm');
  wireZones();

  // Auto values
  f.addEventListener('input', (e) => {
    const name = e.target.name;
    if (name === 'pips' || name === 'r') form.manual[name] = e.target.value.trim() !== '';
    if (name === 'session') form.manual.session = true;
    if (name === 'openedAt' && !form.manual.session) f.elements.session.value = sessionFor(e.target.value);
    if (['entry', 'sl', 'exit', 'riskUsd', 'pnl', 'symbol', 'side'].includes(name)) autoFill();
  });
  f.elements.symbol.addEventListener('change', (e) => {
    if (e.target.value !== '__new') return;
    const name = (prompt('Type the pair name (example: US30):') || '').trim().toUpperCase().replace(/\s/g, '');
    if (name) {
      const o = new Option(name, name, true, true);
      e.target.add(o, e.target.options[e.target.options.length - 1]);
    } else e.target.selectedIndex = 0;
    autoFill();
  });

  // Mistake tags
  $('#tags').addEventListener('change', (e) => {
    const v = e.target.value;
    const m = form.draft.mistakes;
    if (e.target.checked && !m.includes(v)) m.push(v);
    if (!e.target.checked) form.draft.mistakes = m.filter((x) => x !== v);
  });
  const addTag = () => {
    const inp = $('#newTag');
    const v = inp.value.trim().slice(0, 40);
    if (!v) return;
    if (!form.draft.mistakes.includes(v)) form.draft.mistakes.push(v);
    inp.value = '';
    paintTags();
  };
  $('#addTag').onclick = addTag;
  $('#newTag').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  });

  // Rules checklist
  const rulesEl = $('#rules');
  if (rulesEl) {
    rulesEl.addEventListener('change', (e) => {
      form.rulesTouched = true;
      const v = e.target.value;
      if (e.target.checked && !form.draft.rulesChecked.includes(v)) form.draft.rulesChecked.push(v);
      if (!e.target.checked) form.draft.rulesChecked = form.draft.rulesChecked.filter((x) => x !== v);
      updateRuleCount();
    });
  }

  $('#cancel').onclick = () => {
    history.length > 1 && form.editingId ? (location.hash = '#/trade/' + form.editingId) : (location.hash = '#/journal');
  };
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
}

// Paste anywhere on the Add / Edit page (or into the "Close now" window)
document.addEventListener('paste', (e) => {
  const q = $('#quick').open;
  if ((!form && !q) || $('#annot').open) return;
  const cd = e.clipboardData;
  if (!cd) return;
  const files = [...cd.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
  if (!files.length) return;
  const t = e.target;
  const inText = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && cd.getData('text/plain');
  if (inText) return; // normal text paste
  e.preventDefault();
  files.forEach((file) => (q ? quickAddImage(file) : addImage(form.active, file)));
});

// Sends one image to the server, returns the saved file name
async function uploadBlob(kind, blob, symbol, date) {
  const res = await fetch(`/api/images?kind=${kind}&symbol=${encodeURIComponent(symbol || '')}&date=${encodeURIComponent(date || '')}`, {
    method: 'POST', headers: { 'Content-Type': blob.type }, body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save the image');
  return data.file;
}

function formMeta() {
  if (form && form.mode === 'analysis') {
    const a = $('#analysisForm');
    return { symbol: a.elements.symbol.value, date: a.elements.date.value || '' };
  }
  const f = $('#tradeForm');
  const sym = f.elements.symbol.value;
  return { symbol: sym === '__new' ? '' : sym, date: (f.elements.openedAt.value || '').slice(0, 10) };
}

async function addImage(kind, file) {
  if (!form || !file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('Please use a PNG, JPG, WEBP or GIF image.', true);
  const { symbol, date } = formMeta();
  form.active = kind;
  form.uploading++;
  paintZones();
  const mine = form;
  try {
    const name = await uploadBlob(kind, file, symbol, date);
    if (form !== mine) return api('/images/' + encodeURIComponent(name), 'DELETE').catch(() => {});
    form.draft.images[kind].push(name);
    form.fresh.add(name);
    // First Before screenshot done: move on to the After box so the next paste goes there
    const goAfter = kind === 'before' && !form.draft.images.after.length;
    if (goAfter) form.active = 'after';
    toast(goAfter ? 'Before saved. Now paste the After screenshot (Ctrl+V)' : `${kind === 'before' ? 'Before' : 'After'} screenshot saved`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (form === mine) {
      form.uploading--;
      paintZones();
    }
  }
}

function removeImage(kind, i) {
  const file = form.draft.images[kind][i];
  form.draft.images[kind].splice(i, 1);
  delete form.draft.captions[file];
  if (form.fresh.has(file)) {
    form.fresh.delete(file);
    api('/images/' + encodeURIComponent(file), 'DELETE').catch(() => {});
  }
  paintZones();
}

async function save() {
  const f = $('#tradeForm');
  const err = $('#formError');
  err.textContent = '';
  if (form.uploading) return (err.textContent = 'Wait a moment, an image is still saving.');
  const symbol = f.elements.symbol.value;
  if (!symbol || symbol === '__new') return (err.textContent = 'Choose a pair.');
  if (!f.elements.openedAt.value) return (err.textContent = 'Enter the time the trade opened.');
  const n = readNumbers();
  // If the person never touched the rules, the trade is not counted in rule stats.
  let rulesAll = form.draft.rulesAll;
  let rulesChecked = form.draft.rulesChecked;
  if (!form.rulesTouched && !rulesChecked.length && !form.hadRules) {
    rulesAll = [];
    rulesChecked = [];
  }
  const body = {
    symbol, side: f.elements.side.value, openedAt: f.elements.openedAt.value, closedAt: f.elements.closedAt.value,
    ...n, pips: toNum(f.elements.pips.value), r: toNum(f.elements.r.value),
    strategy: f.elements.strategy.value.trim(), session: f.elements.session.value,
    mistakes: form.draft.mistakes,
    notes: { why: f.elements.why.value.trim(), feelings: f.elements.feelings.value.trim(), lesson: f.elements.lesson.value.trim() },
    images: form.draft.images, captions: form.draft.captions, rulesAll, rulesChecked,
  };
  if (isNum(body.pnl) && !body.closedAt) body.closedAt = body.openedAt;
  if (body.closedAt && body.closedAt < body.openedAt) return (err.textContent = 'The close time is before the open time.');
  const btn = $('#save');
  btn.disabled = true;
  try {
    const saved = normTrade(form.editingId ? await api('/trades/' + form.editingId, 'PUT', body) : await api('/trades', 'POST', body));
    const i = state.trades.findIndex((t) => t.id === saved.id);
    if (i >= 0) state.trades[i] = saved;
    else state.trades.push(saved);
    form.saved = true;
    toast('Trade saved');
    location.hash = '#/trade/' + saved.id;
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
  }
}

/* =========================================================
   Stats
   ========================================================= */
const statsUi = { range: 'all', symbol: '', month: null };

function rangeStart(r) {
  const d = new Date();
  if (r === '30') d.setDate(d.getDate() - 30);
  else if (r === 'month') d.setDate(1);
  else if (r === 'year') d.setMonth(0, 1);
  else return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function summarize(list) {
  const c = list.filter(isClosed);
  const wins = c.filter((t) => t.pnl > 0);
  const losses = c.filter((t) => t.pnl < 0);
  const gp = sum(wins.map((t) => t.pnl));
  const gl = -sum(losses.map((t) => t.pnl));
  const rs = c.map((t) => t.r).filter(isNum);
  return {
    n: c.length, wins: wins.length, losses: losses.length,
    net: sum(c.map((t) => t.pnl)),
    winRate: c.length ? wins.length / c.length : null,
    avgWin: wins.length ? gp / wins.length : null,
    avgLoss: losses.length ? -gl / losses.length : null,
    pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : null,
    avgR: rs.length ? sum(rs) / rs.length : null,
    best: c.length ? Math.max(...c.map((t) => t.pnl)) : null,
    worst: c.length ? Math.min(...c.map((t) => t.pnl)) : null,
  };
}

function equitySeries(list) {
  const c = list.filter(isClosed).sort((a, b) => closeTime(a).localeCompare(closeTime(b)));
  let bal = state.settings.startingBalance;
  let peak = bal;
  let dd = 0;
  let ddPct = 0;
  const pts = [{ bal, label: 'Start', t: null }];
  c.forEach((t) => {
    bal += t.pnl;
    pts.push({ bal, label: fmtDateTime(closeTime(t)), t });
    peak = Math.max(peak, bal);
    dd = Math.max(dd, peak - bal);
    if (peak > 0) ddPct = Math.max(ddPct, ((peak - bal) / peak) * 100);
  });
  return { pts, dd, ddPct, bal };
}

function viewStats() {
  const symbols = [...new Set(state.trades.map((t) => t.symbol))];
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Stats</h1><p class="sub" id="statsSub"></p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label class="f">Period<select id="rangeSel">
          ${[['all', 'All time'], ['year', 'This year'], ['month', 'This month'], ['30', 'Last 30 days']].map(([v, l]) => `<option value="${v}" ${statsUi.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">Pair<select id="pairSel"><option value="">All pairs</option>${symbols.map((s) => `<option ${s === statsUi.symbol ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      </div>
    </div>
    <div id="statsBody"></div>`;
  $('#rangeSel').onchange = (e) => ((statsUi.range = e.target.value), paintStats());
  $('#pairSel').onchange = (e) => ((statsUi.symbol = e.target.value), paintStats());
  paintStats();
  const onResize = () => paintStats();
  window.addEventListener('resize', onResize);
  cleanupView = () => window.removeEventListener('resize', onResize);
}

function paintStats() {
  const from = rangeStart(statsUi.range);
  const list = state.trades.filter((t) => (!statsUi.symbol || t.symbol === statsUi.symbol) && (!from || dayKey(t) >= from));
  const s = summarize(list);
  const eq = equitySeries(list);
  const body = $('#statsBody');
  $('#statsSub').textContent = `${s.n} closed trade${s.n === 1 ? '' : 's'}`;

  if (!s.n) {
    body.innerHTML = `<div class="empty-state"><h2>No closed trades yet</h2><p>Add a result to a trade and your numbers appear here.</p><a class="btn gold" href="#/add">Add trade</a></div>`;
    return;
  }
  const kpi = (l, v, cls = '') => `<div class="kpi"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  body.innerHTML = `
    <div class="kpis">
      ${kpi('Net result', money(s.net, true), signClass(s.net))}
      ${kpi('Account balance', money(eq.bal))}
      ${kpi('Win rate', Math.round(s.winRate * 100) + '%')}
      ${kpi('Wins / losses', s.wins + ' / ' + s.losses)}
      ${kpi('Average win', money(s.avgWin), 'pos')}
      ${kpi('Average loss', money(s.avgLoss), 'neg')}
      ${kpi('Profit factor', s.pf === Infinity ? 'No losses' : isNum(s.pf) ? fmtNum(s.pf) : '–')}
      ${kpi('Average R', isNum(s.avgR) ? fmtNum(s.avgR) + ' R' : '–', signClass(s.avgR))}
      ${kpi('Best trade', money(s.best, true), 'pos')}
      ${kpi('Worst trade', money(s.worst, true), 'neg')}
      ${kpi('Biggest drop', money(-eq.dd) + (eq.ddPct ? ' (' + round(eq.ddPct, 1) + '%)' : ''), eq.dd ? 'neg' : '')}
    </div>
    <div class="card section"><h2>Equity curve</h2><div class="chart-wrap" id="chart"></div></div>
    <div class="card section"><div id="calendar"></div></div>
    <div class="card section" id="discipline"></div>
    <div class="grid g2">
      <div class="card section"><h2>By pair</h2><div class="tbl-scroll" id="byPair"></div></div>
      <div class="card section"><h2>By session</h2><div class="tbl-scroll" id="bySession"></div></div>
      <div class="card section"><h2>By strategy</h2><div class="tbl-scroll" id="byStrategy"></div></div>
      <div class="card section"><h2>Mistakes and what they cost</h2><div class="tbl-scroll" id="byMistake"></div></div>
    </div>`;
  drawEquity(eq);
  drawCalendar(list);
  drawDiscipline(list);
  breakdown('#byPair', list, (t) => [t.symbol]);
  breakdown('#bySession', list, (t) => [t.session || 'Not set']);
  breakdown('#byStrategy', list, (t) => [t.strategy || 'Not set']);
  breakdown('#byMistake', list, (t) => t.mistakes, 'No mistakes tagged yet. Tag them when you add a trade.');
}

function drawEquity(eq) {
  const host = $('#chart');
  const W = Math.max(300, host.clientWidth || 640);
  const H = W < 520 ? 220 : 280;
  const P = { l: 58, r: 14, t: 14, b: 26 };
  const vals = eq.pts.map((p) => p.bal);
  let lo = Math.min(...vals, state.settings.startingBalance);
  let hi = Math.max(...vals, state.settings.startingBalance);
  if (lo === hi) { lo -= 1; hi += 1; }
  const padY = (hi - lo) * 0.08;
  lo -= padY; hi += padY;
  const X = (i) => P.l + (eq.pts.length === 1 ? 0 : (i / (eq.pts.length - 1)) * (W - P.l - P.r));
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const line = eq.pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.bal).toFixed(1)}`).join('');
  const area = `${line}L${X(eq.pts.length - 1).toFixed(1)},${H - P.b}L${X(0).toFixed(1)},${H - P.b}Z`;
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4);
  const base = Y(state.settings.startingBalance);
  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Equity curve. Balance went from ${money(state.settings.startingBalance)} to ${money(eq.bal)}">
      ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#2c313a" stroke-width="1"/><text x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end" fill="#8e939d" font-size="11">${Math.round(v).toLocaleString('en-US')}</text>`).join('')}
      <line x1="${P.l}" x2="${W - P.r}" y1="${base}" y2="${base}" stroke="#8e939d" stroke-dasharray="4 4" stroke-width="1"/>
      <path d="${area}" fill="#d6a94a" fill-opacity=".1"/>
      <path d="${line}" fill="none" stroke="#d6a94a" stroke-width="2.2" stroke-linejoin="round"/>
      <text x="${P.l}" y="${H - 6}" fill="#8e939d" font-size="11">${esc(eq.pts[1] ? eq.pts[1].label.split(',')[0] : '')}</text>
      <text x="${W - P.r}" y="${H - 6}" text-anchor="end" fill="#8e939d" font-size="11">${esc(eq.pts[eq.pts.length - 1].label.split(',')[0])}</text>
      <line id="cx" y1="${P.t}" y2="${H - P.b}" stroke="#8e939d" stroke-width="1" visibility="hidden"/>
      <circle id="cd" r="4.5" fill="#d6a94a" stroke="#121418" stroke-width="2" visibility="hidden"/>
      <rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent" id="hit"/>
    </svg><div class="tip" id="tip" hidden></div>`;
  const svg = $('svg', host);
  const tip = $('#tip');
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(eq.pts.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (eq.pts.length - 1))));
    const p = eq.pts[i];
    $('#cx').setAttribute('x1', X(i)); $('#cx').setAttribute('x2', X(i)); $('#cx').setAttribute('visibility', 'visible');
    $('#cd').setAttribute('cx', X(i)); $('#cd').setAttribute('cy', Y(p.bal)); $('#cd').setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.style.left = (X(i) / W) * 100 + '%';
    tip.style.top = (Y(p.bal) / H) * r.height + 'px';
    tip.innerHTML = `<b>${money(p.bal)}</b><br>${p.t ? esc(p.t.symbol) + ' ' + money(p.t.pnl, true) + '<br>' : ''}${esc(p.label)}`;
  };
  const leave = () => { tip.hidden = true; $('#cx').setAttribute('visibility', 'hidden'); $('#cd').setAttribute('visibility', 'hidden'); };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('mouseleave', leave);
}

function drawCalendar(list) {
  const host = $('#calendar');
  const closed = list.filter(isClosed);
  const byDay = {};
  closed.forEach((t) => {
    const k = dayKey(t);
    (byDay[k] = byDay[k] || { pnl: 0, n: 0 });
    byDay[k].pnl += t.pnl;
    byDay[k].n++;
  });
  if (!statsUi.month) {
    const last = closed.map(dayKey).sort().pop() || localInput().slice(0, 10);
    statsUi.month = { y: Number(last.slice(0, 4)), m: Number(last.slice(5, 7)) - 1 };
  }
  const { y, m } = statsUi.month;
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const start = new Date(y, m, 1 - lead);
  const monthKeys = Object.keys(byDay).filter((k) => k.startsWith(`${y}-${pad(m + 1)}`));
  const maxAbs = Math.max(1, ...monthKeys.map((k) => Math.abs(byDay[k].pnl)));
  const monthNet = sum(monthKeys.map((k) => byDay[k].pnl));
  let cells = '';
  for (let w = 0; w < 6; w++) {
    let weekNet = 0;
    let weekN = 0;
    let any = false;
    let row = '';
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const inMonth = date.getMonth() === m;
      const info = byDay[key];
      if (inMonth) any = true;
      if (info && inMonth) { weekNet += info.pnl; weekN += info.n; }
      const alpha = info ? 0.12 + 0.4 * (Math.abs(info.pnl) / maxAbs) : 0;
      const bg = info ? (info.pnl >= 0 ? `rgba(82,196,143,${alpha})` : `rgba(234,106,98,${alpha})`) : '';
      const inner = `<span class="d">${date.getDate()}</span>${info ? `<span class="v ${signClass(info.pnl)}">${money(info.pnl, true).replace('.00', '')}</span><span class="c">${info.n} trade${info.n > 1 ? 's' : ''}</span>` : ''}`;
      row += info && inMonth
        ? `<a class="day" style="background:${bg}" href="#/journal" data-day="${key}" title="Show trades from ${fmtDay(key)}">${inner}</a>`
        : `<div class="day ${inMonth ? '' : 'out'}">${inner}</div>`;
    }
    if (!any) continue; // skip a week row that has no day of this month
    row += `<div class="day wk"><span class="d">Week ${Math.round(cells.split('class="day wk"').length)}</span>${weekN ? `<span class="v ${signClass(weekNet)}">${money(weekNet, true).replace('.00', '')}</span><span class="c">${weekN} trade${weekN > 1 ? 's' : ''}</span>` : ''}</div>`;
    cells += row;
  }
  host.innerHTML = `
    <div class="cal-head">
      <h2>${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} <span class="${signClass(monthNet)}" style="font-weight:600;font-size:15px;margin-left:8px">${monthKeys.length ? money(monthNet, true) : ''}</span></h2>
      <div style="display:flex;gap:6px"><button class="btn small" id="calPrev" aria-label="Previous month">&larr;</button><button class="btn small" id="calNext" aria-label="Next month">&rarr;</button></div>
    </div>
    <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('')}<div class="dow wk-h">Week total</div>${cells}</div>`;
  $('#calPrev').onclick = () => { statsUi.month = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }; drawCalendar(list); };
  $('#calNext').onclick = () => { statsUi.month = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }; drawCalendar(list); };
  $$('[data-day]', host).forEach((a) => a.addEventListener('click', () => {
    Object.keys(filters).forEach((k) => (filters[k] = ''));
    filters.from = filters.to = a.dataset.day;
  }));
}

function drawDiscipline(list) {
  const host = $('#discipline');
  const c = list.filter((t) => isClosed(t) && t.rulesAll.length);
  if (!c.length) {
    host.innerHTML = `<h2>Rule discipline</h2><p class="sub">Tick your rules when you add or close a trade. Then you will see here how following your rules changes your results. You can edit your rules in Settings.</p>`;
    return;
  }
  const followedAll = c.filter((t) => t.rulesChecked.length === t.rulesAll.length);
  const brokeSome = c.filter((t) => t.rulesChecked.length < t.rulesAll.length);
  const avgPct = sum(c.map((t) => t.rulesChecked.length / t.rulesAll.length)) / c.length;
  const row = (label, arr) => {
    const x = summarize(arr);
    return `<tr><td>${label}</td><td class="r">${x.n}</td><td class="r">${x.n ? Math.round(x.winRate * 100) + '%' : '–'}</td><td class="r">${isNum(x.avgR) ? fmtNum(x.avgR) : '–'}</td><td class="r ${signClass(x.net)}">${x.n ? money(x.net, true) : '–'}</td></tr>`;
  };
  const names = [...new Set(c.flatMap((t) => t.rulesAll))];
  const per = names.map((n) => {
    const rel = c.filter((t) => t.rulesAll.includes(n));
    return { n, f: summarize(rel.filter((t) => t.rulesChecked.includes(n))), b: summarize(rel.filter((t) => !t.rulesChecked.includes(n))) };
  });
  const cell = (x) => (x.n ? `<td class="r">${x.n}</td><td class="r">${Math.round(x.winRate * 100)}%</td><td class="r ${signClass(x.net)}">${money(x.net, true)}</td>` : '<td class="r">0</td><td class="r">–</td><td class="r">–</td>');
  host.innerHTML = `
    <h2>Rule discipline</h2>
    <p class="sub" style="margin-bottom:12px">On average you followed <b style="color:var(--text)">${Math.round(avgPct * 100)}%</b> of your rules (${c.length} trade${c.length === 1 ? '' : 's'} counted).</p>
    <div class="tbl-scroll"><table class="tbl"><thead><tr><th>When you...</th><th class="r">Trades</th><th class="r">Win rate</th><th class="r">Avg R</th><th class="r">Net result</th></tr></thead>
      <tbody>${row('Followed every rule', followedAll)}${row('Broke at least one rule', brokeSome)}</tbody></table></div>
    <h3 style="margin:22px 0 8px">Each rule</h3>
    <div class="tbl-scroll"><table class="tbl"><thead><tr><th>Rule</th><th class="r" colspan="3">When followed (trades, win rate, net)</th><th class="r" colspan="3">When broken (trades, win rate, net)</th></tr></thead>
      <tbody>${per.map((p) => `<tr><td>${esc(p.n)}</td>${cell(p.f)}${cell(p.b)}</tr>`).join('')}</tbody></table></div>`;
}

function breakdown(sel, list, keyFn, emptyMsg) {
  const rows = {};
  list.filter(isClosed).forEach((t) => {
    keyFn(t).forEach((k) => {
      const r = (rows[k] = rows[k] || { k, n: 0, w: 0, net: 0, rs: [] });
      r.n++;
      if (t.pnl > 0) r.w++;
      r.net += t.pnl;
      if (isNum(t.r)) r.rs.push(t.r);
    });
  });
  const arr = Object.values(rows).sort((a, b) => b.net - a.net);
  const host = $(sel);
  if (!arr.length) return (host.innerHTML = `<p class="sub">${emptyMsg || 'Nothing to show yet.'}</p>`);
  const maxAbs = Math.max(1, ...arr.map((r) => Math.abs(r.net)));
  host.innerHTML = `<table class="tbl"><thead><tr><th>Name</th><th class="r">Trades</th><th class="r">Win rate</th><th class="r">Avg R</th><th class="r">Net result</th><th></th></tr></thead><tbody>${arr
    .map((r) => {
      const w = (Math.abs(r.net) / maxAbs) * 50;
      return `<tr><td>${esc(r.k)}</td><td class="r">${r.n}</td><td class="r">${Math.round((r.w / r.n) * 100)}%</td><td class="r">${r.rs.length ? fmtNum(sum(r.rs) / r.rs.length) : '–'}</td><td class="r ${signClass(r.net)}">${money(r.net, true)}</td>
      <td><div class="bar"><i style="${r.net >= 0 ? `left:50%;width:${w}%;background:var(--win)` : `right:50%;width:${w}%;background:var(--loss)`}"></i></div></td></tr>`;
    })
    .join('')}</tbody></table>`;
}

/* =========================================================
   Phase 1 — Replay, Review and Setup Library
   ========================================================= */
function tradeR(t) {
  const r = calcR(t);
  return isNum(r) ? r : (isNum(t.r) ? t.r : null);
}

function reviewPriority(t) {
  let score = 0;
  if (t.mistakes?.length) score += 3 + t.mistakes.length;
  if (t.rulesAll?.length) score += Math.max(0, t.rulesAll.length - (t.rulesChecked?.length || 0));
  if (isClosed(t) && t.pnl < 0) score += 2;
  if (!t.notes?.lesson) score += 1;
  if (!t.images?.after?.length) score += 1;
  return score;
}

function reviewReason(t) {
  const reasons = [];
  if (t.mistakes?.length) reasons.push(t.mistakes[0]);
  if (t.rulesAll?.length && t.rulesChecked.length < t.rulesAll.length) reasons.push(`${t.rulesAll.length - t.rulesChecked.length} rule${t.rulesAll.length - t.rulesChecked.length === 1 ? '' : 's'} missed`);
  if (!t.notes?.lesson) reasons.push('No lesson recorded');
  if (!t.images?.after?.length) reasons.push('No after-trade review');
  if (isClosed(t) && t.pnl < 0) reasons.push('Loss to study');
  return reasons.slice(0, 2).join(' · ') || 'Review this trade while it is fresh';
}

function viewReview() {
  const candidates = state.trades.filter(Boolean).sort((a,b) => reviewPriority(b)-reviewPriority(a) || (b.openedAt||'').localeCompare(a.openedAt||''));
  const needs = candidates.filter(t => reviewPriority(t) > 0);
  const reviewed = state.trades.filter(t => t.notes?.lesson && t.images?.after?.length).length;
  const closed = state.trades.filter(isClosed);
  const ruleFollow = state.trades.filter(t => t.rulesAll?.length).map(t => t.rulesChecked.length / t.rulesAll.length);
  const avgRule = ruleFollow.length ? Math.round(sum(ruleFollow)/ruleFollow.length*100) : null;
  view.innerHTML = `
    <div class="phase-head">
      <div><div class="eyebrow">WEEKLY WORKBENCH</div><h1>Review what happened.</h1><p class="sub">Don't just log the trade. Extract the lesson that changes the next one.</p></div>
      <div class="review-metric"><span>Journaling completeness</span><b>${state.trades.length ? Math.round(reviewed/state.trades.length*100) : 0}%</b></div>
    </div>
    <div class="review-grid">
      <section class="review-hero">
        <div class="section-kicker">NEXT UP</div>
        <h2>${needs.length ? 'Five trades worth your attention.' : 'Your journal is caught up.'}</h2>
        <p>${needs.length ? 'Start with the highest-signal trade. A perfect win can teach you something too.' : 'Keep capturing the after-trade evidence and lessons while they are fresh.'}</p>
        ${needs.slice(0,5).map((t,i)=>`<a class="review-item" href="#/trade/${t.id}">
          <span class="review-num">0${i+1}</span><span class="review-shot">${t.images.before?.[0] ? `<img src="${imgUrl(t.images.before[0])}" alt="">` : '<span>NO CHART</span>'}</span>
          <span class="review-main"><b>${esc(t.symbol)} <i class="side ${t.side}">${t.side}</i></b><small>${fmtDateTime(t.openedAt)}</small><em>${esc(reviewReason(t))}</em></span>
          <strong class="${signClass(t.pnl)}">${isClosed(t) ? money(t.pnl,true) : 'OPEN'}<small>${isNum(tradeR(t)) ? fmtNum(tradeR(t))+'R' : ''}</small></strong>
        </a>`).join('') || '<div class="review-empty">No unresolved review items.</div>'}
      </section>
      <aside class="review-side">
        <div class="insight-block"><span>RULE ADHERENCE</span><b>${avgRule == null ? '–' : avgRule+'%'}</b><p>Average across trades where rules were recorded.</p></div>
        <div class="insight-block"><span>TRADES TO REVIEW</span><b>${needs.length}</b><p>Ranked by mistakes, missed rules, missing lessons and losses.</p></div>
        <div class="insight-block"><span>CLOSED TRADES</span><b>${closed.length}</b><p>Build the habit of reviewing both wins and losses.</p></div>
      </aside>
    </div>`;
}

function viewSetups() {
  const rows = {};
  state.trades.forEach(t => {
    const key = (t.strategy || 'Unclassified').trim() || 'Unclassified';
    const r = rows[key] ||= {name:key,trades:[],net:0,rs:[],wins:0,rules:[]};
    r.trades.push(t); if (isClosed(t)) { r.net += t.pnl; if(t.pnl>0)r.wins++; }
    const rr=tradeR(t); if(isNum(rr))r.rs.push(rr);
    if(t.rulesAll?.length) r.rules.push(t.rulesChecked.length/t.rulesAll.length);
  });
  const groups = Object.values(rows).sort((a,b)=>b.trades.length-a.trades.length);
  const best = groups.filter(g=>g.trades.some(isClosed)).sort((a,b)=>(sum(b.rs)/(b.rs.length||1))-(sum(a.rs)/(a.rs.length||1)))[0];
  view.innerHTML = `
    <div class="phase-head"><div><div class="eyebrow">SETUP LIBRARY</div><h1>Your trades, grouped by idea.</h1><p class="sub">Turn repeated setups into a personal playbook. Every setup is backed by your actual screenshots and outcomes.</p></div>${best ? `<div class="review-metric"><span>Highest avg R</span><b>${esc(best.name)}</b></div>`:''}</div>
    <div class="setup-grid">${groups.map(g=>{
      const closed=g.trades.filter(isClosed), avg=g.rs.length?sum(g.rs)/g.rs.length:null, wr=closed.length?Math.round(g.wins/closed.length*100):null, ra=g.rules.length?Math.round(sum(g.rules)/g.rules.length*100):null;
      const hero=g.trades.find(t=>t.images.before?.length) || g.trades[0];
      return `<a class="setup-tile" href="#/journal" data-setup-filter="${esc(g.name)}">
        <div class="setup-image">${hero?.images?.before?.[0]?`<img src="${imgUrl(hero.images.before[0])}" alt="">`:'<span>NO CHARTS YET</span>'}<span class="setup-count">${g.trades.length} trade${g.trades.length===1?'':'s'}</span></div>
        <div class="setup-body"><div class="setup-name"><h2>${esc(g.name)}</h2><span>→</span></div><div class="setup-stats"><span><b>${wr==null?'–':wr+'%'}</b> win</span><span><b>${avg==null?'–':fmtNum(avg)+'R'}</b> avg R</span><span><b>${money(g.net,true)}</b> net</span>${ra!=null?`<span><b>${ra}%</b> rules</span>`:''}</div></div>
      </a>`;
    }).join('') || '<div class="empty-state"><h2>No setups yet</h2><p>Add a strategy/setup when recording trades and your personal library will build itself.</p></div>'}</div>`;
  $$('.setup-tile').forEach(el=>el.addEventListener('click',e=>{
    e.preventDefault(); filters.strategy=el.dataset.setupFilter; location.hash='#/journal';
  }));
}

function viewReplay(t) {
  if(!t) return (view.innerHTML='<div class="empty-state"><h2>Trade not found</h2><a class="btn" href="#/journal">Back to journal</a></div>');
  const steps=[
    {key:'before',label:'01 · BEFORE',title:'The idea',desc:t.notes?.why || t.strategy || 'No setup thesis recorded.',files:t.images?.before||[]},
    {key:'entry',label:'02 · ENTRY',title:'The decision',desc:`${t.side} ${t.symbol} · Entry ${isNum(t.entry)?t.entry:'not recorded'} · SL ${isNum(t.sl)?t.sl:'not recorded'} · TP ${isNum(t.tp)?t.tp:'not recorded'}`,files:t.images?.before||[]},
    {key:'manage',label:'03 · MANAGEMENT',title:'What you did',desc:t.notes?.feelings || 'No management notes recorded.',files:t.images?.after?.length?t.images.after:t.images.before||[]},
    {key:'after',label:'04 · AFTER',title:'What actually happened',desc:t.notes?.lesson || (isClosed(t)?`${money(t.pnl,true)}${isNum(tradeR(t))?' · '+fmtNum(tradeR(t))+'R':''}`:'Trade still open.'),files:t.images?.after||[]},
  ];
  view.innerHTML=`<div class="replay-shell"><div class="replay-top"><div><a class="back-link" href="#/trade/${t.id}">← ${esc(t.symbol)} trade</a><div class="eyebrow">TRADE REPLAY</div><h1>See the trade as a sequence.</h1></div><div class="replay-result ${signClass(t.pnl)}">${isClosed(t)?money(t.pnl,true):'OPEN'}<small>${isNum(tradeR(t))?fmtNum(tradeR(t))+'R':''}</small></div></div><div class="replay-layout"><div class="replay-rail">${steps.map((s,i)=>`<button class="replay-step ${i===0?'active':''}" data-step="${i}"><span>${s.label}</span><b>${s.title}</b></button>`).join('')}</div><section class="replay-stage"><div class="replay-stage-head"><div><span id="replay-label">${steps[0].label}</span><h2 id="replay-title">${esc(steps[0].title)}</h2><p id="replay-desc">${esc(steps[0].desc)}</p></div><div class="replay-counter"><b id="replay-num">1</b> / 4</div></div><div class="replay-image" id="replay-image">${steps[0].files[0]?`<img src="${imgUrl(steps[0].files[0])}" alt="Trade chart">`:'<div class="replay-noimage">No screenshot captured for this stage.</div>'}</div><div class="replay-bottom"><button class="btn" id="replay-prev">Previous</button><button class="btn gold" id="replay-next">Next stage</button></div></section></div></div>`;
  let idx=0;
  const paint=()=>{const s=steps[idx]; $$('.replay-step').forEach((b,i)=>b.classList.toggle('active',i===idx)); $('#replay-label').textContent=s.label; $('#replay-title').textContent=s.title; $('#replay-desc').textContent=s.desc; $('#replay-num').textContent=idx+1; $('#replay-image').innerHTML=s.files[0]?`<img src="${imgUrl(s.files[0])}" alt="Trade chart">`:'<div class="replay-noimage">No screenshot captured for this stage.</div>'; $('#replay-prev').disabled=idx===0; $('#replay-next').textContent=idx===steps.length-1?'Back to trade':'Next stage';};
  $$('.replay-step').forEach(b=>b.onclick=()=>{idx=Number(b.dataset.step);paint()});
  $('#replay-prev').onclick=()=>{if(idx>0){idx--;paint()}else location.hash='#/trade/'+t.id};
  $('#replay-next').onclick=()=>{if(idx<steps.length-1){idx++;paint()}else location.hash='#/trade/'+t.id};
}

/* =========================================================
   Settings
   ========================================================= */
function viewSettings() {
  const s = state.settings;
  view.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <form id="setForm" autocomplete="off">
      <div class="card section">
        <h2>Account</h2>
        <label class="f" style="max-width:260px">Starting balance ($)<input name="bal" inputmode="decimal" value="${s.startingBalance}"></label>
        <p class="hint" style="margin-top:8px">Used for the equity curve and for the risk percent on each trade.</p>
      </div>
      <div class="card section">
        <h2>My rules</h2>
        <label class="f">One rule per line
          <textarea name="rules" rows="7" spellcheck="false">${esc(s.rules.join('\n'))}</textarea></label>
        <p class="hint" style="margin-top:8px">These show as a checklist on every trade. The Stats page shows how following them changes your results. Old trades keep the rules they were saved with.</p>
      </div>
      <div class="card section">
        <h2>Pairs</h2>
        <label class="f">One pair per line: name, then the size of one pip or point
          <textarea name="pairs" rows="7" spellcheck="false">${s.pairs.map((p) => p.symbol + ' ' + p.unit).join('\n')}</textarea></label>
        <p class="hint" style="margin-top:8px">The pip size is used to work out pips from your entry and exit price. Example: XAUUSD 0.1 means one pip is 0.10. Use 0.01 if you count gold in points.</p>
      </div>
      <div class="card section">
        <h2>Sessions</h2>
        <p class="hint" style="margin-bottom:12px">The hour (0 to 23, your PC time) when each session starts. The session is picked for you from the trade time.</p>
        <div class="grid g3" style="max-width:520px">
          <label class="f">Asia starts<input name="asia" type="number" min="0" max="23" value="${s.sessions.asia}"></label>
          <label class="f">London starts<input name="london" type="number" min="0" max="23" value="${s.sessions.london}"></label>
          <label class="f">New York starts<input name="newyork" type="number" min="0" max="23" value="${s.sessions.newyork}"></label>
        </div>
      </div>
      <div class="card section">
        <h2>Where your files are</h2>
        <p><span class="sub">Screenshots:</span> <b style="word-break:break-all">${esc(state.config.imageDir)}</b></p>
        <p style="margin-top:6px"><span class="sub">Trade data:</span> <b style="word-break:break-all">${esc(state.config.dataDir)}</b></p>
        <p class="hint" style="margin-top:8px">To change the screenshots folder, edit config.json and restart the journal.</p>
        <p style="margin-top:14px"><a class="btn" href="/api/export" download>Download a backup of my trades</a></p>
      </div>
      <div style="display:flex;gap:10px;align-items:center"><button class="btn gold" type="submit">Save settings</button><span id="setMsg" class="hint"></span></div>
    </form>`;
  $('#setForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const pairs = f.pairs.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [symbol, unit] = l.split(/[\s,;]+/);
      return { symbol, unit: toNum(unit) || 1 };
    });
    try {
      state.settings = await api('/settings', 'PUT', {
        startingBalance: toNum(f.bal.value) ?? 0, pairs, rules: f.rules.value.split('\n'),
        sessions: { asia: toNum(f.asia.value), london: toNum(f.london.value), newyork: toNum(f.newyork.value) },
      });
      state.settings.rules = state.settings.rules || [];
      toast('Settings saved');
      $('#setMsg').textContent = '';
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* Phase 2 owns the boot call so its route is available first. */
