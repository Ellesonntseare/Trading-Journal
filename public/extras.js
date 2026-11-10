'use strict';
/* =========================================================
   Extra tools: compare before/after, draw on a screenshot, quick close
   (uses helpers from app.js)
   ========================================================= */

/* ---------- Compare before and after ---------- */
const cmpState = { t: null, mode: 'side', b: 0, a: 0, zoom: null };

function openCompare(t) {
  Object.assign(cmpState, { t, mode: 'side', b: 0, a: 0 });
  renderCompare();
  const d = $('#compare');
  if (!d.open) d.showModal();
}

function renderCompare() {
  const { t } = cmpState;
  const bf = t.images.before[cmpState.b];
  const af = t.images.after[cmpState.a];
  const capOf = (f) => (t.captions[f] ? ' - ' + esc(t.captions[f]) : '');
  const picker = (kind, id, cur) =>
    t.images[kind].length > 1
      ? `<select id="${id}" aria-label="${kind} image">${t.images[kind]
          .map((f, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${kind === 'before' ? 'Before' : 'After'} ${i + 1}${t.captions[f] ? ': ' + esc(t.captions[f]) : ''}</option>`)
          .join('')}</select>`
      : '';
  $('#cmp-left').innerHTML = `
    <button class="btn small ${cmpState.mode === 'side' ? 'gold' : ''}" data-mode="side">Side by side</button>
    <button class="btn small ${cmpState.mode === 'slider' ? 'gold' : ''}" data-mode="slider">Slider</button>
    ${picker('before', 'cmp-b', cmpState.b)}${picker('after', 'cmp-a', cmpState.a)}`;
  const body = $('#cmp-body');
  if (cmpState.mode === 'side') {
    body.innerHTML = `<div class="cmp-side">
      <div class="cmp-col"><h3>Before${capOf(bf)}</h3><div class="stage"><img data-zoom data-file="${esc(bf)}" src="${imgUrl(bf)}" alt="Before screenshot"></div></div>
      <div class="cmp-col"><h3>After${capOf(af)}</h3><div class="stage"><img data-zoom data-file="${esc(af)}" src="${imgUrl(af)}" alt="After screenshot"></div></div>
    </div>`;
    cmpState.zoom = makeZoom($$('.stage', body));
  } else {
    body.innerHTML = `<div class="cmp-slider">
      <div class="stage" id="cmp-st">
        <img data-zoom data-file="${esc(bf)}" src="${imgUrl(bf)}" alt="Before screenshot">
        <div class="over" style="clip-path: inset(0 0 0 50%)"><img data-zoom data-file="${esc(af)}" src="${imgUrl(af)}" alt="After screenshot"></div>
        <div class="divider" style="left:50%"></div>
        <span class="tagl">Before</span><span class="tagr">After</span>
      </div>
      <label class="cmp-range">Move the line to compare
        <input type="range" min="0" max="100" value="50" id="cmp-range" aria-label="Compare position"></label>
    </div>`;
    cmpState.zoom = makeZoom([$('#cmp-st')]);
    $('#cmp-range').addEventListener('input', (e) => {
      const v = e.target.value;
      $('#cmp-st .over').style.clipPath = `inset(0 0 0 ${v}%)`;
      $('#cmp-st .divider').style.left = v + '%';
    });
  }
}

$('#cmp-close').onclick = () => $('#compare').close();
$('#cmp-zin').onclick = () => cmpState.zoom && cmpState.zoom.by(1.4);
$('#cmp-zout').onclick = () => cmpState.zoom && cmpState.zoom.by(1 / 1.4);
$('#cmp-fit').onclick = () => cmpState.zoom && cmpState.zoom.reset();
$('#compare').addEventListener('click', (e) => {
  if (e.target.id === 'compare') e.target.close();
});
$('#cmp-left').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) {
    cmpState.mode = b.dataset.mode;
    renderCompare();
  }
});
$('#cmp-left').addEventListener('change', (e) => {
  if (e.target.id === 'cmp-b') cmpState.b = Number(e.target.value);
  if (e.target.id === 'cmp-a') cmpState.a = Number(e.target.value);
  renderCompare();
});

/* ---------- Draw on a screenshot ---------- */
const an = { kind: null, i: 0, file: '', bmp: null, shapes: [], cur: null, tool: 'arrow', color: '#d6a94a', size: 1, busy: false };
const AN_COLORS = ['#d6a94a', '#ea6a62', '#52c48f', '#ffffff', '#5aa9ff'];
const AN_TOOLS = [['pen', 'Pen'], ['line', 'Line'], ['arrow', 'Arrow'], ['box', 'Box'], ['text', 'Text']];
const anCanvas = $('#an-canvas');
const anUnit = () => Math.max(1, anCanvas.width / 1280);

function anBar() {
  $('#an-bar').innerHTML = `
    <div class="an-tools" role="group" aria-label="Tools">${AN_TOOLS.map(([k, l]) => `<button type="button" class="btn small ${an.tool === k ? 'gold' : ''}" data-tool="${k}">${l}</button>`).join('')}</div>
    <div class="an-tools" role="group" aria-label="Colour">${AN_COLORS.map((c) => `<button type="button" class="sw ${an.color === c ? 'on' : ''}" style="background:${c}" data-color="${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
    <div class="an-tools" role="group" aria-label="Size">${['S', 'M', 'L'].map((l, k) => `<button type="button" class="btn small ${an.size === k ? 'gold' : ''}" data-size="${k}" aria-label="Size ${l}">${l}</button>`).join('')}</div>
    <div class="an-tools"><button type="button" class="btn small" data-act="undo">Undo</button><button type="button" class="btn small" data-act="clear">Clear</button></div>
    <div class="an-tools" style="margin-left:auto">
      <button type="button" class="btn small" data-act="copy">Copy</button>
      <button type="button" class="btn small gold" data-act="savecopy">Save as new image</button>
      <button type="button" class="btn small" data-act="replace">Replace original</button>
      <button type="button" class="btn small" data-act="cancel">Cancel</button>
    </div>`;
}

async function openAnnotate(kind, i) {
  if (!form) return;
  const file = form.draft.images[kind][i];
  if (!file) return;
  try {
    const blob = await fetch(imgUrl(file)).then((r) => r.blob());
    an.bmp = await createImageBitmap(blob);
  } catch (e) {
    return toast('Could not open this image for drawing.', true);
  }
  Object.assign(an, { kind, i, file, shapes: [], cur: null });
  const sc = Math.min(1, 3000 / an.bmp.width);
  anCanvas.width = Math.round(an.bmp.width * sc);
  anCanvas.height = Math.round(an.bmp.height * sc);
  anBar();
  anPaint();
  $('#annot').showModal();
}

function anShape(ctx, sh) {
  ctx.strokeStyle = ctx.fillStyle = sh.color;
  ctx.lineWidth = sh.w;
  ctx.lineCap = ctx.lineJoin = 'round';
  if (sh.type === 'pen') {
    ctx.beginPath();
    sh.pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  } else if (sh.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(sh.a.x, sh.a.y);
    ctx.lineTo(sh.b.x, sh.b.y);
    ctx.stroke();
  } else if (sh.type === 'arrow') {
    const { a, b } = sh;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const h = sh.w * 3.6 + 10;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x - Math.cos(ang) * h * 0.6, b.y - Math.sin(ang) * h * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - h * Math.cos(ang - 0.45), b.y - h * Math.sin(ang - 0.45));
    ctx.lineTo(b.x - h * Math.cos(ang + 0.45), b.y - h * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  } else if (sh.type === 'box') {
    ctx.strokeRect(Math.min(sh.a.x, sh.b.x), Math.min(sh.a.y, sh.b.y), Math.abs(sh.b.x - sh.a.x), Math.abs(sh.b.y - sh.a.y));
  } else if (sh.type === 'text') {
    ctx.font = `700 ${sh.size}px Manrope, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.lineWidth = Math.max(2, sh.size / 6);
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(sh.text, sh.at.x, sh.at.y);
    ctx.fillText(sh.text, sh.at.x, sh.at.y);
  }
}

function anPaint() {
  if (!an.bmp) return;
  const ctx = anCanvas.getContext('2d');
  ctx.clearRect(0, 0, anCanvas.width, anCanvas.height);
  ctx.drawImage(an.bmp, 0, 0, anCanvas.width, anCanvas.height);
  [...an.shapes, an.cur].filter(Boolean).forEach((sh) => anShape(ctx, sh));
}

const anPoint = (e) => {
  const r = anCanvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * anCanvas.width) / r.width, y: ((e.clientY - r.top) * anCanvas.height) / r.height };
};

function anTextAt(e, p) {
  const wrap = $('#an-wrap');
  const r = wrap.getBoundingClientRect();
  const left = e.clientX - r.left + wrap.scrollLeft;
  const top = e.clientY - r.top + wrap.scrollTop;
  setTimeout(() => {
    const inp = document.createElement('input');
    inp.className = 'an-text';
    inp.placeholder = 'Type, then press Enter';
    inp.style.left = left + 'px';
    inp.style.top = top + 'px';
    let done = false;
    const commit = (ok) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      inp.remove();
      if (ok && v) {
        an.shapes.push({ type: 'text', at: p, text: v, color: an.color, size: [22, 32, 48][an.size] * anUnit() });
        anPaint();
      }
    };
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); commit(false); }
    });
    inp.addEventListener('blur', () => commit(true));
    wrap.appendChild(inp);
    inp.focus();
  }, 0);
}

anCanvas.addEventListener('pointerdown', (e) => {
  if (!an.bmp) return;
  e.preventDefault();
  const p = anPoint(e);
  if (an.tool === 'text') return anTextAt(e, p);
  anCanvas.setPointerCapture(e.pointerId);
  an.cur = { type: an.tool, color: an.color, w: [3, 5, 9][an.size] * anUnit(), a: p, b: p, pts: [p] };
  anPaint();
});
anCanvas.addEventListener('pointermove', (e) => {
  if (!an.cur) return;
  const p = anPoint(e);
  an.cur.b = p;
  if (an.cur.type === 'pen') an.cur.pts.push(p);
  anPaint();
});
const anEnd = () => {
  if (!an.cur) return;
  const s = an.cur;
  an.cur = null;
  const moved = s.type === 'pen' ? s.pts.length > 2 : Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 4;
  if (moved) an.shapes.push(s);
  anPaint();
};
anCanvas.addEventListener('pointerup', anEnd);
anCanvas.addEventListener('pointercancel', anEnd);

const anBlob = () => new Promise((ok) => anCanvas.toBlob(ok, 'image/png'));

async function anSave(mode) {
  if (an.busy || !form) return;
  if (!an.shapes.length) return toast('Draw something first.', true);
  an.busy = true;
  try {
    const blob = await anBlob();
    const { symbol, date } = formMeta();
    const name = await uploadBlob(an.kind, blob, symbol, date);
    const list = form.draft.images[an.kind];
    const oldCap = form.draft.captions[an.file] || '';
    form.fresh.add(name);
    if (mode === 'replace') {
      list[an.i] = name;
      if (oldCap) form.draft.captions[name] = oldCap;
      delete form.draft.captions[an.file];
      if (form.fresh.has(an.file)) {
        form.fresh.delete(an.file);
        api('/images/' + encodeURIComponent(an.file), 'DELETE').catch(() => {});
      }
    } else {
      list.splice(an.i + 1, 0, name);
      form.draft.captions[name] = oldCap ? oldCap + ' (marked)' : 'Marked up';
    }
    paintZones();
    $('#annot').close();
    toast(mode === 'replace' ? 'Screenshot replaced' : 'Marked-up screenshot added');
  } catch (e) {
    toast(e.message, true);
  } finally {
    an.busy = false;
  }
}

$('#an-bar').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tool) { an.tool = b.dataset.tool; return anBar(); }
  if (b.dataset.color) { an.color = b.dataset.color; return anBar(); }
  if (b.dataset.size) { an.size = Number(b.dataset.size); return anBar(); }
  const act = b.dataset.act;
  if (act === 'undo') { an.shapes.pop(); anPaint(); }
  if (act === 'clear') { an.shapes = []; anPaint(); }
  if (act === 'cancel') $('#annot').close();
  if (act === 'savecopy') anSave('copy');
  if (act === 'replace') anSave('replace');
  if (act === 'copy') {
    if (!(window.isSecureContext && navigator.clipboard && window.ClipboardItem)) {
      return toast('Your browser blocks copying on this link. Use "Save as new image" instead.', true);
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': anBlob() })]);
      toast('Image copied. Press Ctrl+V where you want it.');
    } catch (err) {
      toast('Could not copy this image.', true);
    }
  }
});
document.addEventListener('keydown', (e) => {
  if (!$('#annot').open) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && tag !== 'input') {
    e.preventDefault();
    an.shapes.pop();
    anPaint();
  }
});

/* ---------- Quick close of an open trade ---------- */
const qc = { t: null, after: [], fresh: new Set(), uploading: 0, saved: false, rulesTouched: false, rules: [], checked: [] };

function openQuickClose(t) {
  if (!t) return;
  Object.assign(qc, { t, after: [], fresh: new Set(), uploading: 0, saved: false, rulesTouched: false });
  qc.rules = t.rulesAll.length ? [...t.rulesAll] : [...state.settings.rules];
  qc.checked = [...t.rulesChecked];
  const now = localInput();
  const closedAt = now < t.openedAt ? t.openedAt : now;
  const d = $('#quick');
  d.innerHTML = `
    <div class="lb-bar"><strong>Close trade: ${esc(t.symbol)} ${t.side}</strong><button class="btn small" type="button" id="qc-x">Cancel</button></div>
    <form class="qc-body" id="qc-form" autocomplete="off">
      <div class="zone active" id="qc-zone"></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label class="f">Closed<input type="datetime-local" name="closedAt" value="${esc(closedAt)}" required></label>
        <label class="f">Exit price<input name="exit" inputmode="decimal" value="${nv(t.exit)}"></label>
        <label class="f">Profit or loss ($)<input name="pnl" inputmode="decimal" placeholder="Example: 45 or -25"></label>
      </div>
      <p class="hint" id="qc-auto"></p>
      ${qc.rules.length ? `<div><h3 style="margin-bottom:8px">My rules <span class="hint" id="qc-count" style="margin-left:6px"></span></h3><div class="rule-pick" id="qc-rules"></div></div>` : ''}
      <label class="f">What did I learn? (optional)<textarea name="lesson">${esc(t.notes.lesson)}</textarea></label>
      <div class="error" id="qc-err" role="alert" style="margin:0"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px"><button type="button" class="btn" id="qc-cancel">Cancel</button><button type="submit" class="btn gold">Save and close trade</button></div>
    </form>`;
  paintQcZone();
  paintQcRules();
  qcAuto();
  const form_ = $('#qc-form');
  form_.addEventListener('input', (e) => {
    if (e.target.name === 'exit' || e.target.name === 'pnl') qcAuto();
  });
  form_.addEventListener('submit', (e) => {
    e.preventDefault();
    qcSave();
  });
  $('#qc-x').onclick = $('#qc-cancel').onclick = () => d.close();
  $('#qc-zone').addEventListener('click', (e) => {
    const fig = e.target.closest('figure[data-file]');
    if (fig && e.target.closest('[data-qrm]')) {
      const f = fig.dataset.file;
      qc.after = qc.after.filter((x) => x !== f);
      qc.fresh.delete(f);
      api('/images/' + encodeURIComponent(f), 'DELETE').catch(() => {});
      return paintQcZone();
    }
    if (fig && e.target.tagName === 'IMG') return openLightbox(qc.after, Number(fig.dataset.i), 'After', {});
  });
  $('#qc-zone').addEventListener('change', (e) => {
    if (e.target.type === 'file') [...e.target.files].forEach(quickAddImage);
  });
  const rulesEl = $('#qc-rules');
  if (rulesEl) {
    rulesEl.addEventListener('change', (e) => {
      qc.rulesTouched = true;
      const v = e.target.value;
      if (e.target.checked && !qc.checked.includes(v)) qc.checked.push(v);
      if (!e.target.checked) qc.checked = qc.checked.filter((x) => x !== v);
      paintQcCount();
    });
  }
  d.showModal();
  d.querySelector('[name=pnl]').focus();
}

function paintQcZone() {
  const z = $('#qc-zone');
  if (!z) return;
  z.innerHTML = `
    <div class="zone-head"><h3>After screenshot</h3><span class="hint">Press Ctrl+V now</span></div>
    ${qc.after.length || qc.uploading
      ? `<div class="thumbs">${qc.after.map((f, i) => `
          <figure class="thumb" style="margin:0" data-file="${esc(f)}" data-i="${i}">
            <div class="imgbox"><img src="${imgUrl(f)}" alt="After screenshot ${i + 1}"><div class="tools"><button type="button" class="btn small danger" data-qrm>Remove</button></div></div>
          </figure>`).join('')}${qc.uploading ? '<div class="thumb loading">Saving...</div>' : ''}</div>`
      : '<div class="zone-empty"><div>Press Win + Shift + S, take the screenshot, then press Ctrl+V.</div></div>'}
    <div class="zone-foot"><label class="btn small">Add photo or file<input type="file" accept="image/*" multiple hidden></label></div>`;
}

function paintQcRules() {
  const el = $('#qc-rules');
  if (!el) return;
  el.innerHTML = qc.rules
    .map((r) => `<label><input type="checkbox" value="${esc(r)}" ${qc.checked.includes(r) ? 'checked' : ''}><span>${esc(r)}</span></label>`)
    .join('');
  paintQcCount();
}
function paintQcCount() {
  const c = $('#qc-count');
  if (c) c.textContent = `${qc.checked.length} of ${qc.rules.length} followed`;
}

function qcAuto() {
  const f = $('#qc-form');
  if (!f) return;
  const tmp = Object.assign({}, qc.t, { exit: toNum(f.elements.exit.value), pnl: toNum(f.elements.pnl.value) });
  const pips = calcPips(tmp);
  const r = calcR(tmp);
  $('#qc-auto').textContent =
    pips === null && r === null
      ? 'Pips and R are worked out from your entry price, stop loss and risk.'
      : `Worked out for you: ${pips === null ? '' : pips + ' pips'}${pips !== null && r !== null ? ', ' : ''}${r === null ? '' : r + ' R'}`;
}

async function quickAddImage(file) {
  if (!file || !$('#quick').open) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('Please use a PNG, JPG, WEBP or GIF image.', true);
  qc.uploading++;
  paintQcZone();
  try {
    const name = await uploadBlob('after', file, qc.t.symbol, (qc.t.openedAt || '').slice(0, 10));
    qc.after.push(name);
    qc.fresh.add(name);
    toast('After screenshot saved');
  } catch (e) {
    toast(e.message, true);
  } finally {
    qc.uploading--;
    paintQcZone();
  }
}

async function qcSave() {
  const f = $('#qc-form').elements;
  const err = $('#qc-err');
  err.textContent = '';
  if (qc.uploading) return (err.textContent = 'Wait a moment, an image is still saving.');
  const pnl = toNum(f.pnl.value);
  if (pnl === null) return (err.textContent = 'Enter the profit or loss in dollars. Use a minus sign for a loss.');
  const t = qc.t;
  const closedAt = f.closedAt.value;
  if (!closedAt) return (err.textContent = 'Enter the time the trade closed.');
  if (closedAt < t.openedAt) return (err.textContent = 'The close time is before the open time.');
  const exit = toNum(f.exit.value);
  const tmp = Object.assign({}, t, { exit, pnl });
  const body = JSON.parse(JSON.stringify(t));
  Object.assign(body, { closedAt, exit, pnl, pips: calcPips(tmp) ?? t.pips, r: calcR(tmp) ?? t.r });
  body.notes.lesson = f.lesson.value.trim();
  body.images.after = [...t.images.after, ...qc.after];
  let rulesAll = qc.rules;
  let rulesChecked = qc.checked;
  if (!qc.rulesTouched && !rulesChecked.length && !t.rulesAll.length) {
    rulesAll = [];
    rulesChecked = [];
  }
  body.rulesAll = rulesAll;
  body.rulesChecked = rulesChecked;
  try {
    const saved = normTrade(await api('/trades/' + t.id, 'PUT', body));
    const i = state.trades.findIndex((x) => x.id === saved.id);
    if (i >= 0) state.trades[i] = saved;
    qc.saved = true;
    $('#quick').close();
    toast('Trade closed and saved');
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  } catch (e) {
    err.textContent = e.message;
  }
}

$('#quick').addEventListener('close', () => {
  if (!qc.saved) qc.fresh.forEach((f) => api('/images/' + encodeURIComponent(f), 'DELETE').catch(() => {}));
  qc.fresh = new Set();
  $('#quick').innerHTML = '';
});
