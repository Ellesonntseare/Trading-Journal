'use strict';
/* Calendar: #/calendar/<year|month|week|day>/<YYYY-MM-DD>
   Days are colour coded by net P&L: green = profit, red = loss, deeper colour = bigger result. */

const CAL_MODES = ['year', 'month', 'week', 'day'];
const CAL_DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const calKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const calParse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const calAdd = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const calMonday = (d) => calAdd(d, -((d.getDay() + 6) % 7));
const calAddMonths = (d, n) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last));
};
const calMonthName = (y, m, o = 'long') => new Date(y, m, 1).toLocaleDateString('en-GB', { month: o });

function calAgg() {
  const by = {};
  state.trades.forEach((t) => {
    const k = dayKey(t);
    if (!k) return;
    const a = by[k] || (by[k] = { k, pnl: 0, closed: 0, open: 0, wins: 0, losses: 0, r: 0, trades: [] });
    a.trades.push(t);
    if (isClosed(t)) {
      a.closed++; a.pnl += t.pnl;
      if (t.pnl > 0) a.wins++; else if (t.pnl < 0) a.losses++;
      if (isNum(t.r)) a.r += t.r;
    } else a.open++;
  });
  Object.values(by).forEach((a) => a.trades.sort((x, y) => closeTime(x).localeCompare(closeTime(y))));
  return by;
}

function calSummary(by, keys) {
  const s = { pnl: 0, trades: 0, closed: 0, wins: 0, losses: 0, r: 0, green: 0, red: 0, best: null };
  keys.forEach((k) => {
    const a = by[k];
    if (!a) return;
    s.trades += a.trades.length; s.closed += a.closed; s.wins += a.wins; s.losses += a.losses; s.r += a.r;
    if (a.closed) {
      s.pnl += a.pnl;
      if (a.pnl > 0) s.green++; else if (a.pnl < 0) s.red++;
      if (!s.best || a.pnl > s.best.pnl) s.best = a;
    }
  });
  return s;
}
const calMax = (by, keys) => Math.max(1, ...keys.map((k) => (by[k] && by[k].closed ? Math.abs(by[k].pnl) : 0)));

// Background colour for a day: stronger colour = bigger win or loss
function calTint(a, max) {
  if (!a) return { cls: 'cal-none', style: '' };
  if (!a.closed) return { cls: 'cal-openday', style: '' };
  if (a.pnl === 0) return { cls: 'cal-be', style: '' };
  const alpha = (0.16 + 0.54 * Math.min(1, Math.abs(a.pnl) / max)).toFixed(2);
  const rgb = a.pnl > 0 ? '85,214,154' : '255,113,104';
  return { cls: a.pnl > 0 ? 'cal-win' : 'cal-loss', style: `background:rgba(${rgb},${alpha});border-color:rgba(${rgb},.55)` };
}
const calPnl = (n) => `<span class="${n > 0 ? 'cal-pos' : n < 0 ? 'cal-neg' : ''}">${money(n, true)}</span>`;
const calShort = (n) => {
  const a = Math.abs(n);
  const s = a >= 10000 ? (a / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : a >= 1000 ? (a / 1000).toFixed(2).replace(/0$/, '') + 'k' : String(Math.round(a * 100) / 100);
  return (n < 0 ? '-' : n > 0 ? '+' : '') + 'R' + s;
};

function calKpis(s, day) {
  const wr = s.closed ? Math.round((s.wins / s.closed) * 100) + '%' : '–';
  const tile = (l, v) => `<div class="kpi"><span>${l}</span><b>${v}</b></div>`;
  return `<div class="kpis cal-kpis">` + (day
    ? tile('Net P&L', calPnl(s.pnl)) + tile('Trades', s.trades) + tile('Wins', s.wins) + tile('Losses', s.losses) + tile('Total R', s.closed ? fmtNum(s.r) : '–') + tile('Win rate', wr)
    : tile('Net P&L', calPnl(s.pnl)) + tile('Trades', s.trades) + tile('Win rate', wr) + tile('Green days', s.green) + tile('Red days', s.red) + tile('Best day', s.best ? `${calPnl(s.best.pnl)}<small>${fmtDay(s.best.k)}</small>` : '–')) + `</div>`;
}

function viewCalendar(modeArg, dateArg) {
  const mode = CAL_MODES.includes(modeArg) ? modeArg : 'month';
  const d = calParse(dateArg);
  const by = calAgg();
  const L = (m, dt) => `#/calendar/${m}/${calKey(dt)}`;
  const todayKey = calKey(new Date());
  const y = d.getFullYear(), m = d.getMonth();

  let prev, next, label, keys, body;
  if (mode === 'year') {
    prev = calAddMonths(d, -12); next = calAddMonths(d, 12); label = String(y);
    keys = Object.keys(by).filter((k) => k.startsWith(y + '-'));
    body = calYear(by, y, keys, L, todayKey);
  } else if (mode === 'month') {
    prev = calAddMonths(d, -1); next = calAddMonths(d, 1); label = `${calMonthName(y, m)} ${y}`;
    keys = Object.keys(by).filter((k) => k.startsWith(`${y}-${pad(m + 1)}`));
    body = calMonth(by, y, m, keys, L, todayKey);
  } else if (mode === 'week') {
    const mon = calMonday(d), sun = calAdd(mon, 6);
    prev = calAdd(d, -7); next = calAdd(d, 7);
    label = `${mon.getDate()} ${calMonthName(mon.getFullYear(), mon.getMonth(), 'short')} – ${sun.getDate()} ${calMonthName(sun.getFullYear(), sun.getMonth(), 'short')} ${sun.getFullYear()}`;
    keys = Array.from({ length: 7 }, (_, i) => calKey(calAdd(mon, i)));
    body = calWeek(by, mon, keys, L, todayKey);
  } else {
    prev = calAdd(d, -1); next = calAdd(d, 1);
    label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    keys = [calKey(d)];
    body = calDay(by[keys[0]], keys[0]);
  }
  const s = calSummary(by, keys);

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Calendar</h1><p class="sub">${esc(label)}</p></div>
      <a class="btn gold" href="#/add">Record trade</a>
    </div>
    <div class="cal-bar">
      <div class="cal-tabs" role="tablist">${CAL_MODES.map((x) => `<a href="${L(x, d)}" class="${x === mode ? 'on' : ''}" role="tab" aria-selected="${x === mode}">${x[0].toUpperCase() + x.slice(1)}</a>`).join('')}</div>
      <div class="cal-nav">
        <a class="btn small" href="${L(mode, prev)}" aria-label="Previous">&larr;</a>
        <a class="btn small" href="${L(mode, new Date())}">Today</a>
        <a class="btn small" href="${L(mode, next)}" aria-label="Next">&rarr;</a>
        <input type="date" id="calJump" value="${calKey(d)}" aria-label="Go to date">
      </div>
    </div>
    ${calKpis(s, mode === 'day')}
    <div class="cal-legend"><span><i class="cal-win" style="background:rgba(85,214,154,.6)"></i>Profit</span><span><i class="cal-loss" style="background:rgba(255,113,104,.6)"></i>Loss</span><span><i class="cal-be"></i>Break-even</span><span><i class="cal-openday"></i>Open trade</span><span><i class="cal-none"></i>No trades</span></div>
    ${body}`;

  $('#calJump').onchange = (e) => { if (e.target.value) location.hash = `#/calendar/${mode}/${e.target.value}`; };
  const onKey = (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowLeft') location.hash = L(mode, prev);
    else if (e.key === 'ArrowRight') location.hash = L(mode, next);
  };
  document.addEventListener('keydown', onKey);
  cleanupView = () => document.removeEventListener('keydown', onKey);
}

/* ---------- Year: 12 small months ---------- */
function calYear(by, y, keys, L, todayKey) {
  const max = calMax(by, keys);
  const months = Array.from({ length: 12 }, (_, mi) => {
    const first = new Date(y, mi, 1);
    const days = new Date(y, mi + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    const mk = keys.filter((k) => k.startsWith(`${y}-${pad(mi + 1)}`));
    const ms = calSummary(by, mk);
    let cells = '<i class="cal-mini-blank"></i>'.repeat(lead);
    for (let day = 1; day <= days; day++) {
      const k = `${y}-${pad(mi + 1)}-${pad(day)}`;
      const a = by[k], t = calTint(a, max);
      const tip = a ? `${fmtDay(k)}: ${a.closed ? money(a.pnl, true) : 'open'} (${a.trades.length} trade${a.trades.length > 1 ? 's' : ''})` : fmtDay(k);
      cells += `<a class="cal-mini ${t.cls}${k === todayKey ? ' today' : ''}" style="${t.style}" href="${L('day', new Date(y, mi, day))}" title="${esc(tip)}">${day}</a>`;
    }
    return `<section class="cal-year-month">
      <header><a href="${L('month', first)}"><b>${calMonthName(y, mi)}</b></a>${ms.closed ? calPnl(ms.pnl) : '<span class="cal-dim">–</span>'}</header>
      <div class="cal-mini-dow">${CAL_DOW.map((x) => `<span>${x[0]}</span>`).join('')}</div>
      <div class="cal-mini-grid">${cells}</div>
    </section>`;
  });
  return `<div class="cal-year">${months.join('')}</div>`;
}

/* ---------- Month: big grid with weekly totals ---------- */
function calMonth(by, y, m, keys, L, todayKey) {
  const max = calMax(by, keys);
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  let cur = calMonday(first);
  let rows = '';
  while (cur <= last) {
    let cells = '', wk = { pnl: 0, closed: 0, trades: 0 };
    for (let i = 0; i < 7; i++) {
      const dt = calAdd(cur, i), k = calKey(dt);
      if (dt.getMonth() !== m) { cells += `<div class="cal-cell cal-out"><span class="cal-dn">${dt.getDate()}</span></div>`; continue; }
      const a = by[k], t = calTint(a, max);
      if (a) { wk.trades += a.trades.length; if (a.closed) { wk.pnl += a.pnl; wk.closed += a.closed; } }
      cells += `<a class="cal-cell ${t.cls}${k === todayKey ? ' today' : ''}" style="${t.style}" href="${L('day', dt)}">
        <span class="cal-dn">${dt.getDate()}</span>
        ${a ? `<b class="cal-amt ${a.closed ? (a.pnl > 0 ? 'cal-pos' : a.pnl < 0 ? 'cal-neg' : '') : 'cal-dim'}">${a.closed ? calShort(a.pnl) : 'open'}</b><small>${a.trades.length} trade${a.trades.length > 1 ? 's' : ''}</small>` : ''}
      </a>`;
    }
    rows += cells + `<a class="cal-wk" href="${L('week', cur)}"><small>Week</small>${wk.trades ? `<b class="${wk.pnl > 0 ? 'cal-pos' : wk.pnl < 0 ? 'cal-neg' : ''}">${wk.closed ? calShort(wk.pnl) : 'open'}</b><small>${wk.trades} trade${wk.trades > 1 ? 's' : ''}</small>` : '<small class="cal-dim">–</small>'}</a>`;
    cur = calAdd(cur, 7);
  }
  return `<div class="cal-month"><div class="cal-dow">${CAL_DOW.map((x) => `<span>${x}</span>`).join('')}<span>Total</span></div><div class="cal-grid">${rows}</div></div>`;
}

/* ---------- Week: seven day columns with their trades ---------- */
function calWeek(by, mon, keys, L, todayKey) {
  const max = calMax(by, keys);
  const cols = keys.map((k, i) => {
    const dt = calAdd(mon, i), a = by[k], t = calTint(a, max);
    const list = a ? a.trades.map((tr) => `<a class="cal-wtrade" href="#/trade/${esc(tr.id)}">
        <span><b>${esc(tr.symbol)}</b> <i class="side ${esc(tr.side)}">${esc(tr.side)}</i></span>
        <span class="${isClosed(tr) ? (tr.pnl > 0 ? 'cal-pos' : tr.pnl < 0 ? 'cal-neg' : '') : 'cal-dim'}">${isClosed(tr) ? money(tr.pnl, true) : 'open'}</span></a>`).join('') : '<p class="cal-dim cal-empty">No trades</p>';
    return `<section class="cal-wcol ${t.cls}${k === todayKey ? ' today' : ''}" style="${t.style}">
      <a class="cal-whead" href="${L('day', dt)}"><span>${CAL_DOW[i]}</span><b>${dt.getDate()}</b></a>
      <div class="cal-wsum">${a ? (a.closed ? calPnl(a.pnl) : '<span class="cal-dim">open</span>') : '<span class="cal-dim">–</span>'}</div>
      <div class="cal-wlist">${list}</div>
    </section>`;
  });
  return `<div class="cal-week">${cols.join('')}</div>`;
}

/* ---------- Day: every trade with details ---------- */
function calDay(a, key) {
  if (!a) return `<div class="empty-state"><h2>No trades on this day</h2><p>Nothing recorded for ${esc(fmtDay(key))}.</p><a class="btn gold" href="#/add">Record a trade</a></div>`;
  const rows = a.trades.map((t) => {
    const img = t.images && t.images.before && t.images.before[0];
    const cls = isClosed(t) ? (t.pnl > 0 ? 'cal-win' : t.pnl < 0 ? 'cal-loss' : 'cal-be') : 'cal-openday';
    const time = (closeTime(t).slice(11, 16)) || '';
    return `<a class="cal-dtrade ${cls}" href="#/trade/${esc(t.id)}">
      <span class="cal-dthumb">${img ? `<img loading="lazy" decoding="async" src="${imgUrl(img)}" alt="">` : '<em>No chart</em>'}</span>
      <span class="cal-dinfo">
        <span><b class="sym">${esc(t.symbol)}</b> <i class="side ${esc(t.side)}">${esc(t.side)}</i> ${time ? `<small>${time}</small>` : ''}</span>
        <small>${[t.strategy, t.session].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</small>
        <small>Entry ${fmtNum(t.entry, 5)} · SL ${fmtNum(t.sl, 5)} · TP ${fmtNum(t.tp, 5)}${isNum(t.exit) ? ' · Exit ' + fmtNum(t.exit, 5) : ''}</small>
      </span>
      <span class="cal-dres"><b class="${t.pnl > 0 ? 'cal-pos' : t.pnl < 0 ? 'cal-neg' : ''}">${isClosed(t) ? money(t.pnl, true) : 'Open'}</b><small>${isNum(t.r) ? fmtNum(t.r) + ' R' : ''}</small></span>
    </a>`;
  }).join('');
  return `<div class="cal-dlist">${rows}</div>`;
}
