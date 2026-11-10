'use strict';
// Admin-only API: /api/admin/*
const fs = require('fs');
const path = require('path');
const express = require('express');
const Groq = require('groq-sdk');
const { hashPassword } = require('./auth');

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

module.exports = function mountAdmin(app, ctx) {
  const {
    auth, adminCfg, saveAdminCfg, applyAiConfig, effectiveAiKey, signupSettings, aiUsage, saveAiUsage,
    getGroq, getModel, getStore, stores, imageStatics, USERS_DIR, IMAGE_DIR, DATA_DIR, readJson, keyFromEnv,
  } = ctx;

  const router = express.Router();
  router.use(auth.requireAdmin);

  const countTrades = (u) => {
    const st = stores.get(u.id);
    if (st) return st.trades.length;
    const t = readJson(path.join(USERS_DIR, u.folder, 'trades.json'), []);
    return Array.isArray(t) ? t.length : 0;
  };
  const activeAdmins = () => auth.users.filter((u) => u.role === 'admin' && !u.disabled);

  function aiInfo() {
    const key = effectiveAiKey();
    const a = adminCfg.ai;
    return {
      enabled: !!a.enabled,
      model: getModel(),
      modelSetting: a.model || '',
      rateLimit: a.rateLimit,
      maxTrades: a.maxTrades,
      extraInstructions: a.extraInstructions || '',
      keyConfigured: !!key,
      keySource: a.apiKey ? 'admin' : key ? 'env' : 'none',
      keyHint: key ? '…' + key.slice(-4) : '',
    };
  }

  router.get('/overview', (req, res) => {
    res.json({
      me: req.user.id,
      users: auth.users.map((u) => {
        const use = aiUsage[u.id] || {};
        return {
          id: u.id,
          username: u.username,
          name: u.name,
          role: u.role,
          disabled: !!u.disabled,
          aiEnabled: u.aiEnabled !== false,
          createdAt: u.createdAt || null,
          lastLoginAt: u.lastLoginAt || null,
          trades: countTrades(u),
          aiRequests: use.count || 0,
          aiLastAt: use.lastAt || null,
        };
      }),
      ai: aiInfo(),
      signup: signupSettings(),
    });
  });

  // ---- AI control ----
  router.put('/ai', (req, res) => {
    const b = req.body || {};
    const a = adminCfg.ai;
    if (typeof b.enabled === 'boolean') a.enabled = b.enabled;
    if (typeof b.model === 'string') a.model = b.model.trim().slice(0, 100);
    if (b.rateLimit != null) a.rateLimit = clamp(Math.round(Number(b.rateLimit)) || 20, 1, 200);
    if (b.maxTrades != null) a.maxTrades = clamp(Math.round(Number(b.maxTrades)) || 500, 50, 1000);
    if (typeof b.extraInstructions === 'string') a.extraInstructions = b.extraInstructions.slice(0, 2000);
    if (typeof b.apiKey === 'string' && b.apiKey.trim()) a.apiKey = b.apiKey.trim().slice(0, 300);
    if (b.clearKey === true) a.apiKey = '';
    saveAdminCfg();
    applyAiConfig();
    res.json(aiInfo());
  });

  router.get('/ai/models', async (req, res) => {
    let ids = [];
    const g = getGroq();
    if (g) {
      try {
        const list = await g.models.list();
        ids = (list.data || []).map((m) => m.id).filter((id) => !/whisper|tts|guard|playai|orpheus/i.test(id)).sort();
      } catch (e) {
        /* offline or bad key: just show the current model */
      }
    }
    const cur = getModel();
    if (!ids.includes(cur)) ids.unshift(cur);
    res.json({ models: ids });
  });

  router.post('/ai/test', async (req, res) => {
    const b = req.body || {};
    const typedKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
    const g = typedKey ? new Groq({ apiKey: typedKey }) : getGroq();
    if (!g) return res.status(400).json({ error: 'No Groq API key is set.' });
    const model = typeof b.model === 'string' && b.model.trim() ? b.model.trim() : getModel();
    const t0 = Date.now();
    try {
      await g.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'Reply with the word OK.' }],
        max_completion_tokens: 64,
      });
      res.json({ ok: true, model, ms: Date.now() - t0 });
    } catch (e) {
      res.status(400).json({ error: (e && e.error && e.error.error && e.error.error.message) || e.message || 'Test failed' });
    }
  });

  // ---- Sign-ups ----
  router.put('/signup', (req, res) => {
    const b = req.body || {};
    if (typeof b.allowSignup === 'boolean') adminCfg.signup.allowSignup = b.allowSignup;
    if (typeof b.inviteCode === 'string') adminCfg.signup.inviteCode = b.inviteCode.trim().slice(0, 60);
    saveAdminCfg();
    res.json(signupSettings());
  });

  // ---- Accounts ----
  const findUser = (req, res) => {
    const u = auth.users.find((x) => x.id === req.params.id);
    if (!u) res.status(404).json({ error: 'Account not found.' });
    return u;
  };

  router.patch('/users/:id', (req, res) => {
    const u = findUser(req, res);
    if (!u) return;
    const b = req.body || {};
    const self = u.id === req.user.id;
    if (b.role !== undefined) {
      if (!['admin', 'user'].includes(b.role)) return res.status(400).json({ error: 'Bad role.' });
      if (b.role === 'user' && u.role === 'admin') {
        if (self) return res.status(400).json({ error: "You can't remove your own admin role. Ask another admin." });
        if (activeAdmins().length <= 1) return res.status(400).json({ error: 'There must be at least one admin.' });
      }
      u.role = b.role;
    }
    if (b.disabled !== undefined) {
      const d = !!b.disabled;
      if (d && self) return res.status(400).json({ error: "You can't disable your own account." });
      if (d && u.role === 'admin' && activeAdmins().length <= 1) return res.status(400).json({ error: 'There must be at least one active admin.' });
      u.disabled = d;
      if (d) auth.revokeSessions(u.id);
    }
    if (typeof b.aiEnabled === 'boolean') u.aiEnabled = b.aiEnabled;
    auth.saveUsers();
    res.json({ ok: true });
  });

  router.post('/users/:id/password', async (req, res) => {
    const u = findUser(req, res);
    if (!u) return;
    if (u.id === req.user.id) return res.status(400).json({ error: 'Use "Change password" in your account menu for your own password.' });
    const pw = String((req.body || {}).password || '');
    if (pw.length < 8 || pw.length > 200) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    u.passHash = await hashPassword(pw);
    auth.saveUsers();
    auth.revokeSessions(u.id);
    res.json({ ok: true });
  });

  router.delete('/users/:id', (req, res) => {
    const u = findUser(req, res);
    if (!u) return;
    if (u.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account." });
    if (u.role === 'admin' && activeAdmins().filter((x) => x.id !== u.id).length < 1) {
      return res.status(400).json({ error: 'There must be at least one admin.' });
    }
    auth.removeUser(u.id);
    stores.delete(u.id);
    imageStatics.delete(u.id);
    delete aiUsage[u.id];
    saveAiUsage();
    // Nothing is destroyed: the account's files are moved to data/deleted-users/<folder>/
    const archive = path.join(DATA_DIR, 'deleted-users', u.folder);
    let archived = null;
    try {
      fs.mkdirSync(archive, { recursive: true });
      const dataDir = path.join(USERS_DIR, u.folder);
      const imgDir = path.join(IMAGE_DIR, u.folder);
      if (fs.existsSync(dataDir)) fs.renameSync(dataDir, path.join(archive, 'data'));
      if (fs.existsSync(imgDir)) fs.renameSync(imgDir, path.join(archive, 'images'));
      archived = archive;
    } catch (e) {
      console.error('Could not archive the deleted account files:', e.message);
    }
    res.json({ ok: true, archivedTo: archived });
  });

  app.use('/api/admin', router);
};
