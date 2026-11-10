'use strict';

/* EDGE Phase 3: Advanced intelligence, searchable evidence and knowledge base. */
const P3 = { tab:'search', q:'', tag:'', knowledge:null };

function p3Closed(){ return state.trades.filter(isClosed); }
function p3Tags(){
  const tags = new Set();
  state.trades.forEach(t => Object.values(t.imageTags || {}).flat().forEach(x => tags.add(x)));
  return [...tags].sort((a,b)=>a.localeCompare(b));
}
function p3AllImageRefs(){
  const out=[];
  state.trades.forEach(t=>{
    [...(t.images?.before||[]),...(t.images?.after||[])].forEach(file=>out.push({t,file,tags:t.imageTags?.[file]||[]}));
  });
  return out;
}
function p3Text(t){ return [t.symbol,t.side,t.session,t.strategy,...(t.mistakes||[]),...(t.rulesAll||[]),...(t.rulesChecked||[]),t.notes?.why,t.notes?.feelings,t.notes?.lesson,...Object.values(t.captions||{}),...Object.values(t.imageTags||{}).flat()].join(' ').toLowerCase(); }
function p3Search(q){
  const s=String(q||'').trim().toLowerCase();
  let list=state.trades.slice();
  const sym=state.trades.map(t=>t.symbol).find(x=>s.includes(x.toLowerCase()));
  const sessions=['asia','london','new york']; const session=sessions.find(x=>s.includes(x));
  const setups=[...new Set(state.trades.map(t=>t.strategy).filter(Boolean))]; const setup=setups.find(x=>s.includes(x.toLowerCase()));
  const mistakes=[...new Set(state.trades.flatMap(t=>t.mistakes||[]))]; const mistake=mistakes.find(x=>s.includes(x.toLowerCase()));
  const tags=p3Tags(); const tag=tags.find(x=>s.includes(x.toLowerCase()));
  if(sym) list=list.filter(t=>t.symbol===sym);
  if(session) list=list.filter(t=>(t.session||'').toLowerCase()===session);
  if(setup) list=list.filter(t=>t.strategy===setup);
  if(mistake) list=list.filter(t=>(t.mistakes||[]).includes(mistake));
  if(tag) list=list.filter(t=>Object.values(t.imageTags||{}).flat().includes(tag));
  if(/\b(rule|rules|violation|violations|broken|break)\b/.test(s)) list=list.filter(t=>t.rulesAll?.length && t.rulesChecked.length<t.rulesAll.length);
  if(/\b(losing|loss|losers|negative)\b/.test(s)) list=list.filter(t=>isClosed(t)&&t.pnl<0);
  if(/\b(winning|wins|winners|positive)\b/.test(s)) list=list.filter(t=>isClosed(t)&&t.pnl>0);
  if(/\b(open)\b/.test(s)) list=list.filter(t=>!isClosed(t));
  if(/\b(best|top)\b/.test(s)) list=list.filter(isClosed).sort((a,b)=>(tradeR(b)??-999)-(tradeR(a)??-999));
  else list=list.filter(t=>isClosed(t)||/\bopen\b/.test(s)).sort((a,b)=>(b.openedAt||'').localeCompare(a.openedAt||''));
  if(s && !sym&&!session&&!setup&&!mistake&&!tag&&!/\b(rule|rules|violation|violations|broken|break|losing|loss|losers|negative|winning|wins|winners|positive|open|best|top)\b/.test(s)) list=list.filter(t=>p3Text(t).includes(s));
  return list;
}
function p3TagImage(t,file){
  const current=t.imageTags||{}; const raw=prompt('Add tags separated by commas. Existing: '+((current[file]||[]).join(', ')||'none'));
  if(raw===null) return;
  const tags=[...new Set(raw.split(',').map(x=>x.trim().replace(/^#/,'').slice(0,32)).filter(Boolean))].slice(0,12);
  const next=JSON.parse(JSON.stringify(t)); next.imageTags=Object.assign({},current,{[file]:tags});
  api('/trades/'+t.id,{method:'PUT',body:JSON.stringify(next)}).then(saved=>{const i=state.trades.findIndex(x=>x.id===saved.id); if(i>=0){normTrade(saved);state.trades[i]=saved;} toast('Screenshot tags saved'); route();}).catch(e=>toast(e.message));
}
function p3Review(t){
  const rules=t.rulesAll||[], checked=t.rulesChecked||[], mistakes=t.mistakes||[], score=typeof p2ExecutionScore==='function'?p2ExecutionScore(t):null;
  const lines=[];
  if(rules.length) lines.push({c:checked.length===rules.length?'good':'bad',x:`Rule execution: ${checked.length}/${rules.length} rules followed.`});
  if(mistakes.length) lines.push({c:'bad',x:`Recorded behaviors: ${mistakes.join(', ')}.`});
  if(isNum(tradeR(t))) lines.push({c:tradeR(t)>=0?'good':'warn',x:`Outcome: ${fmtNum(tradeR(t))}R. Profit does not override execution quality.`});
  if(t.notes?.lesson) lines.push({c:'good',x:`Lesson recorded: ${t.notes.lesson}`});
  if(!lines.length) lines.push({c:'warn',x:'Not enough structured evidence. Add rules, mistakes and a lesson to make the review stronger.'});
  const strongest = rules.filter(r=>checked.includes(r));
  if(strongest.length) lines.push({c:'good',x:`Process evidence: ${strongest.length} rule${strongest.length===1?' was':'s were'} explicitly confirmed.`});
  return {score,lines};
}
function p3Pattern(){
  const c=p3Closed(); if(!c.length) return {title:'Not enough evidence yet',body:'Record more closed trades with consistent setup, rule and mistake labels.'};
  const mistakes=[...new Set(c.flatMap(t=>t.mistakes||[]))].map(m=>{const a=c.filter(t=>(t.mistakes||[]).includes(m));return {m,a,r:p2Avg(a),n:a.length}}).filter(x=>x.n>=3).sort((a,b)=>(a.r??0)-(b.r??0));
  if(mistakes[0]) return {title:`The pattern worth investigating is ${mistakes[0].m}.`,body:`It appears in ${mistakes[0].n} closed trades with ${p2Label(mistakes[0].r)}R average. This is an observed correlation, not proof of causation.`};
  const setups=p2Rank(p2Group(c,t=>t.strategy),'expectancy'); if(setups[0]) return {title:`${setups[0].name} is producing your strongest repeated evidence.`,body:`${setups[0].closed.length} closed trades show ${p2Label(setups[0].expectancy)}R expectancy. Study the examples before changing your rules.`};
  return {title:'Your journal needs more structured labels.',body:'Consistent setup, session, rules and mistake labels will make the advanced layer more useful.'};
}
function p3ResultRow(t){const file=t.images?.before?.[0]||t.images?.after?.[0];return `<a class="p3-result" href="#/trade/${t.id}"><span class="p3-result-thumb">${file?`<img src="${imgUrl(file)}" alt="">`:'No image'}</span><span class="p3-result-main"><b>${esc(t.symbol)} · ${esc(t.strategy||'No setup')}</b><small>${esc(t.session||'No session')} · ${fmtDateTime(t.openedAt)}${t.mistakes?.length?' · '+esc(t.mistakes.join(', ')):''}</small></span><strong class="p3-result-r">${isNum(tradeR(t))?fmtNum(tradeR(t))+'R':'OPEN'}<small>${isClosed(t)?money(t.pnl,true):''}</small></strong></a>`}
function viewP3Search(){
  const list=p3Search(P3.q); const tags=p3Tags();
  view.innerHTML=`<div class="p3-shell"><div class="p3-head"><div><span class="p3-kicker">PHASE 3 · ADVANCED SEARCH</span><h1>Find the evidence.</h1><p>Search trades, behaviors, setups and screenshot tags from one place.</p></div><a class="btn gold" href="#/add">Record trade</a></div><div class="p3-grid"><section class="p3-panel"><span class="p3-kicker">COMMAND SEARCH</span><div class="p3-search"><input id="p3-q" value="${esc(P3.q)}" placeholder="show losing XAUUSD trades"><button class="btn gold" id="p3-go">Search</button></div><div class="p3-tags">${tags.slice(0,18).map(t=>`<button class="p3-tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div><div class="p3-results" id="p3-results">${list.length?list.slice(0,30).map(p3ResultRow).join(''):'<div class="p3-empty">No matching trades. Try “losing”, “rule violations”, a symbol, a setup or a screenshot tag.</div>'}</div></section><section class="p3-panel p3-ai"><span class="p3-kicker">ASSISTED REVIEW</span><h2>What deserves attention?</h2><div class="p3-verdict">${esc(p3Pattern().title)}</div><p>${esc(p3Pattern().body)}</p><div class="p3-evidence"><div><span>Closed trades</span><b>${p3Closed().length}</b></div><div><span>Tagged screenshots</span><b>${p3AllImageRefs().filter(x=>x.tags.length).length}</b></div><div><span>Known behaviors</span><b>${new Set(state.trades.flatMap(t=>t.mistakes||[])).size}</b></div></div></section></div></div>`;
  const q=$('#p3-q'); const go=()=>{P3.q=q.value.trim();viewP3Search()}; q.onkeydown=e=>{if(e.key==='Enter')go()}; $('#p3-go').onclick=go; $$('[data-tag]').forEach(b=>b.onclick=()=>{P3.q='#'+b.dataset.tag;viewP3Search()});
}
function viewP3Library(){
  const refs=p3AllImageRefs(); const tagged=refs.filter(x=>x.tags.length); const tags=p3Tags();
  view.innerHTML=`<div class="p3-shell"><div class="p3-head"><div><span class="p3-kicker">PHASE 3 · VISUAL KNOWLEDGE</span><h1>Screenshot Library</h1><p>Your charts become searchable evidence instead of forgotten attachments.</p></div></div><div class="p3-panel"><span class="p3-kicker">TAGS</span><div class="p3-tags"><button class="p3-tag ${!P3.tag?'active':''}" data-libtag="">All</button>${tags.map(t=>`<button class="p3-tag ${P3.tag===t?'active':''}" data-libtag="${esc(t)}">#${esc(t)}</button>`).join('')}</div><div class="p3-library">${(P3.tag?tagged.filter(x=>x.tags.includes(P3.tag)):tagged).slice(0,60).map(x=>`<article class="p3-card"><div class="p3-card-img"><img src="${imgUrl(x.file)}" alt=""></div><div class="p3-card-body"><b>${esc(x.t.symbol)} · ${esc(x.t.strategy||'No setup')}</b><small>${esc(x.file)} · ${fmtDateTime(x.t.openedAt)}</small><div class="p3-tags">${x.tags.map(t=>`<span class="p3-tag active">#${esc(t)}</span>`).join('')}</div><button class="btn small" data-retag="${esc(x.t.id)}" data-file="${esc(x.file)}">Edit tags</button> <a class="btn small" href="#/trade/${x.t.id}">Open trade</a></div></article>`).join('')||'<div class="p3-empty">No tagged screenshots yet. Open a trade below and tag its screenshots.</div>'}</div></div></div>`;
  $$('[data-libtag]').forEach(b=>b.onclick=()=>{P3.tag=b.dataset.libtag;viewP3Library()});
  $$('[data-retag]').forEach(b=>b.onclick=()=>{const t=state.trades.find(x=>x.id===b.dataset.retag);if(t)p3TagImage(t,b.dataset.file)});
}
async function viewP3Knowledge(){
  let notes=[]; try{notes=await api('/knowledge')}catch(e){}
  view.innerHTML=`<div class="p3-shell"><div class="p3-head"><div><span class="p3-kicker">PHASE 3 · PERSONAL KNOWLEDGE</span><h1>Trading Knowledge Base</h1><p>Keep your own rules, discoveries and lessons beside the evidence that supports them.</p></div></div><div class="p3-grid"><section class="p3-panel"><span class="p3-kicker">NEW NOTE</span><div class="p3-form"><input id="kb-title" placeholder="Title"><select id="kb-type"><option>Rule</option><option>Discovery</option><option>Lesson</option><option>Setup note</option></select><textarea id="kb-body" placeholder="Write what you learned and what evidence supports it."></textarea><button class="btn gold" id="kb-save">Save to knowledge base</button></div></section><section class="p3-panel"><span class="p3-kicker">OBSERVED FROM JOURNAL</span><div class="p3-verdict">${esc(p3Pattern().title)}</div><p>${esc(p3Pattern().body)}</p></section></div><div class="p3-kb">${notes.map(n=>`<article class="p3-note"><span class="p3-kicker">${esc(n.type||'NOTE')}</span><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${esc(n.createdAt||'')}</small></article>`).join('')||'<div class="p3-empty">Your knowledge base is empty.</div>'}</div></div>`;
  $('#kb-save').onclick=async()=>{const title=$('#kb-title').value.trim(),body=$('#kb-body').value.trim();if(!title||!body)return toast('Add a title and note');await api('/knowledge',{method:'POST',body:JSON.stringify({title,body,type:$('#kb-type').value})});toast('Knowledge saved');viewP3Knowledge()};
}
function viewP3Review(){
  const list=p3Closed().slice().sort((a,b)=>(b.openedAt||'').localeCompare(a.openedAt||'')).slice(0,12); const selected=P3.knowledge||list[0];
  if(!selected){view.innerHTML='<div class="p3-shell"><div class="p3-empty">Record a closed trade first.</div></div>';return}
  const r=p3Review(selected); const files=[...(selected.images?.before||[]),...(selected.images?.after||[])];
  view.innerHTML=`<div class="p3-shell"><div class="p3-head"><div><span class="p3-kicker">PHASE 3 · ASSISTED REVIEW</span><h1>Review the process.</h1><p>Structured evidence is used to generate review prompts. This does not replace your own judgment.</p></div><select id="p3-trade-select">${list.map(t=>`<option value="${esc(t.id)}" ${t.id===selected.id?'selected':''}>${esc(t.symbol)} · ${fmtDateTime(t.openedAt)} · ${isNum(tradeR(t))?fmtNum(tradeR(t))+'R':''}</option>`).join('')}</select></div><div class="p3-grid"><section class="p3-panel"><span class="p3-kicker">EXECUTION SCORE</span><div class="p3-score"><span class="p3-score-num">${r.score===null?'—':r.score}</span>${r.score!==null?`<div class="p3-meter"><i style="width:${r.score}%"></i></div>`:''}</div><div class="p3-review-list">${r.lines.map(x=>`<div class="p3-review ${x.c}">${esc(x.x)}</div>`).join('')}</div></section><section class="p3-panel"><span class="p3-kicker">SCREENSHOT EVIDENCE</span><div class="p3-library">${files.map(f=>`<article class="p3-card"><div class="p3-card-img"><img src="${imgUrl(f)}" alt=""></div><div class="p3-card-body"><b>${esc(selected.captions?.[f]||'Trade screenshot')}</b><div class="p3-tags">${(selected.imageTags?.[f]||[]).map(t=>`<span class="p3-tag active">#${esc(t)}</span>`).join('')}</div><button class="btn small" data-tagfile="${esc(f)}">Tag screenshot</button></div></article>`).join('')||'<div class="p3-empty">No screenshots attached.</div>'}</div></section></div></div>`;
  $('#p3-trade-select').onchange=e=>{P3.knowledge=state.trades.find(t=>t.id===e.target.value);viewP3Review()};
  $$('[data-tagfile]').forEach(b=>b.onclick=()=>p3TagImage(selected,b.dataset.tagfile));
}
function p3Route(){const [,page]=location.hash.split('/'); if(['search3','library','knowledge','review3'].includes(page)){if(cleanupView){cleanupView();cleanupView=null;}$$('.nav').forEach(a=>a.classList.toggle('on',false));window.scrollTo(0,0);if(page==='search3')viewP3Search();else if(page==='library')viewP3Library();else if(page==='knowledge')viewP3Knowledge();else viewP3Review();return true;} return false;}
const p3OriginalRoute=route;
route=function(){if(p3Route())return p3Route();return p3OriginalRoute()};
window.addEventListener('hashchange',()=>{const p=location.hash.split('/')[1];if(['search3','library','knowledge','review3'].includes(p))route()});
setTimeout(()=>{const p=location.hash.split('/')[1];if(['search3','library','knowledge','review3'].includes(p))route()},0);
