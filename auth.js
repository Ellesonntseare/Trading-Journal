'use strict';
// Accounts + login for EDGE. No extra packages: Node's built-in crypto only.
// Passwords are stored as scrypt hashes. Sessions are random tokens in an HttpOnly cookie
// (only a SHA-256 of each token is kept on disk).
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const COOKIE = 'edge_sid';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;

function scrypt(password, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(String(password), salt, 64, (err, key) => (err ? reject(err) : resolve(key)))
  );
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return 'scrypt$' + salt.toString('hex') + '$' + key.toString('hex');
}
async function verifyPassword(password, stored) {
  const [kind, saltHex, keyHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !keyHex) return false;
  const want = Buffer.from(keyHex, 'hex');
  const got = await scrypt(password, Buffer.from(saltHex, 'hex'));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function createAuth({ dataDir, readJson, writeJson, getSignup, onUserCreated }) {
  const USERS_FILE = path.join(dataDir, 'users.json');
  const SESSIONS_FILE = path.join(dataDir, 'sessions.json');
  const users = readJson(USERS_FILE, []);
  let sessions = readJson(SESSIONS_FILE, {});

  const now = () => Date.now();
  const pruneSessions = () => {
    Object.keys(sessions).forEach((k) => {
      if (!sessions[k] || sessions[k].exp < now()) delete sessions[k];
    });
  };
  pruneSessions();
  const saveUsers = () => writeJson(USERS_FILE, users);
  const saveSessions = () => writeJson(SESSIONS_FILE, sessions);
  const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role });
  const revokeSessions = (uid) => {
    Object.keys(sessions).forEach((k) => sessions[k].uid === uid && delete sessions[k]);
    saveSessions();
  };

  // ---- failed-attempt limiter (per IP) ----
  const fails = new Map();
  function limited(key, max, windowMs) {
    const row = (fails.get(key) || []).filter((t) => now() - t < windowMs);
    fails.set(key, row);
    return row.length >= max;
  }
  const noteFail = (key) => fails.set(key, [...(fails.get(key) || []), now()]);

  function setCookie(req, res, token, maxAgeMs) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`
    );
  }
  function startSession(req, res, user) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions[sha(token)] = { uid: user.id, exp: now() + SESSION_MS };
    saveSessions();
    setCookie(req, res, token, SESSION_MS);
  }
  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const s = sessions[sha(token)];
    if (!s || s.exp < now()) return null;
    const u = users.find((x) => x.id === s.uid);
    return u && !u.disabled ? u : null;
  }

  function requireAuth(req, res, next) {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'Please log in', auth: true });
    req.user = u;
    next();
  }
  function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
    next();
  }

  const router = express.Router();
  const signupOpen = () => users.length === 0 || !!getSignup().allowSignup;

  router.get('/me', (req, res) => {
    const u = currentUser(req);
    res.json({
      user: u ? publicUser(u) : null,
      firstRun: users.length === 0,
      signupOpen: signupOpen(),
      inviteRequired: !!getSignup().inviteCode,
    });
  });

  router.post('/register', async (req, res) => {
    try {
      const inviteCode = getSignup().inviteCode;
      if (!signupOpen()) return res.status(403).json({ error: 'New accounts are turned off on this journal.' });
      if (limited('reg:' + req.ip, 10, 3600000)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      const b = req.body || {};
      if (inviteCode && String(b.invite || '').trim() !== inviteCode) {
        noteFail('reg:' + req.ip);
        return res.status(403).json({ error: 'Wrong invite code.' });
      }
      const username = String(b.username || '').trim().toLowerCase();
      const password = String(b.password || '');
      const name = String(b.name || '').trim().slice(0, 40) || username;
      if (!USERNAME_RE.test(username)) {
        return res.status(400).json({ error: 'Username: 3-30 characters, letters, numbers, - or _ (start with a letter or number).' });
      }
      if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      if (users.some((u) => u.username === username)) return res.status(409).json({ error: 'That username is taken.' });
      const isFirst = users.length === 0;
      const user = {
        id: crypto.randomBytes(8).toString('hex'),
        username,
        name,
        role: isFirst ? 'admin' : 'user',
        folder: username + '_' + crypto.randomBytes(3).toString('hex'),
        passHash: await hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      saveUsers();
      onUserCreated(user, isFirst);
      startSession(req, res, user);
      res.json({ user: publicUser(user) });
    } catch (e) {
      console.error('register error:', e.message);
      res.status(500).json({ error: 'Could not create the account.' });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const key = 'login:' + req.ip;
      if (limited(key, 10, 15 * 60000)) return res.status(429).json({ error: 'Too many failed logins. Wait 15 minutes and try again.' });
      const username = String((req.body || {}).username || '').trim().toLowerCase();
      const password = String((req.body || {}).password || '');
      const user = users.find((u) => u.username === username);
      // Always run a hash so unknown usernames take as long as wrong passwords
      const ok = await verifyPassword(password, user ? user.passHash : 'scrypt$00$00');
      if (!user || !ok) {
        noteFail(key);
        return res.status(401).json({ error: 'Wrong username or password.' });
      }
      if (user.disabled) return res.status(403).json({ error: 'This account has been disabled by the admin.' });
      user.lastLoginAt = new Date().toISOString();
      saveUsers();
      startSession(req, res, user);
      res.json({ user: publicUser(user) });
    } catch (e) {
      console.error('login error:', e.message);
      res.status(500).json({ error: 'Could not log in.' });
    }
  });

  router.post('/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token && sessions[sha(token)]) {
      delete sessions[sha(token)];
      saveSessions();
    }
    setCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  router.post('/password', requireAuth, async (req, res) => {
    try {
      const b = req.body || {};
      if (limited('pw:' + req.user.id, 10, 15 * 60000)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      if (!(await verifyPassword(String(b.current || ''), req.user.passHash))) {
        noteFail('pw:' + req.user.id);
        return res.status(400).json({ error: 'Current password is wrong.' });
      }
      const next = String(b.next || '');
      if (next.length < 8 || next.length > 200) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
      req.user.passHash = await hashPassword(next);
      saveUsers();
      // Log out every other device
      const mine = sha(parseCookies(req.headers.cookie)[COOKIE] || '');
      Object.keys(sessions).forEach((k) => {
        if (sessions[k].uid === req.user.id && k !== mine) delete sessions[k];
      });
      saveSessions();
      res.json({ ok: true });
    } catch (e) {
      console.error('password error:', e.message);
      res.status(500).json({ error: 'Could not change the password.' });
    }
  });

  function removeUser(id) {
    const i = users.findIndex((u) => u.id === id);
    if (i >= 0) users.splice(i, 1);
    saveUsers();
    revokeSessions(id);
  }

  return { router, requireAuth, requireAdmin, users, saveUsers, revokeSessions, removeUser };
}

module.exports = createAuth;
module.exports.hashPassword = hashPassword;
