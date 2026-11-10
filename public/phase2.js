
'use strict';

/* =========================================================
   EDGE Phase 2: Intelligence Layer
   Observed patterns only. No external AI or invented signals.
   ========================================================= */

const P2 = {
  minSample: 3,
  query: '',
  range: '30',
  expanded: null
};

function p2Closed(list) { return list.filter(isClosed); }
function p2R(t) { return tradeR(t); }
function p2Avg(list) {
  const vals = list.map(p2R).filter(isNum);
  return vals.length ? sum(vals) / vals.length : null;
}
function p2WinRate(list) {
  const c = p2Closed(list);
  return c.length ? c.filter(t => t.pnl > 0).length / c.length : null;
}
function p2Expectancy(list) {
  const rs = p2Closed(list).map(t => p2R(t)).filter(isNum);
  return rs.length ? sum(rs) / rs.length : null;
}
function p2Label(n, d=2) { return isNum(n) ? fmtNum(n,d) : '—'; }
function p2Pct(n) { return isNum(n) ? Math.round(n * 100) + '%' : '—'; }
function p2Name(v) { return String(v || 'Unclassified').trim() || 'Unclassified'; }

function p2Group(list, keyFn) {
  const map = new Map();
  list.forEach(t => {
    const key = keyFn(t);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  });
  return [...map.entries()].map(([name, trades]) => ({
    name, trades,
    closed: p2Closed(trades),
    avgR: p2Avg(trades),
    winRate: p2WinRate(trades),
    expectancy: p2Expectancy(trades),
    net: sum(p2Closed(trades).map(t => t.pnl)),
  }));
}

function p2Rank(groups, metric='expectancy') {
  return groups
    .filter(g => g.closed.length >= P2.minSample && isNum(g[metric]))
    .sort((a,b) => b[metric] - a[metric]);
}

function p2Confidence(n) {
  if (n >= 20) return 'HIGH';
  if (n >= 8) return 'MEDIUM';
  return 'EARLY';
}

function p2Evidence(n) {
  return `${p2Confidence(n)} evidence · ${n} closed trade${n === 1 ? '' : 's'}`;
}

function p2RuleRows(list) {
  const rules = [...new Set(list.flatMap(t => t.rulesAll || []))];
  return rules.map(rule => {
    const followed = list.filter(t => (t.rulesAll || []).includes(rule) && (t.rulesChecked || []).includes(rule));
    const broken = list.filter(t => (t.rulesAll || []).includes(rule) && !(t.rulesChecked || []).includes(rule));
    const fR = p2Avg(followed), bR = p2Avg(broken);
    return {
      rule, followed, broken, fR, bR,
      delta: isNum(fR) && isNum(bR) ? fR - bR : null,
      fWin: p2WinRate(followed), bWin: p2WinRate(broken)
    };
  }).filter(r => r.followed.length || r.broken.length);
}

function p2MistakeRows(list) {
  const names = [...new Set(list.flatMap(t => t.mistakes || []))];
  return names.map(name => {
    const affected = list.filter(t => (t.mistakes || []).includes(name));
    const clean = list.filter(t => !(t.mistakes || []).includes(name));
    return {
      name, affected, clean,
      avgR: p2Avg(affected),
      cleanR: p2Avg(clean),
      delta: isNum(p2Avg(affected)) && isNum(p2Avg(clean)) ? p2Avg(affected) - p2Avg(clean) : null,
      winRate: p2WinRate(affected)
    };
  }).sort((a,b) => (a.delta ?? 0) - (b.delta ?? 0));
}

function p2ExecutionScore(t) {
  if (!t.rulesAll?.length && !t.mistakes?.length) return null;
  const total = t.rulesAll?.length || 0;
  const checked = t.rulesChecked?.length || 0;
  const ruleScore = total ? checked / total : 1;
  const penalty = Math.min(.6, (t.mistakes?.length || 0) * .15);
  return Math.max(0, Math.min(100, Math.round((ruleScore * (1 - penalty)) * 100)));
}

function p2WeekStart() {
  const d = new Date();
  const day = d.getDay();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function p2LastNDays(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function p2Scope() {
  const start = P2.range === '7' ? p2LastNDays(7) :
    P2.range === '90' ? p2LastNDays(90) : p2LastNDays(30);
  return state.trades.filter(t => dayKey(t) >= start);
}

function p2TopGroup(list, keyFn) {
  const groups = p2Rank(p2Group(list, keyFn), 'expectancy');
  return groups[0] || null;
}

function p2Leak(list) {
  const mistakes = p2MistakeRows(list).filter(x => x.affected.length >= P2.minSample && isNum(x.delta));
  return mistakes[0] || null;
}

function p2Story(list) {
  const c = p2Closed(list);
  if (!c.length) return { headline: 'The engine needs more closed trades.', detail: 'Record outcomes, rules and mistakes consistently. Patterns become useful when the journal has enough evidence.' };
  const rs = c.map(p2R).filter(isNum);
  const netR = sum(rs);
  const best = p2TopGroup(c, t => t.strategy);
  const session = p2TopGroup(c, t => t.session);
  const leak = p2Leak(c);
  if (leak) return {
    headline: `Your clearest leak is ${leak.name.toLowerCase()}.`,
    detail: `${leak.affected.length} affected trades average ${p2Label(leak.avgR)}R versus ${p2Label(leak.cleanR)}R when that behavior is absent.`
  };
  if (best) return {
    headline: `${best.name} is your strongest repeated setup.`,
    detail: `${best.closed.length} closed trades show ${p2Label(best.expectancy)}R expectancy with ${p2Pct(best.winRate)} wins.`
  };
  return {
    headline: netR >= 0 ? 'Your recent results are positive.' : 'Your recent results need a process review.',
    detail: `${c.length} closed trades produced ${p2Label(netR)}R. The next step is to connect that result to rules, sessions and setups.`
  };
}

function p2MiniBar(v, max=1) {
  const w = Math.max(2, Math.min(100, Math.abs(v) / Math.max(max, .01) * 100));
  return `<span class="p2-bar"><i style="width:${w}%"></i></span>`;
}

function p2GroupCard(g, label) {
  return `<div class="p2-pattern">
    <div><span class="p2-kicker">${esc(label)}</span><h3>${esc(g.name)}</h3></div>
    <div class="p2-pattern-stats">
      <span><b>${p2Label(g.expectancy)}R</b><small>expectancy</small></span>
      <span><b>${p2Pct(g.winRate)}</b><small>win rate</small></span>
      <span><b>${g.closed.length}</b><small>closed</small></span>
    </div>
    <div class="p2-evidence">${p2Evidence(g.closed.length)}</div>
  </div>`;
}

function p2MistakeCard(m) {
  const cls = isNum(m.delta) && m.delta < 0 ? 'neg' : 'pos';
  return `<div class="p2-leak">
    <div class="p2-leak-main"><span class="p2-kicker">BEHAVIOR</span><h3>${esc(m.name)}</h3><p>${m.affected.length} affected trades</p></div>
    <div class="p2-leak-number ${cls}">${p2Label(m.avgR)}R</div>
    <div class="p2-leak-compare"><span>Without it</span><b>${p2Label(m.cleanR)}R</b><em>${isNum(m.delta) ? (m.delta >= 0 ? '+' : '') + p2Label(m.delta) + 'R impact' : 'Need more R data'}</em></div>
  </div>`;
}

function viewInsights() {
  P2.range = P2.range || '30';
  view.innerHTML = `
    <div class="p2-head">
      <div>
        <div class="eyebrow">PHASE 2 · INTELLIGENCE</div>
        <h1>How are you actually trading?</h1>
        <p class="sub">The pattern engine reads your recorded behavior and connects it to outcomes. It does not invent signals.</p>
      </div>
      <div class="p2-range">
        <button class="btn small ${P2.range==='7'?'gold':''}" data-p2-range="7">7 days</button>
        <button class="btn small ${P2.range==='30'?'gold':''}" data-p2-range="30">30 days</button>
        <button class="btn small ${P2.range==='90'?'gold':''}" data-p2-range="90">90 days</button>
      </div>
    </div>
    <div id="p2-body"></div>`;
  $$('[data-p2-range]').forEach(b => b.onclick = () => {
    P2.range = b.dataset.p2Range;
    paintInsights();
  });
  paintInsights();
}

function paintInsights() {
  const list = p2Scope();
  const c = p2Closed(list);
  const week = state.trades.filter(t => dayKey(t) >= p2WeekStart());
  const weekClosed = p2Closed(week);
  const story = p2Story(c);
  const leak = p2Leak(c);
  const bestSetup = p2TopGroup(c, t => t.strategy);
  const bestSession = p2TopGroup(c, t => t.session);
  const bestSymbol = p2TopGroup(c, t => t.symbol);
  const bestSide = p2TopGroup(c, t => t.side);
  const scores = c.map(p2ExecutionScore).filter(isNum);
  const avgScore = scores.length ? sum(scores) / scores.length : null;
  const weekR = sum(weekClosed.map(p2R).filter(isNum));
  const weekRules = weekClosed.filter(t => t.rulesAll?.length).map(t => t.rulesChecked.length / t.rulesAll.length);
  const weekRulePct = weekRules.length ? sum(weekRules) / weekRules.length : null;
  const ruleRows = p2RuleRows(c);
  const weakRules = ruleRows.filter(r => r.broken.length >= P2.minSample && isNum(r.delta)).sort((a,b) => a.delta - b.delta).slice(0,5);
  const mistakes = p2MistakeRows(c).filter(m => m.affected.length >= P2.minSample && isNum(m.delta)).slice(0,5);

  const insufficient = c.length < P2.minSample;
  $('#p2-body').innerHTML = `
    <section class="p2-story">
      <div class="p2-story-main">
        <span class="p2-kicker">YOUR CURRENT STORY</span>
        <h2>${esc(story.headline)}</h2>
        <p>${esc(story.detail)}</p>
      </div>
      <div class="p2-story-week">
        <span>THIS WEEK</span>
        <b class="${signClass(weekR)}">${weekClosed.length ? (weekR >= 0 ? '+' : '') + p2Label(weekR) + 'R' : '—'}</b>
        <small>${weekClosed.length} closed · ${weekRulePct == null ? 'No rule data' : p2Pct(weekRulePct) + ' rule adherence'}</small>
      </div>
    </section>

    ${insufficient ? `<section class="p2-notice"><b>Pattern engine warming up</b><span>${c.length} closed trade${c.length===1?'':'s'} in this period. You need at least ${P2.minSample} examples before a pattern is surfaced as meaningful.</span></section>` : ''}

    <section class="p2-dna">
      <div class="p2-section-head"><div><span class="p2-kicker">TRADING DNA</span><h2>Where your process is strongest</h2></div><span class="p2-note">Ranked by expectancy · minimum ${P2.minSample} trades</span></div>
      <div class="p2-dna-grid">
        ${bestSession ? p2GroupCard(bestSession, 'BEST SESSION') : `<div class="p2-empty">Not enough session data</div>`}
        ${bestSetup ? p2GroupCard(bestSetup, 'BEST SETUP') : `<div class="p2-empty">Not enough setup data</div>`}
        ${bestSymbol ? p2GroupCard(bestSymbol, 'BEST INSTRUMENT') : `<div class="p2-empty">Not enough instrument data</div>`}
        ${bestSide ? p2GroupCard(bestSide, 'BEST DIRECTION') : `<div class="p2-empty">Not enough direction data</div>`}
      </div>
    </section>

    <section class="p2-two">
      <div class="card p2-panel">
        <div class="p2-section-head"><div><span class="p2-kicker">LEAK DETECTOR</span><h2>Behaviors costing you R</h2></div></div>
        ${mistakes.length ? `<div class="p2-leaks">${mistakes.map(p2MistakeCard).join('')}</div>` : `<div class="p2-empty large">No behavior has enough evidence yet. Keep recording mistakes on losing and winning trades.</div>`}
      </div>
      <div class="card p2-panel">
        <div class="p2-section-head"><div><span class="p2-kicker">EXECUTION</span><h2>Process versus outcome</h2></div><span class="p2-score">${avgScore == null ? '—' : Math.round(avgScore) + '/100'}</span></div>
        <p class="p2-explain">Execution score is based on recorded rule adherence and logged mistakes. Profit does not directly increase the score.</p>
        <div class="p2-score-list">
          ${c.slice().sort((a,b) => (p2ExecutionScore(a) ?? 999) - (p2ExecutionScore(b) ?? 999)).slice(0,6).map(t => `
            <a href="#/trade/${t.id}" class="p2-score-row">
              <span>${esc(t.symbol)} · ${fmtDateTime(t.openedAt)}</span>
              <b>${p2ExecutionScore(t) == null ? '—' : p2ExecutionScore(t) + '/100'}</b>
              <em class="${signClass(t.pnl)}">${money(t.pnl,true)}</em>
            </a>`).join('') || `<div class="p2-empty">No scored trades yet.</div>`}
        </div>
      </div>
    </section>

    <section class="card p2-panel">
      <div class="p2-section-head"><div><span class="p2-kicker">RULE CORRELATION</span><h2>What happens when you follow the rule?</h2></div><span class="p2-note">Observed difference in average R</span></div>
      ${weakRules.length ? `<div class="p2-rule-table">
        <div class="p2-rule-head"><span>Rule</span><span>Followed</span><span>Broken</span><span>Difference</span></div>
        ${weakRules.map(r => `<div class="p2-rule-row">
          <span><b>${esc(r.rule)}</b><small>${r.followed.length + r.broken.length} observations</small></span>
          <span>${p2Label(r.fR)}R</span><span>${p2Label(r.bR)}R</span><strong class="${signClass(r.delta)}">${r.delta >= 0 ? '+' : ''}${p2Label(r.delta)}R</strong>
        </div>`).join('')}
      </div>` : `<div class="p2-empty large">No rule has enough followed and broken examples to calculate a useful comparison yet.</div>`}
    </section>

    <section class="p2-two">
      <div class="card p2-panel">
        <div class="p2-section-head"><div><span class="p2-kicker">PATTERN MATRIX</span><h2>Session × setup</h2></div></div>
        <div class="p2-matrix">${p2Matrix(c)}</div>
      </div>
      <div class="card p2-panel">
        <div class="p2-section-head"><div><span class="p2-kicker">RESEARCH QUEUE</span><h2>Trades worth studying</h2></div></div>
        ${p2ResearchQueue(c).map(t => `<a href="#/replay/${t.id}" class="p2-study-row">
          <span class="p2-study-score">${t._study}</span>
          <span><b>${esc(t.symbol)} · ${esc(t.strategy || 'Unclassified')}</b><small>${t.mistakes?.length ? esc(t.mistakes[0]) : 'Review execution'} · ${fmtDateTime(t.openedAt)}</small></span>
          <strong class="${signClass(t.pnl)}">${isClosed(t) ? money(t.pnl,true) : 'OPEN'}</strong>
        </a>`).join('') || `<div class="p2-empty">No study candidates yet.</div>`}
      </div>
    </section>

    <section class="p2-command card">
      <div><span class="p2-kicker">COMMAND SEARCH</span><h2>Ask the journal</h2><p>Search the recorded evidence using plain language.</p></div>
      <div class="p2-command-row">
        <input id="p2-query" value="${esc(P2.query)}" placeholder="show losing XAUUSD trades from New York" autocomplete="off">
        <button class="btn gold" id="p2-search">Search</button>
      </div>
      <div id="p2-results">${P2.query ? p2Search(P2.query) : '<span class="p2-command-hint">Try: best XAUUSD trades · losing New York trades · rule violations · revenge trades</span>'}</div>
    </section>`;
  const inp = $('#p2-query');
  if (inp) {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { P2.query = inp.value.trim(); paintInsights(); }});
    $('#p2-search').onclick = () => { P2.query = inp.value.trim(); paintInsights(); };
  }
}

function p2Matrix(list) {
  const groups = p2Group(list, t => `${t.session || 'Unknown'} · ${p2Name(t.strategy)}`);
  const sorted = groups.filter(g => g.closed.length >= 2).sort((a,b) => (b.expectancy ?? -99) - (a.expectancy ?? -99)).slice(0,8);
  if (!sorted.length) return '<div class="p2-empty">Record more session and setup data to build this matrix.</div>';
  return sorted.map(g => `<div class="p2-matrix-row">
    <span>${esc(g.name)}</span><b class="${signClass(g.expectancy)}">${p2Label(g.expectancy)}R</b><small>${g.closed.length} trades · ${p2Pct(g.winRate)} win</small>
  </div>`).join('');
}

function p2ResearchQueue(list) {
  return list.map(t => {
    let score = 0;
    if (t.mistakes?.length) score += 5 + t.mistakes.length;
    if (t.rulesAll?.length) score += Math.max(0, t.rulesAll.length - (t.rulesChecked?.length || 0));
    if (isClosed(t) && t.pnl < 0) score += 2;
    if (isClosed(t) && t.pnl > 0 && (p2ExecutionScore(t) ?? 100) >= 90) score += 3;
    if (!t.notes?.lesson) score += 1;
    t._study = score;
    return t;
  }).filter(t => t._study > 0).sort((a,b) => b._study - a._study || (b.openedAt || '').localeCompare(a.openedAt || '')).slice(0,6);
}

function p2Search(q) {
  const s = q.toLowerCase();
  let list = state.trades.slice();
  const symbol = (state.settings.pairs || []).map(p => p.symbol).find(x => s.includes(x.toLowerCase()));
  const sessions = ['asia','london','new york'];
  const session = sessions.find(x => s.includes(x));
  if (symbol) list = list.filter(t => t.symbol.toLowerCase() === symbol.toLowerCase());
  if (session) list = list.filter(t => (t.session || '').toLowerCase() === session);
  if (/\blosing|loss|losers|negative\b/.test(s)) list = list.filter(t => isClosed(t) && t.pnl < 0);
  if (/\bwinning|win|winners|positive|best\b/.test(s)) list = list.filter(t => isClosed(t) && t.pnl > 0);
  if (/\brule|violation|broken\b/.test(s)) list = list.filter(t => t.rulesAll?.length && t.rulesChecked.length < t.rulesAll.length);
  const mistake = [...new Set(state.trades.flatMap(t => t.mistakes || []))].find(m => s.includes(m.toLowerCase()));
  if (mistake) list = list.filter(t => (t.mistakes || []).includes(mistake));
  const setup = [...new Set(state.trades.map(t => t.strategy).filter(Boolean))].find(x => s.includes(x.toLowerCase()));
  if (setup) list = list.filter(t => t.strategy === setup);
  list = list.filter(t => isClosed(t)).sort((a,b) => (p2R(b) ?? -999) - (p2R(a) ?? -999));
  const label = `${list.length} matching closed trade${list.length===1?'':'s'}`;
  return `<div class="p2-search-head"><b>${label}</b>${list.length ? '<span>Sorted by R</span>' : ''}</div>
    ${list.slice(0,10).map(t => `<a class="p2-search-row" href="#/trade/${t.id}">
      <span><b>${esc(t.symbol)}</b><small>${esc(t.session || 'No session')} · ${esc(t.strategy || 'No setup')}</small></span>
      <strong class="${signClass(t.pnl)}">${p2Label(p2R(t))}R</strong>
      <em>${money(t.pnl,true)}</em>
    </a>`).join('') || '<div class="p2-empty">Nothing matched the recorded data.</div>'}`;
}

/* Replace the Phase 1 router hook with Phase 2 navigation. */
const p2OriginalRoute = route;
route = function() {
  const [, page] = location.hash.split('/');
  if (page === 'insights') {
    if (cleanupView) { cleanupView(); cleanupView = null; }
    $$('.nav').forEach(a => a.classList.toggle('on', a.dataset.route === 'insights'));
    window.scrollTo(0,0);
    return viewInsights();
  }
  return p2OriginalRoute();
};

boot();
