'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const Groq = require('groq-sdk');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

// ---------- Settings (config.json, or environment variables) ----------
const ROOT = __dirname;
let fileCfg = {};
try {
fileCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  console.log('Note: config.json not found or not valid. Using default settings.');
}
const PORT = Number(process.env.PORT || fileCfg.port || 3000);
const IMAGE_DIR = path.resolve(process.env.JOURNAL_IMAGE_DIR || fileCfg.imageDir || path.join(ROOT, 'images'));
const DATA_DIR = path.resolve(process.env.JOURNAL_DATA_DIR || path.join(ROOT, 'data'));

fs.mkdirSync(DATA_DIR, { recursive: true });
try {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
} catch (e) {
  console.error('Could not create the images folder: ' + IMAGE_DIR);
  console.error(e.message);
  process.exit(1);
}

// ---------- Small JSON "database" ----------
// Files from before accounts existed. The first account created takes them over.
const LEGACY_TRADES = path.join(DATA_DIR, 'trades.json');
const LEGACY_SETTINGS = path.join(DATA_DIR, 'settings.json');
const LEGACY_KNOWLEDGE = path.join(DATA_DIR, 'knowledge.json');
const USERS_DIR = path.join(DATA_DIR, 'users');
fs.mkdirSync(USERS_DIR, { recursive: true });
const ALLOW_SIGNUP = String(process.env.ALLOW_SIGNUP ?? fileCfg.allowSignup ?? 'true') !== 'false';
const INVITE_CODE = String(process.env.INVITE_CODE || fileCfg.inviteCode || '').trim();

// ---------- Admin settings (data/admin.json, edited from the Admin page) ----------
// Anything set on the Admin page wins over config.json / environment variables.
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const AI_USAGE_FILE = path.join(DATA_DIR, 'ai-usage.json');
const BUFFER_SHARES_FILE = path.join(DATA_DIR, 'buffer-shares.json');
const bufferShares = readJson(BUFFER_SHARES_FILE, {});
function saveBufferShares() { writeJson(BUFFER_SHARES_FILE, bufferShares); }
const adminSaved = readJson(ADMIN_FILE, {});
const adminCfg = {
  ai: Object.assign({ enabled: true, model: '', rateLimit: 20, maxTrades: 500, extraInstructions: '', apiKey: '' }, adminSaved.ai || {}),
  signup: Object.assign({ allowSignup: null, inviteCode: null }, adminSaved.signup || {}),
};
const saveAdminCfg = () => writeJson(ADMIN_FILE, adminCfg);
const aiUsage = readJson(AI_USAGE_FILE, {});
const saveAiUsage = () => writeJson(AI_USAGE_FILE, aiUsage);
function recordAiUse(uid) {
  const u = (aiUsage[uid] = aiUsage[uid] || { count: 0, lastAt: null });
  u.count += 1;
  u.lastAt = new Date().toISOString();
  saveAiUsage();
}
const signupSettings = () => ({
  allowSignup: adminCfg.signup.allowSignup == null ? ALLOW_SIGNUP : !!adminCfg.signup.allowSignup,
  inviteCode: adminCfg.signup.inviteCode == null ? INVITE_CODE : String(adminCfg.signup.inviteCode).trim(),
});

// EDGE AI uses Groq on the server. The key never goes to the browser.
let groq = null;
let GROQ_MODEL = '';
let ASSISTANT_MAX_TRADES = 500;
const effectiveAiKey = () => adminCfg.ai.apiKey || process.env.GROQ_API_KEY || '';
function applyAiConfig() {
  const a = adminCfg.ai;
  const key = effectiveAiKey();
  GROQ_MODEL = a.model || process.env.GROQ_MODEL || fileCfg.groqModel || 'openai/gpt-oss-20b';
  groq = key ? new Groq({ apiKey: key }) : null;
  ASSISTANT_MAX_TRADES = Math.min(1000, Math.max(50, Number(a.maxTrades || process.env.ASSISTANT_MAX_TRADES || 500)));
}
applyAiConfig();
function aiBlocked(req) {
  if (!adminCfg.ai.enabled) return 'EDGE AI is turned off by the admin.';
  if (req.user.aiEnabled === false) return 'EDGE AI is turned off for your account by the admin.';
  return null;
}

const DEFAULT_SETTINGS = {
  startingBalance: 1000,
  pairs: [
    { symbol: 'XAUUSD', unit: 0.1 },
    { symbol: 'GBPUSD', unit: 0.0001 },
    { symbol: 'AUDUSD', unit: 0.0001 },
    { symbol: 'NAS100', unit: 1 },
    { symbol: 'SP500', unit: 1 },
    { symbol: 'USDCAD', unit: 0.0001 },
  ],
  sessions: { asia: 0, london: 9, newyork: 15 },
  rules: [
    'Waited for my setup and confirmation',
    'Traded in my best session',
    'Set my stop loss before entering',
    'Risked 1% or less',
    'Did not move my stop loss',
  ],
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^/, ''));
  } catch (e) {
    return fallback;
  }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ---------- Per-user stores ----------
// Every account has its own folder: data/users/<name>_<id>/ (trades, settings, knowledge)
// and its own screenshots folder: <imageDir>/<name>_<id>/
const SAFE_FOLDER = /^[a-z0-9][a-z0-9_-]*$/;
const stores = new Map();
const imageStatics = new Map();
function getStore(user) {
  let st = stores.get(user.id);
  if (st) return st;
  if (!SAFE_FOLDER.test(String(user.folder))) throw new Error('Bad user folder');
  const dir = path.join(USERS_DIR, user.folder);
  const imgDir = path.join(IMAGE_DIR, user.folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(imgDir, { recursive: true });
  const videoDir = path.join(dir, 'buffer-videos');
  fs.mkdirSync(videoDir, { recursive: true });
  st = {
    uid: user.id,
    dir,
    imgDir,
    videoDir,
    videosFile: path.join(dir, 'buffer-videos.json'),
    tradesFile: path.join(dir, 'trades.json'),
    settingsFile: path.join(dir, 'settings.json'),
    knowledgeFile: path.join(dir, 'knowledge.json'),
    analysesFile: path.join(dir, 'analyses.json'),
    bufferFile: path.join(dir, 'buffer.json'),
  };
  st.videos = readJson(st.videosFile, []);
  if (!Array.isArray(st.videos)) st.videos = [];
  st.saveVideos = () => writeJson(st.videosFile, st.videos);
  st.analyses = readJson(st.analysesFile, []);
  st.buffer = Object.assign({ apiKey: '', organizationId: '', publicBaseUrl: '' }, readJson(st.bufferFile, {}));
  st.saveBuffer = () => writeJson(st.bufferFile, st.buffer);
  if (!Array.isArray(st.analyses)) st.analyses = [];
  st.saveAnalyses = () => writeJson(st.analysesFile, st.analyses);
  st.trades = readJson(st.tradesFile, []);
  // Older trades saved before captions and rules existed get empty values
  st.trades.forEach((t) => {
    t.captions = t.captions || {};
    t.imageTags = t.imageTags || {};
    t.rulesAll = t.rulesAll || [];
    t.rulesChecked = t.rulesChecked || [];
  });
  st.settings = Object.assign({}, DEFAULT_SETTINGS, readJson(st.settingsFile, {}));
  if (!fs.existsSync(st.settingsFile)) writeJson(st.settingsFile, st.settings);
  st.saveTrades = () => writeJson(st.tradesFile, st.trades);
  stores.set(user.id, st);
  return st;
}

// The very first account inherits the journal that existed before logins were added.
function adoptLegacyData(user) {
  const st = getStore(user);
  const backup = path.join(DATA_DIR, 'legacy-backup');
  let moved = 0;
  try {
    const old = readJson(LEGACY_TRADES, null);
    if (Array.isArray(old) && old.length) {
      old.forEach((t) => {
        const imgs = (t && t.images) || {};
        [...(imgs.before || []), ...(imgs.after || [])].forEach((f) => {
          const name = safeFile(f);
          const from = name && path.join(IMAGE_DIR, name);
          if (from && fs.existsSync(from) && !fs.existsSync(path.join(st.imgDir, name))) {
            fs.renameSync(from, path.join(st.imgDir, name));
          }
        });
      });
      st.trades.push(...old);
      st.trades.forEach((t) => {
        t.captions = t.captions || {};
        t.imageTags = t.imageTags || {};
        t.rulesAll = t.rulesAll || [];
        t.rulesChecked = t.rulesChecked || [];
      });
      st.saveTrades();
      moved = old.length;
    }
    if (fs.existsSync(LEGACY_SETTINGS)) {
      st.settings = Object.assign({}, DEFAULT_SETTINGS, readJson(LEGACY_SETTINGS, {}));
      writeJson(st.settingsFile, st.settings);
    }
    if (fs.existsSync(LEGACY_KNOWLEDGE)) writeJson(st.knowledgeFile, readJson(LEGACY_KNOWLEDGE, []));
    fs.mkdirSync(backup, { recursive: true });
    [LEGACY_TRADES, LEGACY_SETTINGS, LEGACY_KNOWLEDGE].forEach((f) => {
      if (fs.existsSync(f)) fs.renameSync(f, path.join(backup, path.basename(f)));
    });
    if (moved) console.log(`  Moved ${moved} existing trades into the account "${user.username}".`);
  } catch (e) {
    console.error('Could not move the old journal into the first account:', e.message);
  }
}

// ---------- Helpers ----------
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const str = (v, max = 200) => String(v == null ? '' : v).slice(0, max);
const safeFile = (x) => {
  const name = path.basename(String(x));
  return /^[\w.\-]+$/.test(name) ? name : null;
};
const fileList = (a) => (Array.isArray(a) ? a.map(safeFile).filter(Boolean) : []);
const strList = (a, maxItems, maxLen) =>
  Array.isArray(a) ? [...new Set(a.map((x) => str(x, maxLen).trim()).filter(Boolean))].slice(0, maxItems) : [];

function cleanTrade(b) {
  b = b || {};
  const notes = b.notes || {};
  const images = b.images || {};
  const before = fileList(images.before);
  const after = fileList(images.after);
  // Labels for screenshots: { "file name": "1H chart" }, only for files this trade uses
  const captions = {};
  const imageTags = {};
  if (b.captions && typeof b.captions === 'object') {
    [...before, ...after].forEach((f) => {
      const c = str(b.captions[f], 80).trim();
      if (c) captions[f] = c;
      const tags = strList((b.imageTags || {})[f], 12, 32);
      if (tags.length) imageTags[f] = tags;
    });
  }
  const rulesAll = strList(b.rulesAll, 30, 80);
  return {
    captions,
    imageTags,
    rulesAll,
    rulesChecked: strList(b.rulesChecked, 30, 80).filter((r) => rulesAll.includes(r)),
    openedAt: str(b.openedAt, 16),
    closedAt: str(b.closedAt, 16),
    symbol: str(b.symbol, 20).toUpperCase(),
    side: b.side === 'Sell' ? 'Sell' : 'Buy',
    entry: num(b.entry),
    sl: num(b.sl),
    tp: num(b.tp),
    exit: num(b.exit),
    lots: num(b.lots),
    riskUsd: num(b.riskUsd),
    pnl: num(b.pnl),
    pips: num(b.pips),
    r: num(b.r),
    strategy: str(b.strategy, 80),
    session: str(b.session, 20),
    mistakes: Array.isArray(b.mistakes) ? b.mistakes.map((x) => str(x, 40)).filter(Boolean).slice(0, 20) : [],
    notes: { why: str(notes.why, 5000), feelings: str(notes.feelings, 5000), lesson: str(notes.lesson, 5000) },
    images: { before, after },
  };
}

function allReferencedFiles(st) {
  const set = new Set();
  st.trades.forEach((t) => [...t.images.before, ...t.images.after].forEach((f) => set.add(f)));
  (st.analyses || []).forEach((a) => [...a.images.before, ...a.images.after].forEach((f) => set.add(f)));
  return set;
}
// The app only ever deletes files that it created itself (its own naming pattern),
// so other pictures in the same folder can never be removed.
const OWN_FILE = /^\d{4}-\d{2}-\d{2}_[A-Z0-9]+_(before|after)_[0-9a-f]{6}\.(png|jpg|webp|gif)$/;
function deleteImageFile(st, name) {
  const safe = safeFile(name);
  if (!safe || safe !== String(name) || !OWN_FILE.test(safe)) return;
  try {
    fs.unlinkSync(path.join(st.imgDir, safe));
  } catch (e) {
    /* file already gone */
  }
}

// ---------- Server ----------
const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1); // behind Caddy/https
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));

const createAuth = require('./auth');
const auth = createAuth({
  dataDir: DATA_DIR,
  readJson,
  writeJson,
  getSignup: signupSettings,
  onUserCreated: (user, isFirst) => (isFirst ? adoptLegacyData(user) : getStore(user)),
});
app.use('/api/auth', auth.router);

// Public, unguessable media links: only explicitly shared images/videos are visible.
// Buffer must be able to fetch these links without logging in until publishing completes.
app.get('/buffer-media/:token', (req, res) => {
  const entry = bufferShares[String(req.params.token || '')];
  if (!entry || !entry.file) return res.status(404).send('Media not found');
  const file = path.resolve(entry.file);
  const imageRoot = path.resolve(IMAGE_DIR) + path.sep;
  const videoRoot = path.resolve(USERS_DIR) + path.sep;
  const isImage = file.startsWith(imageRoot) && /\.(png|jpe?g|webp|gif)$/i.test(file);
  const isVideo = file.startsWith(videoRoot) && /[/\\]buffer-videos[/\\][0-9a-f]{32}\.(mp4|mov)$/i.test(file);
  if ((!isImage && !isVideo) || !fs.existsSync(file)) return res.status(404).send('Media not found');
  const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime' })[path.extname(file).toLowerCase()];
  if (!mime) return res.status(415).send('Unsupported media');
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Accept-Ranges', 'bytes');
  res.sendFile(file);
});

// Everything below this line needs a logged-in user and only ever sees that user's data.
app.use(['/api', '/images'], auth.requireAuth, (req, res, next) => {
  req.store = getStore(req.user);
  next();
});

require('./admin')(app, {
  auth, adminCfg, saveAdminCfg, applyAiConfig, effectiveAiKey, signupSettings, aiUsage, saveAiUsage,
  getGroq: () => groq, getModel: () => GROQ_MODEL, getStore, stores, imageStatics,
  USERS_DIR, IMAGE_DIR, DATA_DIR, readJson,
  keyFromEnv: () => !!process.env.GROQ_API_KEY,
});

// ---------- Buffer publishing integration (API key remains server-side) ----------
async function bufferGraphQL(apiKey, query) {
  const response = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((e) => e.message).filter(Boolean).join('; ') || `Buffer API request failed (${response.status})`;
    throw new Error(message);
  }
  return payload.data || {};
}
function gqlString(value) { return JSON.stringify(String(value ?? '')); }
function getBufferBaseUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
    return u.origin;
  } catch (_) { return null; }
}
app.get('/api/buffer/config', (req, res) => {
  const b = req.store.buffer;
  res.json({ connected: !!b.apiKey, organizationId: b.organizationId || '', publicBaseUrl: b.publicBaseUrl || '' });
});
app.post('/api/buffer/connect', async (req, res) => {
  const st = req.store;
  const key = String(req.body?.apiKey || st.buffer.apiKey || '').trim();
  if (!key) return res.status(400).json({ error: 'Paste your Buffer API key first.' });
  try {
    const data = await bufferGraphQL(key, 'query GetOrganizations { account { organizations { id name } } }');
    const organizations = data.account?.organizations || [];
    st.buffer.apiKey = key;
    st.buffer.saveAt = new Date().toISOString();
    st.saveBuffer();
    res.json({ connected: true, organizations });
  } catch (e) {
    res.status(400).json({ error: `Could not connect to Buffer: ${e.message}` });
  }
});
app.get('/api/buffer/organizations', async (req, res) => {
  const key = req.store.buffer.apiKey;
  if (!key) return res.status(400).json({ error: 'Connect Buffer first.' });
  try {
    const data = await bufferGraphQL(key, 'query GetOrganizations { account { organizations { id name } } }');
    res.json({ organizations: data.account?.organizations || [] });
  } catch (e) { res.status(400).json({ error: `Could not load Buffer organizations: ${e.message}` }); }
});
app.post('/api/buffer/organization', (req, res) => {
  const id = String(req.body?.organizationId || '').trim();
  if (!req.store.buffer.apiKey) return res.status(400).json({ error: 'Connect Buffer first.' });
  if (!/^[a-f0-9-]{8,80}$/i.test(id)) return res.status(400).json({ error: 'Choose a valid Buffer organization.' });
  req.store.buffer.organizationId = id;
  req.store.saveBuffer();
  res.json({ ok: true });
});
app.get('/api/buffer/channels', async (req, res) => {
  const b = req.store.buffer;
  if (!b.apiKey || !b.organizationId) return res.status(400).json({ error: 'Connect Buffer and choose an organization first.' });
  try {
    const data = await bufferGraphQL(b.apiKey, `query GetChannels { channels(input: { organizationId: ${gqlString(b.organizationId)} }) { id name displayName service avatar isDisconnected isLocked } }`);
    res.json({ channels: data.channels || [] });
  } catch (e) { res.status(400).json({ error: `Could not load Buffer channels: ${e.message}` }); }
});
app.post('/api/buffer/public-url', (req, res) => {
  const base = getBufferBaseUrl(req.body?.publicBaseUrl);
  if (!base) return res.status(400).json({ error: 'Enter your journal’s public HTTPS address, for example https://journal.example.com.' });
  req.store.buffer.publicBaseUrl = base;
  req.store.saveBuffer();
  res.json({ publicBaseUrl: base });
});
// MP4/MOV uploads are private until a post explicitly shares a long, random link.
// The journal never publishes the whole videos folder.
const BUFFER_MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const BUFFER_VIDEO_QUOTA_BYTES = 1024 * 1024 * 1024;
// Stream binary uploads to disk without additional npm dependencies.
async function receiveBufferVideo(req, st) {
  let originalName = '';
  try { originalName = decodeURIComponent(String(req.headers['x-video-name'] || '')); }
  catch (_) { throw new Error('Invalid video filename.'); }
  const ext = path.extname(originalName).toLowerCase();
  if (!['.mp4', '.mov'].includes(ext)) throw new Error('Upload an MP4 or MOV video.');
  const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
  if (!['video/mp4', 'video/quicktime', 'application/octet-stream'].includes(contentType)) throw new Error('This file must be an MP4 or MOV video.');
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > BUFFER_MAX_VIDEO_BYTES) throw new Error('Video exceeds the 200 MB upload limit.');
  const name = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  const file = path.join(st.videoDir, name);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, encoding, done) {
      size += chunk.length;
      done(size > BUFFER_MAX_VIDEO_BYTES ? new Error('Video exceeds the 200 MB upload limit.') : null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, fs.createWriteStream(file, { flags: 'wx' }));
    if (size < 12) throw new Error('The uploaded video is empty or damaged.');
    const header = Buffer.alloc(12);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, header, 0, 12, 0); }
    finally { fs.closeSync(fd); }
    if (header.subarray(4, 8).toString('ascii') !== 'ftyp') throw new Error('The uploaded file is not a supported MP4/MOV video.');
    const used = st.videos.reduce((sum, v) => sum + (Number(v.size) || 0), 0);
    if (used + size > BUFFER_VIDEO_QUOTA_BYTES) throw new Error('Your video library has a 1 GB limit. Remove an unused video first.');
    return { id: crypto.randomBytes(12).toString('hex'), file: name, name: path.basename(originalName).slice(0, 150), size, createdAt: new Date().toISOString() };
  } catch (err) {
    try { fs.unlinkSync(file); } catch (_) {}
    throw err;
  }
}

app.get('/api/buffer/videos', (req, res) => {
  res.json({ videos: req.store.videos.map(({ id, name, size, createdAt }) => ({ id, name, size, createdAt })) });
});
app.get('/api/buffer/videos/:id/file', (req, res) => {
  const video = req.store.videos.find((v) => v.id === req.params.id);
  if (!video) return res.status(404).send('Video not found');
  const file = path.join(req.store.videoDir, video.file);
  if (!fs.existsSync(file)) return res.status(404).send('Video not found');
  res.setHeader('Cache-Control', 'private, no-store');
  res.type(path.extname(video.file) === '.mov' ? 'video/quicktime' : 'video/mp4');
  res.sendFile(path.resolve(file));
});
app.post('/api/buffer/videos', async (req, res) => {
  try {
    const video = await receiveBufferVideo(req, req.store);
    req.store.videos.unshift(video);
    req.store.saveVideos();
    res.status(201).json({ video: { id: video.id, name: video.name, size: video.size, createdAt: video.createdAt } });
  } catch (err) {
    if (!res.headersSent) res.status(400).json({ error: err.message || 'Upload failed.' });
  }
});
app.delete('/api/buffer/videos/:id', (req, res) => {
  const i = req.store.videos.findIndex((v) => v.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Video not found.' });
  const [video] = req.store.videos.splice(i, 1);
  req.store.saveVideos();
  const absolute = path.resolve(req.store.videoDir, video.file);
  for (const [token, share] of Object.entries(bufferShares)) {
    if (share.file === absolute) delete bufferShares[token];
  }
  saveBufferShares();
  try { fs.unlinkSync(absolute); } catch (_) {}
  res.json({ ok: true });
});

const BUFFER_YOUTUBE_CATEGORIES = new Set(['1', '2', '10', '15', '17', '19', '20', '22', '23', '24', '25', '26', '27', '28', '29']);
function bufferService(channel) { return String(channel?.service || '').toLowerCase(); }
function bufferValidateChannel(channel, hasImages, hasVideo, content, options) {
  const service = bufferService(channel);
  if (service === 'facebook') {
    if (!['post', 'story', 'reel'].includes(options.facebookType)) return 'Select a Facebook post, story, or reel.';
    if (options.facebookType === 'reel' && !hasVideo) return 'Facebook reels require a video.';
    if (options.facebookType === 'story' && !hasVideo && !hasImages) return 'Facebook stories require an image or video.';
  }
  if (service === 'instagram') {
    if (!['post', 'story', 'reel'].includes(options.instagramType)) return 'Choose an Instagram format.';
    if (!hasVideo && !hasImages) return 'Instagram requires an image or video.';
    if (options.instagramType === 'reel' && !hasVideo) return 'Instagram reels require a video.';
  }
  if (service === 'youtube') {
    if (!hasVideo) return 'YouTube posts require a video (screenshots alone are not supported).';
    if (!options.youtubeTitle.trim()) return 'YouTube requires a video title.';
    if (!BUFFER_YOUTUBE_CATEGORIES.has(options.youtubeCategory)) return 'Choose a YouTube category.';
  }
  if (service === 'tiktok' && !hasVideo && !hasImages) return 'TikTok needs a video or photo.';
  if (!content && !hasImages && !hasVideo) return 'Write a caption or add media.';
  return null;
}
function bufferMetadata(channel, options) {
  const service = bufferService(channel);
  if (service === 'facebook') return `metadata: { facebook: { type: ${options.facebookType} } }`;
  if (service === 'instagram') return `metadata: { instagram: { type: ${options.instagramType} shouldShareToFeed: ${options.instagramShareToFeed} } }`;
  if (service === 'youtube') return `metadata: { youtube: { title: ${gqlString(options.youtubeTitle)} categoryId: ${gqlString(options.youtubeCategory)} } }`;
  return '';
}
app.post('/api/buffer/publish', async (req, res) => {
  const st = req.store;
  const b = st.buffer;
  const content = String(req.body?.text || '').trim().slice(0, 5000);
  const mode = ['schedule', 'queue', 'draft'].includes(req.body?.mode) ? req.body.mode : null;
  const requested = Array.isArray(req.body?.channelIds) ? req.body.channelIds : (req.body?.channelId ? [req.body.channelId] : []);
  const channelIds = [...new Set(requested.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean))];
  const imageFiles = Array.isArray(req.body?.imageFiles) ? [...new Set(req.body.imageFiles.map((x) => safeFile(x)).filter(Boolean))] : [];
  const videoId = typeof req.body?.videoId === 'string' ? req.body.videoId : '';
  const video = videoId ? st.videos.find((v) => v.id === videoId) : null;
  const options = {
    facebookType: String(req.body?.facebookType || 'post'),
    instagramType: String(req.body?.instagramType || (video ? 'reel' : 'post')),
    instagramShareToFeed: req.body?.instagramShareToFeed !== false,
    youtubeTitle: String(req.body?.youtubeTitle || '').trim().slice(0, 100),
    youtubeCategory: String(req.body?.youtubeCategory || '27'),
  };
  if (!b.apiKey || !b.organizationId) return res.status(400).json({ error: 'Connect Buffer and choose an organization first.' });
  if (!mode) return res.status(400).json({ error: 'Select Schedule, Queue, or Draft.' });
  if (!channelIds.length || channelIds.length > 25) return res.status(400).json({ error: 'Select 1 to 25 connected Buffer channels.' });
  if (imageFiles.length > 4) return res.status(400).json({ error: 'Attach up to four screenshots.' });
  if (videoId && !video) return res.status(400).json({ error: 'Selected video no longer exists in your library.' });
  if (video && imageFiles.length) return res.status(400).json({ error: 'Select either a video or screenshots, not both in the same post.' });
  if (!content && !imageFiles.length && !video) return res.status(400).json({ error: 'Add text, a screenshot or a video.' });
  if (video && !fs.existsSync(path.join(st.videoDir, video.file))) return res.status(400).json({ error: 'Video file is missing. Upload it again.' });

  let dueAt = null;
  if (mode === 'schedule') {
    const requestedAt = String(req.body?.dueAt || '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(requestedAt)) {
      return res.status(400).json({ error: 'Enter a valid scheduled date and time with a timezone.' });
    }
    const timestamp = Date.parse(requestedAt);
    if (!Number.isFinite(timestamp) || timestamp <= Date.now() + 30000) return res.status(400).json({ error: 'Schedule a future date and time.' });
    dueAt = new Date(timestamp).toISOString();
  }

  let available;
  try {
    const data = await bufferGraphQL(b.apiKey, `query GetChannels { channels(input: { organizationId: ${gqlString(b.organizationId)} }) { id name displayName service isDisconnected isLocked } }`);
    available = data.channels || [];
  } catch (e) { return res.status(502).json({ error: `Could not verify Buffer channels: ${e.message}` }); }
  const usable = new Map(available.filter((c) => c?.id && !c.isDisconnected && !c.isLocked).map((c) => [c.id, c]));
  const unavailable = channelIds.filter((id) => !usable.has(id));
  if (unavailable.length) return res.status(400).json({ error: 'Selected Buffer channels are no longer available. Reload Publish.' });

  const base = (imageFiles.length || video) && getBufferBaseUrl(b.publicBaseUrl);
  if ((imageFiles.length || video) && !base) return res.status(400).json({ error: 'Set a public HTTPS journal address before posting images or videos.' });
  const assets = [];
  if (imageFiles.length) {
    for (const file of imageFiles) {
      if (!OWN_FILE.test(file) || !fs.existsSync(path.join(st.imgDir, file))) return res.status(400).json({ error: `Screenshot not found: ${file}` });
      const token = crypto.randomBytes(24).toString('hex');
      bufferShares[token] = { file: path.resolve(st.imgDir, file), owner: st.uid, createdAt: new Date().toISOString() };
      assets.push(`{ image: { url: ${gqlString(`${base}/buffer-media/${token}`)} } }`);
    }
  } else if (video) {
    const token = crypto.randomBytes(24).toString('hex');
    bufferShares[token] = { file: path.resolve(st.videoDir, video.file), owner: st.uid, createdAt: new Date().toISOString() };
    assets.push(`{ video: { url: ${gqlString(`${base}/buffer-media/${token}`)} } }`);
  }
  if (assets.length) saveBufferShares();

  const sharedFields = `text: ${gqlString(content)} schedulingType: automatic mode: ${mode === 'schedule' ? 'customScheduled' : 'addToQueue'}${dueAt ? ` dueAt: ${gqlString(dueAt)}` : ''} saveToDraft: ${mode === 'draft' ? 'true' : 'false'} assets: [${assets.join(' ')}]`;
  // A separate mutation per channel keeps per-platform metadata independent.
  // Never auto-retry: Buffer may have accepted a previous request before network failure.
  const results = [];
  for (const channelId of channelIds) {
    const channel = usable.get(channelId);
    const channelName = channel.displayName || channel.name || channel.service || channelId;
    const validationError = bufferValidateChannel(channel, !!imageFiles.length, !!video, content, options);
    if (validationError) {
      results.push({ channelId, channelName, ok: false, error: validationError });
      continue;
    }
    const metadata = bufferMetadata(channel, options);
    const mutation = `mutation CreatePost { createPost(input: { ${sharedFields} channelId: ${gqlString(channelId)} ${metadata} }) { ... on PostActionSuccess { post { id text dueAt status channelId } } ... on MutationError { message } } }`;
    try {
      const response = await bufferGraphQL(b.apiKey, mutation);
      const out = response.createPost;
      if (!out?.post || out.message) throw new Error(out?.message || 'Buffer did not confirm this post. Check Buffer before retrying.');
      results.push({ channelId, channelName, ok: true, post: { id: out.post.id, dueAt: out.post.dueAt, status: out.post.status } });
    } catch (e) {
      results.push({ channelId, channelName, ok: false, error: e.message });
    }
  }
  const successCount = results.filter((item) => item.ok).length;
  res.json({ ok: successCount === results.length, mode, dueAt, successCount, failureCount: results.length - successCount, results });
});

app.get('/api/config', (req, res) =>
  res.json(
    req.user.role === 'admin'
      ? { imageDir: req.store.imgDir, dataDir: req.store.dir }
      : { imageDir: 'Stored on the PC that runs the journal', dataDir: 'Stored on the PC that runs the journal' }
  )
);

app.get('/api/settings', (req, res) => res.json(req.store.settings));
app.put('/api/settings', (req, res) => {
  const st = req.store;
  const b = req.body || {};
  const pairs = (Array.isArray(b.pairs) ? b.pairs : [])
    .map((p) => ({ symbol: str(p.symbol, 20).toUpperCase().replace(/\s/g, ''), unit: num(p.unit) || 1 }))
    .filter((p) => p.symbol);
  const s = b.sessions || {};
  const hour = (v, d) => {
    const n = num(v);
    return n === null ? d : Math.min(23, Math.max(0, Math.round(n)));
  };
  const settings = st.settings = {
    startingBalance: num(b.startingBalance) === null ? 0 : num(b.startingBalance),
    pairs: pairs.length ? pairs : DEFAULT_SETTINGS.pairs,
    sessions: { asia: hour(s.asia, 0), london: hour(s.london, 9), newyork: hour(s.newyork, 15) },
    rules: strList(b.rules, 30, 80),
  };
  writeJson(st.settingsFile, settings);
  res.json(settings);
});

app.get('/api/knowledge', (req, res) => res.json(readJson(req.store.knowledgeFile, [])));
app.post('/api/knowledge', (req, res) => {
  const st = req.store;
  const list = readJson(st.knowledgeFile, []);
  const item = {
    id: crypto.randomBytes(5).toString('hex'),
    createdAt: new Date().toISOString().slice(0, 10),
    type: str(req.body?.type, 30) || 'Note',
    title: str(req.body?.title, 120).trim(),
    body: str(req.body?.body, 5000).trim(),
  };
  if (!item.title || !item.body) return res.status(400).json({ error: 'Title and note are required' });
  list.unshift(item);
  writeJson(st.knowledgeFile, list.slice(0, 200));
  res.json(item);
});

app.get('/api/trades', (req, res) => res.json(req.store.trades));

function assistantStats(st) {
  const { trades, settings } = st;
  const closed = trades.filter(t => t.closedAt || t.exit !== null || t.pnl !== null || t.r !== null);
  const rs = closed.map(t => Number(t.r)).filter(Number.isFinite);
  const pnl = closed.map(t => Number(t.pnl)).filter(Number.isFinite);
  const wins = closed.filter(t => Number(t.r) > 0 || Number(t.pnl) > 0);
  const losses = closed.filter(t => Number(t.r) < 0 || Number(t.pnl) < 0);
  const ruleRows = settings.rules.map(rule => {
    const relevant = closed.filter(t => (t.rulesAll || []).includes(rule));
    const followed = relevant.filter(t => (t.rulesChecked || []).includes(rule));
    const broken = relevant.filter(t => !((t.rulesChecked || []).includes(rule)));
    const avg = arr => arr.length ? arr.reduce((a,t)=>a+(Number(t.r)||0),0)/arr.length : null;
    return { rule, trades: relevant.length, followed: followed.length, broken: broken.length, avgRWhenFollowed: avg(followed), avgRWhenBroken: avg(broken) };
  });
  const group = (field) => Object.entries(closed.reduce((m,t)=>{const k=t[field]||'Unspecified';(m[k] ||= []).push(t);return m},{})).map(([name,a])=>({name,count:a.length,avgR:a.length?a.reduce((x,t)=>x+(Number(t.r)||0),0)/a.length:0,pnl:a.reduce((x,t)=>x+(Number(t.pnl)||0),0)})).sort((a,b)=>b.avgR-a.avgR);
  return {
    totalTrades: trades.length, closedTrades: closed.length, openTrades: trades.length-closed.length,
    wins: wins.length, losses: losses.length, winRate: closed.length ? wins.length/closed.length : null,
    totalR: rs.reduce((a,b)=>a+b,0), totalPnl: pnl.reduce((a,b)=>a+b,0), avgR: rs.length ? rs.reduce((a,b)=>a+b,0)/rs.length : null,
    bestTrade: rs.length ? Math.max(...rs) : null, worstTrade: rs.length ? Math.min(...rs) : null,
    bySymbol: group('symbol'), bySession: group('session'), bySetup: group('strategy'),
    rulePerformance: ruleRows,
    mistakes: Object.entries(closed.flatMap(t=>t.mistakes||[]).reduce((m,x)=>(m[x]=(m[x]||0)+1,m),{})).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count})),
  };
}

function assistantContext(st) {
  const { trades, settings } = st;
  const recent = trades.slice(-ASSISTANT_MAX_TRADES).map(t => ({
    id:t.id, openedAt:t.openedAt, closedAt:t.closedAt, symbol:t.symbol, side:t.side,
    entry:t.entry, sl:t.sl, tp:t.tp, exit:t.exit, lots:t.lots, riskUsd:t.riskUsd,
    pnl:t.pnl, pips:t.pips, r:t.r, strategy:t.strategy, session:t.session,
    mistakes:t.mistakes, rulesAll:t.rulesAll, rulesChecked:t.rulesChecked,
    notes:t.notes, images:t.images, captions:t.captions, imageTags:t.imageTags
  }));
  const knowledge = readJson(st.knowledgeFile, []).slice(0,200);
  return {
    product:'EDGE Trading Journal',
    capabilities:['Journal and trade recording','Trade replay and review','Insights and Trading DNA','Setup library','Performance statistics','Advanced command search','Screenshot tagging and visual library','Personal knowledge base','Analysis section for saving chart analysis screenshots (before and after) without a trade','AI assisted review'],
    settings,
    stats:assistantStats(st),
    knowledge,
    analyses: (st.analyses || []).slice(-50).map(a => ({ id:a.id, date:a.date, symbol:a.symbol, timeframe:a.timeframe, bias:a.bias, title:a.title, notes:a.notes, tags:a.tags, beforeShots:a.images.before.length, afterShots:a.images.after.length })),
    trades:recent
  };
}

const assistantRequests = new Map();
function assistantRateLimited(ip) {
  const now = Date.now(), windowMs = 60000, max = adminCfg.ai.rateLimit;
  const row = assistantRequests.get(ip) || [];
  const fresh = row.filter(t => now-t < windowMs);
  fresh.push(now); assistantRequests.set(ip,fresh);
  return fresh.length > max;
}

app.get('/api/assistant/status', async (req, res) => {
  const blocked = aiBlocked(req);
  if (blocked) return res.json({ enabled:false, disabledBy:'admin', message:blocked, provider:'groq', model:GROQ_MODEL, running:false, configured:!!groq });
  if (!groq) return res.json({ enabled:false, provider:'groq', model:GROQ_MODEL, running:false, configured:false });
  try {
    await groq.models.list();
    res.json({ enabled:true, provider:'groq', model:GROQ_MODEL, running:true, configured:true });
  } catch (e) {
    res.json({ enabled:false, provider:'groq', model:GROQ_MODEL, running:false, configured:true, error:e.message });
  }
});


function normalizeAction(st, action) {
  const { trades, settings } = st;
  if (!action || typeof action !== 'object') return null;
  const allowed = new Set(['navigate','open_trade','filter_journal','save_knowledge','add_rule','weekly_review']);
  if (!allowed.has(action.type)) return null;
  if (action.type === 'open_trade') {
    const id = str(action.id, 40).trim();
    if (!trades.some(t => t.id === id)) return null;
    return { type:'open_trade', id };
  }
  if (action.type === 'navigate') {
    const page = str(action.page, 30).toLowerCase().trim();
    const allowedPages = new Set(['journal','review','insights','setups','stats','settings','search3','library','knowledge','review3']);
    if (!allowedPages.has(page)) return null;
    return { type:'navigate', page };
  }
  if (action.type === 'filter_journal') {
    const filters = action.filters && typeof action.filters === 'object' ? action.filters : {};
    const clean = {};
    for (const k of ['symbol','session','result','side','strategy','from','to','q']) {
      if (filters[k] != null) clean[k] = str(filters[k], 120).trim();
    }
    return { type:'filter_journal', filters:clean };
  }
  if (action.type === 'save_knowledge') {
    const title = str(action.title,120).trim(), body = str(action.body,5000).trim();
    if (!title || !body) return null;
    const list = readJson(st.knowledgeFile, []);
    const item = { id:crypto.randomBytes(5).toString('hex'), createdAt:new Date().toISOString().slice(0,10), type:str(action.noteType,30)||'Discovery', title, body };
    list.unshift(item); writeJson(st.knowledgeFile, list.slice(0,200));
    return { type:'save_knowledge', item };
  }
  if (action.type === 'add_rule') {
    const rule = str(action.rule,200).trim();
    if (!rule) return null;
    if (!settings.rules.includes(rule)) { settings.rules = [...settings.rules, rule].slice(0,30); writeJson(st.settingsFile,settings); }
    return { type:'add_rule', rule };
  }
  if (action.type === 'weekly_review') return { type:'weekly_review' };
  return null;
}

function commandFallback(st, question) {
  const { trades } = st;
  const q = question.toLowerCase().trim();
  const actions=[];
  const tradeMatch = q.match(/(?:trade|#)\s*([a-f0-9]{6,40})\b/);
  if (tradeMatch && trades.some(t=>t.id===tradeMatch[1])) actions.push({type:'open_trade',id:tradeMatch[1]});
  if (/\b(review|review mode|weekly review)\b/.test(q)) actions.push({type:'navigate',page:'review'});
  else if (/\b(insights|trading dna|biggest leak|behavior)\b/.test(q)) actions.push({type:'navigate',page:'insights'});
  else if (/\b(setup library|setups)\b/.test(q)) actions.push({type:'navigate',page:'setups'});
  else if (/\b(stats|statistics|performance)\b/.test(q)) actions.push({type:'navigate',page:'stats'});
  else if (/\b(screenshot library|screenshot tags|visual library)\b/.test(q)) actions.push({type:'navigate',page:'library'});
  else if (/\b(knowledge base|knowledge)\b/.test(q)) actions.push({type:'navigate',page:'knowledge'});
  else if (/\b(search|find|show)\b/.test(q)) {
    const filters={};
    const sym=['XAUUSD','GBPUSD','AUDUSD','NAS100','SP500','USDCAD'].find(x=>q.includes(x.toLowerCase())); if(sym) filters.symbol=sym;
    if (/\b(losing|loss|losers)\b/.test(q)) filters.result='loss';
    if (/\b(winning|wins|winners|best)\b/.test(q)) filters.result='win';
    if (/\brule violations?\b|\bbroke.*rules?\b/.test(q)) filters.q='rule';
    if (/\brevenge\b/.test(q)) filters.q='Revenge trade';
    if (Object.keys(filters).length) actions.push({type:'filter_journal',filters});
  }
  return actions;
}

app.post('/api/assistant/command', async (req,res) => {
  const st = req.store;
  const blocked = aiBlocked(req);
  if (blocked) return res.status(403).json({ error: blocked });
  if (assistantRateLimited(req.user.id)) return res.status(429).json({error:'Too many assistant requests. Try again in a minute.'});
  const question = str(req.body?.question,4000).trim();
  if (!question) return res.status(400).json({error:'Enter a command.'});
  const context=assistantContext(st);
  const fallback=commandFallback(st, question);
  let actions=fallback;
  let answer='';
  if (!groq) return res.status(503).json({error:'EDGE AI is not configured. Set GROQ_API_KEY in the server environment.'});
  try {
    const system=`You are the action router for EDGE Trading Journal. Return ONLY valid JSON, no markdown. Schema: {\"answer\":\"short confirmation or explanation\",\"actions\":[...]}. Allowed actions: navigate {type,page}, open_trade {type,id}, filter_journal {type,filters}, save_knowledge {type,noteType,title,body}, add_rule {type,rule}, weekly_review {type}. Valid pages: journal, review, insights, setups, stats, settings, search3, library, knowledge, review3. Only reference trade IDs that exist in the supplied context. Do not invent IDs. Only mutate knowledge/rules when the user explicitly asks to save/add them. If no action is appropriate, actions=[]. Context: ${JSON.stringify({settings:context.settings,stats:context.stats,trades:context.trades.map(t=>({id:t.id,symbol:t.symbol,openedAt:t.openedAt,closedAt:t.closedAt,r:t.r,pnl:t.pnl,strategy:t.strategy,session:t.session,mistakes:t.mistakes,notes:t.notes})),knowledge:context.knowledge})}`;
    recordAiUse(req.user.id);
    const completion=await groq.chat.completions.create({
      model:GROQ_MODEL,
      messages:[{role:'system',content:system},{role:'user',content:question}],
      temperature:0.1,
      response_format:{type:'json_object'}
    });
    const content=completion.choices?.[0]?.message?.content || '';
    try {
      const parsed=JSON.parse(content);
      const modelActions=Array.isArray(parsed.actions)?parsed.actions.map(a=>normalizeAction(st,a)).filter(Boolean):[];
      actions=modelActions.length?modelActions:fallback;
      answer=str(parsed.answer,1000).trim();
    } catch(e) {}
  } catch(e) {
    console.error('Groq command error:', e.message);
  }
  if (!answer) answer=actions.length?'I can do that.':'I could not map that to a website action yet.';
  res.json({answer,actions,model:GROQ_MODEL,provider:'groq'});
});


// Admin-only, read-only: let EDGE AI look at another account (or all accounts).
function adminScopeContext(scope) {
  const slim = (t) => ({ id:t.id, openedAt:t.openedAt, closedAt:t.closedAt, symbol:t.symbol, side:t.side, pnl:t.pnl, r:t.r, strategy:t.strategy, session:t.session, mistakes:t.mistakes, notes:t.notes });
  if (scope === 'all') {
    const list = auth.users;
    const per = Math.max(15, Math.floor(ASSISTANT_MAX_TRADES / Math.max(1, list.length)));
    return {
      label: 'all accounts on this journal',
      context: {
        product:'EDGE Trading Journal',
        capabilities:['Journal and trade recording','Trade replay and review','Insights and Trading DNA','Setup library','Performance statistics'],
        accounts: list.map((u) => { const s = getStore(u); return { username:u.username, name:u.name, role:u.role, disabled:!!u.disabled, stats:assistantStats(s), recentTrades:s.trades.slice(-per).map(slim) }; }),
      },
    };
  }
  const u = auth.users.find((x) => x.id === scope || x.username === scope);
  if (!u) return null;
  const context = assistantContext(getStore(u));
  context.account = { username:u.username, name:u.name };
  return { label: `the account "${u.username}"`, context };
}

app.post('/api/assistant', async (req,res) => {
  const st = req.store;
  const blocked = aiBlocked(req);
  if (blocked) return res.status(403).json({ error: blocked });
  if (assistantRateLimited(req.user.id)) return res.status(429).json({error:'Too many assistant requests. Try again in a minute.'});
  const question = str(req.body?.question, 4000).trim();
  const voiceMode = !!req.body?.voice;
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8).map(x => ({role:x.role==='assistant'?'assistant':'user', content:str(x.content,3000)})) : [];
  if (!question) return res.status(400).json({error:'Ask the assistant a question.'});
  if (!groq) return res.status(503).json({error:'EDGE AI is not configured. Set GROQ_API_KEY in the server environment, then restart EDGE.'});

  const scope = String(req.body?.scope || 'me');
  let context, scopeNote = '';
  if (scope === 'me') {
    context = assistantContext(st);
  } else {
    if (req.user.role !== 'admin') return res.status(403).json({ error:'Only the admin can look at other accounts.' });
    const sc = adminScopeContext(scope);
    if (!sc) return res.status(404).json({ error:'That account was not found.' });
    context = sc.context;
    scopeNote = `ADMIN VIEW: the person asking is the journal admin and the data below is ${sc.label}, not the admin's own journal. Refer to people by username. This view is read-only.\n\n`;
    console.log(`[AI] admin "${req.user.username}" asked EDGE AI about ${sc.label}`);
  }
  const system = `You are EDGE AI, the built-in assistant for EDGE Trading Journal.

Answer questions about how the website works and the user's actual journal data. The application context below is live data from the local journal.

Rules:
1. Never invent trades, statistics, features, settings, or evidence.
2. When discussing statistics, use the supplied data and show the relevant numbers.
3. Distinguish correlation from causation. Say when the sample is small.
4. You may explain trading concepts educationally, but do not give financial advice or tell the user what to buy or sell.
5. If asked how the website works, use the capabilities and data supplied below.
6. If asked about a trade, use its ID and recorded fields. Do not pretend to see an image unless image metadata is supplied.
7. Keep answers useful and reasonably concise. You are allowed to say that the journal does not contain enough data.
8. If the user asks you to perform an action, explain what you can do and the UI action will be handled separately by EDGE's command router.

${voiceMode ? '9. The user is talking to you by voice and your answer will be read aloud. Reply in 1 to 4 short, simple spoken sentences. No markdown, no lists, no emojis, no symbols. Say numbers naturally (for example "sixty two percent"). Give the most important point first.\n' : ''}
Website capabilities: ${context.capabilities.join(', ')}.

${scopeNote}Current application context JSON:
${JSON.stringify(context)}${adminCfg.ai.extraInstructions ? '\n\nExtra instructions from the journal admin (follow them unless they conflict with the rules above):\n' + adminCfg.ai.extraInstructions : ''}`;

  const messages = [{ role:'system', content:system }, ...history, {role:'user', content:question}];
  try {
    recordAiUse(req.user.id);
    const completion = await groq.chat.completions.create({
      model:GROQ_MODEL,
      messages,
      temperature:0.2,
      max_completion_tokens:voiceMode?400:2048
    });
    const answer = completion.choices?.[0]?.message?.content?.trim();
    if (!answer) return res.status(502).json({error:'Groq returned an empty response.'});
    res.json({answer, model:GROQ_MODEL, provider:'groq', actions:scope === 'me' ? commandFallback(st, question) : []});
  } catch (e) {
    console.error('Groq assistant error:', e.message);
    const detail = e?.error?.error?.message || e?.message || 'Groq request failed.';
    res.status(503).json({error:detail});
  }
});


app.post('/api/trades', (req, res) => {
  const st = req.store;
  const t = Object.assign(
    { id: crypto.randomBytes(5).toString('hex'), createdAt: new Date().toISOString() },
    cleanTrade(req.body)
  );
  if (!t.symbol || !t.openedAt) return res.status(400).json({ error: 'Pair and open time are required' });
  st.trades.push(t);
  st.saveTrades();
  res.json(t);
});

app.put('/api/trades/:id', (req, res) => {
  const st = req.store;
  const trades = st.trades;
  const i = trades.findIndex((t) => t.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Trade not found' });
  const old = trades[i];
  const next = Object.assign({}, old, cleanTrade(req.body), { updatedAt: new Date().toISOString() });
  if (!next.symbol || !next.openedAt) return res.status(400).json({ error: 'Pair and open time are required' });
  const keep = new Set([...next.images.before, ...next.images.after]);
  [...old.images.before, ...old.images.after].filter((f) => !keep.has(f)).forEach((f) => deleteImageFile(st, f));
  trades[i] = next;
  st.saveTrades();
  res.json(next);
});

// ---------- Analyses: chart analysis screenshots saved without a trade ----------
function cleanAnalysis(b) {
  b = b || {};
  const imgs = b.images || {};
  const before = fileList(imgs.before).slice(0, 20);
  const after = fileList(imgs.after).slice(0, 20);
  const captions = {};
  if (b.captions && typeof b.captions === 'object') {
    [...before, ...after].forEach((f) => {
      const c = str(b.captions[f], 80).trim();
      if (c) captions[f] = c;
    });
  }
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : new Date().toISOString().slice(0, 10),
    symbol: str(b.symbol, 20).toUpperCase().replace(/\s/g, ''),
    timeframe: str(b.timeframe, 20).trim(),
    bias: ['Bullish', 'Bearish', 'Neutral'].includes(b.bias) ? b.bias : '',
    title: str(b.title, 120).trim(),
    notes: str(b.notes, 8000),
    tags: strList(b.tags, 12, 32),
    captions,
    images: { before, after },
  };
}
app.get('/api/analyses', (req, res) => res.json(req.store.analyses));
app.post('/api/analyses', (req, res) => {
  const st = req.store;
  const a = cleanAnalysis(req.body);
  if (!a.images.before.length && !a.images.after.length && !a.title && !a.notes) {
    return res.status(400).json({ error: 'Add a screenshot or a note first.' });
  }
  const now = new Date().toISOString();
  const rec = Object.assign({ id: crypto.randomBytes(5).toString('hex'), createdAt: now, updatedAt: now }, a);
  st.analyses.push(rec);
  st.saveAnalyses();
  res.json(rec);
});
app.put('/api/analyses/:id', (req, res) => {
  const st = req.store;
  const i = st.analyses.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Analysis not found' });
  const old = st.analyses[i];
  const a = cleanAnalysis(req.body);
  if (!a.images.before.length && !a.images.after.length && !a.title && !a.notes) {
    return res.status(400).json({ error: 'Add a screenshot or a note first.' });
  }
  const next = Object.assign({}, old, a, { id: old.id, createdAt: old.createdAt, updatedAt: new Date().toISOString() });
  const keep = new Set([...next.images.before, ...next.images.after]);
  [...old.images.before, ...old.images.after].filter((f) => !keep.has(f)).forEach((f) => deleteImageFile(st, f));
  st.analyses[i] = next;
  st.saveAnalyses();
  res.json(next);
});
app.delete('/api/analyses/:id', (req, res) => {
  const st = req.store;
  const i = st.analyses.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Analysis not found' });
  const [gone] = st.analyses.splice(i, 1);
  [...gone.images.before, ...gone.images.after].forEach((f) => deleteImageFile(st, f));
  st.saveAnalyses();
  res.json({ ok: true });
});

app.delete('/api/trades/:id', (req, res) => {
  const st = req.store;
  const trades = st.trades;
  const i = trades.findIndex((t) => t.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Trade not found' });
  const [gone] = trades.splice(i, 1);
  [...gone.images.before, ...gone.images.after].forEach((f) => deleteImageFile(st, f));
  st.saveTrades();
  res.json({ ok: true });
});

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

app.post('/api/images', express.raw({ type: 'image/*', limit: '40mb' }), (req, res) => {
  const st = req.store;
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
  const ext = EXT[mime];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'This file is not a PNG, JPG, WEBP or GIF image' });
  }
  const kind = req.query.kind === 'after' ? 'after' : 'before';
  const sym = String(req.query.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'TRADE';
  const day = String(req.query.date || '').slice(0, 10).replace(/[^0-9-]/g, '') || new Date().toISOString().slice(0, 10);
  const name = `${day}_${sym}_${kind}_${crypto.randomBytes(3).toString('hex')}.${ext}`;
  try {
    fs.mkdirSync(st.imgDir, { recursive: true });
    fs.writeFileSync(path.join(st.imgDir, name), req.body);
  } catch (e) {
    return res.status(500).json({ error: 'Could not save the image: ' + e.message });
  }
  res.json({ file: name });
});

// Only removes images that no saved trade uses (for pasted images the user cancelled).
app.delete('/api/images/:file', (req, res) => {
  const st = req.store;
  const name = safeFile(req.params.file);
  if (!name || name !== req.params.file || !OWN_FILE.test(name)) return res.status(400).json({ error: 'Bad file name' });
  if (allReferencedFiles(st).has(name)) return res.status(409).json({ error: 'Image is used by a saved trade' });
  deleteImageFile(st, name);
  res.json({ ok: true });
});

app.get('/api/export', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="trading-journal-backup.json"');
  res.json({ exportedAt: new Date().toISOString(), settings: req.store.settings, trades: req.store.trades, analyses: req.store.analyses });
});

app.use('/images', (req, res, next) => {
  const st = req.store;
  if (!imageStatics.has(st.uid)) {
    imageStatics.set(
      st.uid,
      express.static(st.imgDir, { maxAge: '7d', immutable: true, setHeaders: (r) => r.setHeader('Cache-Control', 'private, max-age=604800, immutable') })
    );
  }
  imageStatics.get(st.uid)(req, res, next);
});
app.use(express.static(path.join(ROOT, 'public')));

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.type === 'entity.too.large' ? 'Image is too big (limit 40 MB)' : 'Server error' });
});

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log('\n  Trading Journal is running.\n');
  console.log('  On this PC:     http://localhost:' + PORT);
  Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .forEach((n) => console.log('  On your phone:  http://' + n.address + ':' + PORT + '   (same Wi-Fi)'));
  console.log('\n  Accounts:       ' + auth.users.length + (signupSettings().allowSignup ? '  (new sign-ups allowed' + (signupSettings().inviteCode ? ', invite code required)' : ')') : '  (new sign-ups off)'));
  console.log('  Images folder:  ' + IMAGE_DIR);
  console.log('  Data folder:    ' + DATA_DIR + '\n');
});
