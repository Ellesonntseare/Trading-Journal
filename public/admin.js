'use strict';
/* Admin page (#/admin): EDGE AI controls, sign-up settings, accounts. Admin accounts only. */

function admAsk({ title, label, type = 'text', hint = '', confirm = 'Save' }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'auth-dlg';
    dlg.innerHTML = `
      <form id="admAskForm" novalidate>
        <h2>${esc(title)}</h2>
        <label class="f">${esc(label)}<input name="v" type="${type}" autocomplete="off" required>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>
        <div class="auth-dlg-actions">
          <button class="btn" type="button" data-close>Cancel</button>
          <button class="btn gold" type="submit">${esc(confirm)}</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    let result = null;
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      result = dlg.querySelector('input').value;
      dlg.close();
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.showModal();
    dlg.querySelector('input').focus();
  });
}

async function viewAdmin() {
  if (!state.user || state.user.role !== 'admin') {
    view.innerHTML = `<div class="empty-state"><h2>Admins only</h2><p>This page is only for the journal admin.</p></div>`;
    return;
  }
  view.innerHTML = `
    <div class="page-head"><div><h1>Admin</h1><p class="sub">Accounts and EDGE AI for everyone using this journal.</p></div></div>
    <div id="adm-body"><p class="hint">Loading…</p></div>`;
  let data;
  let models = [];
  try {
    [data, { models }] = await Promise.all([api('/admin/overview'), api('/admin/ai/models').catch(() => ({ models: [] }))]);
  } catch (e) {
    $('#adm-body').innerHTML = `<div class="empty-state"><h2>Could not load</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  const body = $('#adm-body');
  const ai = data.ai;
  const keyNote =
    ai.keySource === 'admin'
      ? `Using the key saved here (${esc(ai.keyHint)}). It is stored on this PC in data/admin.json.`
      : ai.keySource === 'env'
        ? `Using GROQ_API_KEY from this PC (${esc(ai.keyHint)}). Type a key here to override it.`
        : `No key yet. EDGE AI cannot answer until you add one.`;

  body.innerHTML = `
    <section class="card adm-card" id="adm-ai">
      <div class="adm-head">
        <div><h2>EDGE AI</h2><p class="hint">Changes apply straight away. No restart needed.</p></div>
        <label class="tgl"><input id="ai-enabled" type="checkbox" ${ai.enabled ? 'checked' : ''}><span></span><b id="ai-state">${ai.enabled ? 'On for everyone' : 'Off for everyone'}</b></label>
      </div>
      <div class="grid g2">
        <label class="f">Model
          <input id="ai-model" list="ai-models" value="${esc(ai.modelSetting)}" placeholder="Default (${esc(ai.model)})" autocomplete="off" spellcheck="false">
          <datalist id="ai-models">${models.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
          <span class="hint">Leave empty for the default. Pick from the list or type any Groq model name.</span>
        </label>
        <label class="f">Groq API key
          <input id="ai-key" type="password" autocomplete="new-password" placeholder="${ai.keyConfigured ? 'Key set. Type a new one to replace it' : 'gsk_...'}">
          <span class="hint">${keyNote}</span>
        </label>
        <label class="f">Questions per minute, per person
          <input id="ai-rate" type="number" min="1" max="200" value="${ai.rateLimit}">
        </label>
        <label class="f">Trades sent to the AI as context
          <input id="ai-max" type="number" min="50" max="1000" value="${ai.maxTrades}">
          <span class="hint">More trades means fuller answers but slower replies and more of your Groq limit used.</span>
        </label>
      </div>
      <label class="f" style="margin-top:14px">Extra instructions for the AI
        <textarea id="ai-extra" maxlength="2000" placeholder="Example: Keep answers short. Always mention risk per trade.">${esc(ai.extraInstructions)}</textarea>
        <span class="hint">Added to what EDGE AI is told for every user. Regular users' AI only sees their own journal. Yours can also look at any account: use the "Looking at" picker in the AI panel.</span>
      </label>
      <div class="adm-actions" style="margin-top:14px">
        <button class="btn gold" id="ai-save" type="button">Save AI settings</button>
        <button class="btn" id="ai-test" type="button">Test connection</button>
        ${ai.keySource === 'admin' ? '<button class="btn danger" id="ai-clearkey" type="button">Remove saved key</button>' : ''}
        <span class="hint adm-msg" id="ai-msg" role="status"></span>
      </div>
    </section>

    <section class="card adm-card" id="adm-signup">
      <div class="adm-head">
        <div><h2>New accounts</h2><p class="hint">Who can create an account on this journal.</p></div>
        <label class="tgl"><input id="su-allow" type="checkbox" ${data.signup.allowSignup ? 'checked' : ''}><span></span><b id="su-state">${data.signup.allowSignup ? 'Sign-ups open' : 'Sign-ups closed'}</b></label>
      </div>
      <div class="adm-actions">
        <label class="f" style="min-width:min(320px,100%)"><span>Invite code <span class="hint">(optional)</span></span>
          <input id="su-code" value="${esc(data.signup.inviteCode)}" autocomplete="off" placeholder="Anyone can sign up without a code">
        </label>
        <button class="btn gold" id="su-save" type="button" style="align-self:flex-end">Save</button>
        <span class="hint adm-msg" id="su-msg" role="status"></span>
      </div>
    </section>

    <section class="card adm-card">
      <div class="adm-head"><div><h2>Accounts</h2><p class="hint" id="adm-count"></p></div></div>
      <div class="tbl-scroll" id="adm-users"></div>
    </section>`;

  paintUsers(data);
  wireAdmin(data);
}

function paintUsers(data) {
  const rows = data.users
    .map((u) => {
      const me = u.id === data.me;
      return `<tr data-id="${esc(u.id)}">
        <td><b>${esc(u.name || u.username)}</b>${me ? ' <span class="hint">(you)</span>' : ''}<br><span class="hint">@${esc(u.username)}</span></td>
        <td>${u.role === 'admin' ? '<span class="badge">Admin</span>' : 'User'}${u.disabled ? ' <span class="chip warn">Disabled</span>' : ''}</td>
        <td>${u.trades}</td>
        <td>${u.aiRequests}${u.aiLastAt ? `<br><span class="hint">${esc(fmtDateTime(u.aiLastAt))}</span>` : ''}</td>
        <td>${u.lastLoginAt ? esc(fmtDateTime(u.lastLoginAt)) : '<span class="hint">Never</span>'}</td>
        <td><label class="tgl sm" title="EDGE AI access for this person"><input type="checkbox" data-act="ai" aria-label="EDGE AI access for ${esc(u.username)}" ${u.aiEnabled ? 'checked' : ''}><span></span></label></td>
        <td><div class="adm-actions">
          ${me ? '<span class="hint">-</span>' : `
          <button class="btn small" data-act="role" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Make user' : 'Make admin'}</button>
          <button class="btn small" data-act="pw">Reset password</button>
          <button class="btn small" data-act="${u.disabled ? 'enable' : 'disable'}">${u.disabled ? 'Enable' : 'Disable'}</button>
          <button class="btn small danger" data-act="del">Delete</button>`}
        </div></td>
      </tr>`;
    })
    .join('');
  $('#adm-count').textContent = `${data.users.length} account${data.users.length === 1 ? '' : 's'}`;
  $('#adm-users').innerHTML = `<table class="tbl adm-tbl">
    <thead><tr><th>Account</th><th>Role</th><th>Trades</th><th>AI questions</th><th>Last login</th><th>AI access</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function wireAdmin(initial) {
  const msg = (id, text, bad) => {
    const el = $(id);
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
  };

  async function refreshUsers() {
    const d = await api('/admin/overview');
    paintUsers(d);
  }

  /* --- AI --- */
  $('#ai-enabled').addEventListener('change', async (e) => {
    try {
      await api('/admin/ai', 'PUT', { enabled: e.target.checked });
      $('#ai-state').textContent = e.target.checked ? 'On for everyone' : 'Off for everyone';
      toast(e.target.checked ? 'EDGE AI turned on' : 'EDGE AI turned off');
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, true);
    }
  });
  $('#ai-save').addEventListener('click', async () => {
    msg('#ai-msg', 'Saving…');
    try {
      await api('/admin/ai', 'PUT', {
        model: $('#ai-model').value,
        rateLimit: $('#ai-rate').value,
        maxTrades: $('#ai-max').value,
        extraInstructions: $('#ai-extra').value,
        apiKey: $('#ai-key').value,
      });
      toast('AI settings saved');
      viewAdmin();
    } catch (err) {
      msg('#ai-msg', err.message, true);
    }
  });
  $('#ai-test').addEventListener('click', async () => {
    msg('#ai-msg', 'Testing…');
    try {
      const r = await api('/admin/ai/test', 'POST', { model: $('#ai-model').value, apiKey: $('#ai-key').value });
      msg('#ai-msg', `Works. ${r.model} answered in ${r.ms} ms.`);
    } catch (err) {
      msg('#ai-msg', err.message, true);
    }
  });
  const clear = $('#ai-clearkey');
  if (clear) {
    clear.addEventListener('click', async () => {
      if (!confirm('Remove the API key saved here? EDGE AI will fall back to GROQ_API_KEY if the PC has one, otherwise it stops working.')) return;
      try {
        await api('/admin/ai', 'PUT', { clearKey: true });
        toast('Saved key removed');
        viewAdmin();
      } catch (err) {
        msg('#ai-msg', err.message, true);
      }
    });
  }

  /* --- Sign-ups --- */
  $('#su-allow').addEventListener('change', (e) => {
    $('#su-state').textContent = e.target.checked ? 'Sign-ups open' : 'Sign-ups closed';
  });
  $('#su-save').addEventListener('click', async () => {
    try {
      await api('/admin/signup', 'PUT', { allowSignup: $('#su-allow').checked, inviteCode: $('#su-code').value });
      msg('#su-msg', 'Saved');
      toast('Sign-up settings saved');
    } catch (err) {
      msg('#su-msg', err.message, true);
    }
  });

  /* --- Accounts --- */
  const users = $('#adm-users');
  users.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-act="ai"]');
    if (!box) return;
    const id = box.closest('tr').dataset.id;
    try {
      await api('/admin/users/' + id, 'PATCH', { aiEnabled: box.checked });
      toast(box.checked ? 'EDGE AI allowed for this account' : 'EDGE AI blocked for this account');
    } catch (err) {
      box.checked = !box.checked;
      toast(err.message, true);
    }
  });
  users.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr.dataset.id;
    const name = tr.querySelector('b').textContent;
    try {
      switch (btn.dataset.act) {
        case 'role':
          await api('/admin/users/' + id, 'PATCH', { role: btn.dataset.role });
          toast(`${name} is now ${btn.dataset.role === 'admin' ? 'an admin' : 'a regular user'}`);
          break;
        case 'disable':
          if (!confirm(`Disable ${name}? They are logged out now and cannot log in until you enable them again. Their data is kept.`)) return;
          await api('/admin/users/' + id, 'PATCH', { disabled: true });
          toast(`${name} disabled`);
          break;
        case 'enable':
          await api('/admin/users/' + id, 'PATCH', { disabled: false });
          toast(`${name} enabled`);
          break;
        case 'pw': {
          const pw = await admAsk({ title: `Reset password for ${name}`, label: 'New password', type: 'text', hint: 'At least 8 characters. Tell them the new password. They are logged out on all devices.', confirm: 'Reset password' });
          if (pw === null) return;
          await api('/admin/users/' + id + '/password', 'POST', { password: pw });
          toast('Password reset');
          break;
        }
        case 'del': {
          if (!confirm(`Delete the account ${name}? They can no longer log in. Their trades and screenshots are not destroyed: they are moved to data/deleted-users on this PC.`)) return;
          const r = await api('/admin/users/' + id, 'DELETE');
          toast(r.archivedTo ? 'Account deleted. Files kept in data/deleted-users' : 'Account deleted');
          break;
        }
      }
      await refreshUsers();
    } catch (err) {
      toast(err.message, true);
    }
  });
}
