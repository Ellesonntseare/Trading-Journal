'use strict';
/* Login, sign-up, account menu. Loaded after app.js, before phase2.js (which calls boot()). */

async function authCall(path, body) {
  const res = await fetch('/api/auth' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// A saved session ran out (or was ended on another device): go back to the login page.
window.addEventListener('edge-auth-lost', () => {
  if (!document.body.classList.contains('logged-out')) location.reload();
});

function showAuth(me) {
  document.body.classList.add('logged-out');
  const old = document.getElementById('auth-root');
  if (old) old.remove();
  const root = document.createElement('div');
  root.id = 'auth-root';
  document.body.appendChild(root);
  let mode = me.firstRun ? 'register' : 'login';

  function draw() {
    const reg = mode === 'register';
    root.innerHTML = `
      <div class="auth-wrap">
        <section class="auth-card" aria-labelledby="auth-title">
          <div class="auth-brand">
            <span class="brand-mark"><span></span><span></span><span></span></span>
            <span><b>EDGE</b><small>TRADING JOURNAL</small></span>
          </div>
          <h1 id="auth-title">${reg ? (me.firstRun ? 'Create the first account' : 'Create your account') : 'Log in'}</h1>
          <p class="sub">${
            reg
              ? me.firstRun
                ? 'This account becomes the admin and keeps any trades already in this journal.'
                : 'Your trades, screenshots and settings are private from other users. The journal admin can see them.'
              : 'Log in to your journal.'
          }</p>
          ${
            me.signupOpen && !me.firstRun
              ? `<div class="auth-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected="${!reg}" data-mode="login">Log in</button>
                  <button type="button" role="tab" aria-selected="${reg}" data-mode="register">Create account</button>
                </div>`
              : ''
          }
          <form id="auth-form" novalidate>
            <label class="f">Username
              <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required ${reg ? 'minlength="3" maxlength="30"' : ''}>
            </label>
            ${reg ? `<label class="f"><span>Display name <span class="opt">optional</span></span><input name="name" autocomplete="nickname" maxlength="40"></label>` : ''}
            <label class="f">Password
              <span class="pw-row">
                <input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required ${reg ? 'minlength="8"' : ''}>
                <button type="button" class="pw-toggle" aria-label="Show password">Show</button>
              </span>
              ${reg ? '<span class="hint">At least 8 characters.</span>' : ''}
            </label>
            ${reg && me.inviteRequired ? `<label class="f">Invite code<input name="invite" autocomplete="off" required></label>` : ''}
            <p class="auth-error" id="auth-error" role="alert"></p>
            <button class="btn gold auth-submit" type="submit">${reg ? 'Create account' : 'Log in'}</button>
          </form>
        </section>
      </div>`;
    root.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        mode = b.dataset.mode;
        draw();
      })
    );
    const form = root.querySelector('#auth-form');
    const pw = form.elements.password;
    root.querySelector('.pw-toggle').addEventListener('click', (e) => {
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      e.target.textContent = show ? 'Hide' : 'Show';
      e.target.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = root.querySelector('#auth-error');
      const btn = form.querySelector('.auth-submit');
      err.textContent = '';
      const f = form.elements;
      const body = { username: f.username.value, password: f.password.value };
      if (reg) {
        body.name = f.name.value;
        if (f.invite) body.invite = f.invite.value;
      }
      if (!body.username.trim() || !body.password) {
        err.textContent = 'Enter your username and password.';
        return;
      }
      btn.disabled = true;
      try {
        await authCall(reg ? '/register' : '/login', body);
        location.reload();
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
        pw.focus();
        pw.select();
      }
    });
    form.elements.username.focus();
  }
  draw();
}

/* ---------- Account menu in the top bar ---------- */
function renderUserMenu(user) {
  const box = document.getElementById('userMenu');
  if (!box) return;
  const initial = (user.name || user.username || '?').trim().charAt(0).toUpperCase();
  box.innerHTML = `
    <button class="user-btn" type="button" aria-haspopup="true" aria-expanded="false">
      <span class="avatar">${esc(initial)}</span><span class="user-name">${esc(user.name || user.username)}</span>
    </button>
    <div class="user-pop" hidden>
      <div class="user-who"><b>${esc(user.name || user.username)}</b><span>@${esc(user.username)}${user.role === 'admin' ? ' · admin' : ''}</span></div>
      ${user.role === 'admin' ? '<button type="button" data-act="admin">Admin panel</button>' : ''}
      <button type="button" data-act="pw">Change password</button>
      <button type="button" data-act="out">Log out</button>
    </div>`;
  const btn = box.querySelector('.user-btn');
  const pop = box.querySelector('.user-pop');
  const close = () => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.setAttribute('aria-expanded', String(!pop.hidden));
  });
  document.addEventListener('click', (e) => {
    if (!box.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  pop.querySelector('[data-act="out"]').addEventListener('click', async () => {
    try {
      await authCall('/logout');
    } finally {
      location.reload();
    }
  });
  const adminBtn = pop.querySelector('[data-act="admin"]');
  if (adminBtn) adminBtn.addEventListener('click', () => {
    close();
    location.hash = '#/admin';
  });
  pop.querySelector('[data-act="pw"]').addEventListener('click', () => {
    close();
    openPasswordDialog();
  });
}

function openPasswordDialog() {
  let dlg = document.getElementById('pwdlg');
  if (dlg) dlg.remove();
  dlg = document.createElement('dialog');
  dlg.id = 'pwdlg';
  dlg.className = 'auth-dlg';
  dlg.innerHTML = `
    <form id="pwform" novalidate>
      <h2>Change password</h2>
      <label class="f">Current password<input name="current" type="password" autocomplete="current-password" required></label>
      <label class="f">New password<input name="next" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters. Your other devices will be logged out.</span></label>
      <p class="auth-error" role="alert"></p>
      <div class="auth-dlg-actions">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn gold" type="submit">Save password</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('.auth-error');
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await authCall('/password', { current: form.elements.current.value, next: form.elements.next.value });
      dlg.close();
      toast('Password changed');
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
  dlg.showModal();
  form.elements.current.focus();
}
