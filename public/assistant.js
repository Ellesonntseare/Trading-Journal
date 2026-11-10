'use strict';
(function(){
  let open=false, sending=false, history=[];
  const escA=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function mount(){
    if(document.getElementById('edge-ai-launcher')) return;
    document.body.insertAdjacentHTML('beforeend',`<button id="edge-ai-launcher" class="edge-ai-launcher"><span class="edge-ai-orb"><img src="ai-logo.png" alt="" width="22" height="22"></span><span>EDGE AI</span></button><section id="edge-ai-panel" class="edge-ai-panel" aria-label="EDGE AI Assistant"><header class="edge-ai-head"><div><b>EDGE AI</b><small>Your journal, your website, one assistant.</small></div><button id="edge-ai-close" class="edge-ai-close">×</button></header><div id="edge-ai-scope" class="edge-ai-scope" hidden></div><div id="edge-ai-messages" class="edge-ai-messages"></div><div class="edge-ai-suggestions"><button class="edge-ai-suggestion">How does this site work?</button><button class="edge-ai-suggestion">How am I trading?</button><button class="edge-ai-suggestion">What is my biggest leak?</button><button class="edge-ai-suggestion">Show my best setup</button></div><div id="edge-ai-status" class="edge-ai-status">Checking AI connection…</div><form id="edge-ai-form" class="edge-ai-input"><textarea id="edge-ai-input" placeholder="Ask anything about EDGE or your stats…" rows="1"></textarea><button id="edge-ai-mic" class="edge-ai-mic" type="button" title="Hands-free voice chat" aria-label="Hands-free voice chat">🎤</button><button class="edge-ai-send" type="submit">↑</button></form></section>`);
    $('#edge-ai-launcher').onclick=()=>toggle(true); $('#edge-ai-close').onclick=()=>toggle(false);
    $('#edge-ai-mic').onclick=()=>setVoice(!voiceOn);
    if(!SR||!window.speechSynthesis)$('#edge-ai-mic').style.display='none';
    $('#edge-ai-form').onsubmit=e=>{e.preventDefault();send($('#edge-ai-input').value)};
    $$('.edge-ai-suggestion').forEach(b=>b.onclick=()=>send(b.textContent));
    $('#edge-ai-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#edge-ai-form').requestSubmit()}};
    api('/assistant/status').then(x=>{$('#edge-ai-status').textContent=x.disabledBy ? x.message : x.running ? `Groq · ${x.model}` : (x.configured ? 'Groq connection failed' : 'Groq API key not configured');if(x.disabledBy || !x.running || !x.configured)$('#edge-ai-status').classList.add('off')}).catch(()=>{$('#edge-ai-status').textContent='Assistant status unavailable';});
    add('assistant','I can explain how EDGE works, analyze your journal statistics, compare setups, find patterns, and review individual trades. Ask me anything.');
  }
  function toggle(v){if(!v&&voiceOn)setVoice(false);open=v;$('#edge-ai-panel').classList.toggle('open',v);if(v){loadScopes();setTimeout(()=>$('#edge-ai-input').focus(),50)}}
  let scopesLoaded=false;
  function scopeVal(){const s=document.getElementById('edge-ai-scope-sel');return s?s.value:'me'}
  async function loadScopes(){
    if(scopesLoaded||typeof state==='undefined'||!state.user||state.user.role!=='admin')return; scopesLoaded=true;
    try{
      const d=await api('/admin/overview');
      const box=$('#edge-ai-scope');
      box.innerHTML=`<label for="edge-ai-scope-sel">Looking at</label><select id="edge-ai-scope-sel"><option value="me">My journal</option><option value="all">Everyone (read-only)</option>${d.users.filter(u=>u.id!==d.me).map(u=>`<option value="${escA(u.id)}">${escA(u.name||u.username)} (@${escA(u.username)})</option>`).join('')}</select>`;
      box.hidden=false;
      $('#edge-ai-scope-sel').onchange=e=>{history=[];const t=e.target.options[e.target.selectedIndex].text;add('assistant',e.target.value==='me'?'Back to your own journal.':`Now looking at: ${t}. This view is read-only, so I will not change anything.`)};
    }catch(e){scopesLoaded=false}
  }
  function add(role,text){const box=$('#edge-ai-messages');box.insertAdjacentHTML('beforeend',`<div class="edge-ai-msg ${role}">${escA(text)}</div>`);box.scrollTop=box.scrollHeight}
  async function send(q,voice){
    q=String(q||'').trim(); if(!q||sending)return null; sending=true; add('user',q); $('#edge-ai-input').value='';
    const pending=document.createElement('div'); pending.className='edge-ai-msg assistant'; pending.textContent='Thinking…'; $('#edge-ai-messages').appendChild(pending);
    let answer=null;
    try{
      const x=await api('/assistant','POST',{question:q,history,voice:!!voice,scope:scopeVal()}); pending.remove(); answer=x.answer; add('assistant',answer);
      history.push({role:'user',content:q},{role:'assistant',content:answer}); history=history.slice(-8);
      if(Array.isArray(x.actions))executeActions(x.actions);
      if(scopeVal()==='me'&&/\b(save|add|create)\b/i.test(q)&&/\b(knowledge|rule|lesson|discovery)\b/i.test(q)){try{const c=await api('/assistant/command','POST',{question:q,history});if(c.actions?.length)executeActions(c.actions)}catch(e){}}
    }catch(e){pending.remove();add('error',e.message)}
    finally{sending=false;if(!voiceOn)$('#edge-ai-input').focus()}
    return answer;
  }

  /* ---------- Hands-free voice ---------- */
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  let voiceOn=false, rec=null, speaking=false;
  function voiceStatus(t){const el=$('#edge-ai-status'); if(el&&voiceOn){el.textContent=t;el.classList.remove('off')}}
  function setVoice(on){
    voiceOn=!!on; const mic=$('#edge-ai-mic'); if(mic)mic.classList.toggle('live',voiceOn);
    if(voiceOn){ if(!SR){voiceOn=false;add('error','Voice needs Chrome, Edge or Safari.');return} startListening(); }
    else{ try{rec&&rec.abort()}catch(e){} rec=null; try{speechSynthesis.cancel()}catch(e){} speaking=false;
      const el=$('#edge-ai-status'); if(el)el.textContent='Voice off'; }
  }
  function startListening(){
    if(!voiceOn||sending||speaking||rec)return;
    voiceStatus('🎤 Listening… say "stop" to end');
    const r=new SR(); rec=r; r.lang='en-ZA'; r.interimResults=true; r.continuous=false; r.maxAlternatives=1;
    let finalText='';
    r.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const x=e.results[i];if(x.isFinal)finalText+=x[0].transcript;else interim+=x[0].transcript}$('#edge-ai-input').value=finalText||interim};
    r.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'){setVoice(false);add('error','Microphone is blocked. Click the lock icon in the address bar and allow the microphone.')}};
    r.onend=async()=>{
      if(rec===r)rec=null; if(!voiceOn)return;
      const q=finalText.trim();
      if(!q){setTimeout(startListening,250);return}
      if(/^(stop|stop listening|goodbye|bye|end voice|turn off voice)\.?$/i.test(q)){$('#edge-ai-input').value='';setVoice(false);return}
      voiceStatus('Thinking…');
      const ans=await send(q,true);
      if(!voiceOn)return;
      if(ans){voiceStatus('🔊 Speaking… tap 🎤 to stop');await speak(ans)}
      if(voiceOn)startListening();
    };
    try{r.start()}catch(e){rec=null;setTimeout(startListening,500)}
  }
  function pickVoice(){
    const v=speechSynthesis.getVoices();
    return v.find(x=>/en[-_]ZA/i.test(x.lang))||v.find(x=>/en[-_]GB/i.test(x.lang))||v.find(x=>/^en/i.test(x.lang))||null;
  }
  function speak(text){
    return new Promise(done=>{
      if(!window.speechSynthesis)return done();
      speechSynthesis.cancel();
      const clean=String(text).replace(/```[\s\S]*?```/g,' ').replace(/[*_`#>|]/g,'').replace(/\s+/g,' ').trim();
      const parts=clean.match(/[^.!?\n]+[.!?]*/g)||[clean];
      const voice=pickVoice(); speaking=true; let i=0;
      const next=()=>{
        if(!voiceOn||i>=parts.length){speaking=false;return done()}
        const u=new SpeechSynthesisUtterance(parts[i++].trim()); if(voice)u.voice=voice; u.lang=voice?voice.lang:'en-ZA'; u.rate=1.05;
        u.onend=next; u.onerror=()=>{speaking=false;done()}; speechSynthesis.speak(u);
      };
      next();
    });
  }

  function executeActions(actions){(actions||[]).forEach(a=>{if(!a)return;if(a.type==='open_trade')location.hash='#/trade/'+a.id;else if(a.type==='navigate')location.hash='#/'+a.page;else if(a.type==='filter_journal'){Object.assign(window.__edgeFilters||{},a.filters||{});if(window.__edgeApplyFilters)window.__edgeApplyFilters(a.filters||{});else location.hash='#/journal'}else if(a.type==='save_knowledge'){toast('Saved to knowledge base');location.hash='#/knowledge'}else if(a.type==='add_rule'){toast('Rule added: '+a.rule);location.hash='#/settings'}else if(a.type==='weekly_review')location.hash='#/review'});}

  window.addEventListener('load',mount); if(document.readyState!=='loading')mount();
})();
