'use strict';

let bufferUi = { config: null, organizations: [], channels: [], selectedImages: new Set(), selectedChannelIds: new Set(), selectedVideoId: null, videos: [], busy: false };

async function viewBuffer() {
  view.innerHTML = `
    <div class="page-head">
      <div><p class="eyebrow">CONTENT WORKSPACE / 03</p><h1>Publish</h1><p class="sub">Turn a saved chart setup into a post without leaving EDGE.</p></div>
      <a class="btn" href="#/analysis">Open analysis library ↗</a>
    </div>
    <section class="buffer-connect card">
      <div class="buffer-section-head"><div><p class="buffer-kicker">01 / CONNECTION</p><h2>Connect Buffer</h2><p class="hint">Your API key stays on this journal server. It is never sent back to the browser after saving.</p></div><span id="buffer-status" class="buffer-status">Checking…</span></div>
      <div class="buffer-connect-grid">
        <label class="f">Buffer API key<input id="buffer-key" type="password" autocomplete="off" placeholder="Paste your Buffer API key"></label>
        <button class="btn gold buffer-connect-btn" id="buffer-connect-btn" type="button">Connect / verify</button>
        <label class="f">Buffer organization<select id="buffer-org" disabled><option value="">Connect first</option></select></label>
        <button class="btn buffer-org-save" id="buffer-org-save" type="button" disabled>Use organization</button>
      </div>
      <div class="buffer-media-url">
        <label class="f">Public HTTPS address of this journal<input id="buffer-public-url" type="url" placeholder="https://journal.yourdomain.co.za"></label>
        <button class="btn" id="buffer-url-save" type="button">Save media address</button>
        <p class="hint">Required for screenshots. Buffer must be able to open the image over the internet. A local address such as localhost or 192.168.x.x will not work.</p>
      </div>
      <p class="buffer-message" id="buffer-connect-message" role="status"></p>
    </section>

    <div class="buffer-workspace">
      <section class="card buffer-gallery">
        <div class="buffer-section-head"><div><p class="buffer-kicker">02 / MEDIA LIBRARY</p><h2>Screenshots &amp; videos</h2><p class="hint">Choose up to 4 saved screenshots OR one MP4/MOV video.</p></div><span class="buffer-count" id="buffer-selected-count">0 selected</span></div>
        <div class="buffer-video-uploader">
          <div class="buffer-video-header"><strong>Upload a video</strong><span>MP4 / MOV · up to 200 MB</span></div>
          <div class="buffer-video-actions"><input id="buffer-video-file" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" aria-label="Choose a video"><button class="btn" id="buffer-video-upload" type="button">Upload video</button></div>
          <p class="hint" id="buffer-video-upload-status" aria-live="polite">Videos are stored privately on your journal server until you share them in a post.</p>
          <div id="buffer-video-list" class="buffer-video-list"><p class="hint">Loading videos…</p></div>
          <video id="buffer-video-preview" class="buffer-video-preview" controls preload="metadata" hidden aria-label="Preview selected video"></video>
        </div>
        <div class="buffer-library-title">Saved chart screenshots <span id="buffer-image-count-note">Pick up to four</span></div>
        <div class="buffer-source-tabs"><button type="button" class="btn small on" data-buffer-source="all">All screenshots</button><button type="button" class="btn small" data-buffer-source="analysis">Analysis</button><button type="button" class="btn small" data-buffer-source="trades">Trade journal</button></div>
        <div id="buffer-gallery-items" class="buffer-gallery-items"><div class="buffer-empty">Loading your screenshots…</div></div>
      </section>
      <section class="card buffer-composer">
        <div class="buffer-section-head"><div><p class="buffer-kicker">03 / COMPOSE</p><h2>Write your post</h2><p class="hint">Review the caption and destination before sending it to Buffer.</p></div></div>
        <label class="f">Post text<textarea id="buffer-post-text" rows="8" maxlength="5000" placeholder="Describe the setup, timeframe, what you noticed, and what you are watching. Avoid presenting uncertain outcomes as guaranteed."></textarea></label>
        <div class="buffer-charcount"><span>Post caption</span><span id="buffer-char-count">0 / 5000</span></div>
        <div class="buffer-destinations">
          <div class="buffer-destinations-header"><div><span class="buffer-field-label">Publish to</span><p class="hint">Choose all connected channels or select them individually.</p></div><span id="buffer-channel-count" class="buffer-count">0 channels</span></div>
          <label class="buffer-all-toggle"><input type="checkbox" id="buffer-all-channels" checked> All connected channels</label>
          <div id="buffer-channel-list" class="buffer-channel-list" role="group" aria-label="Social channels"><p class="hint">Connect Buffer and choose your organization first.</p></div>
        </div>
        <div class="buffer-format-settings" id="buffer-format-settings">
          <div class="buffer-field-label">Platform post options</div>
          <p class="hint">Choose what each platform should publish. These settings apply to all selected accounts of that platform.</p>
          <div id="buffer-facebook-settings" class="buffer-platform-group" hidden>
            <label class="f">Facebook format<select id="buffer-facebook-type"><option value="post">Feed post (text, photo or video)</option><option value="story">Story (photo or video)</option><option value="reel">Reel (video required)</option></select></label>
          </div>
          <div id="buffer-instagram-settings" class="buffer-platform-group" hidden>
            <label class="f">Instagram format<select id="buffer-instagram-type"><option value="post">Feed post</option><option value="story">Story</option><option value="reel">Reel (video required)</option></select></label>
            <label class="buffer-inline-check"><input id="buffer-instagram-feed" type="checkbox" checked> Show on Instagram feed (when supported)</label>
          </div>
          <div id="buffer-youtube-settings" class="buffer-platform-group" hidden>
            <label class="f">YouTube video title<input id="buffer-youtube-title" maxlength="100" placeholder="Your video title"></label>
            <label class="f">YouTube category<select id="buffer-youtube-category">
              <option value="27">Education</option><option value="28">Science &amp; Technology</option><option value="22">People &amp; Blogs</option><option value="26">Howto &amp; Style</option><option value="24">Entertainment</option><option value="25">News &amp; Politics</option><option value="20">Gaming</option><option value="10">Music</option><option value="17">Sports</option><option value="19">Travel &amp; Events</option><option value="23">Comedy</option><option value="1">Film &amp; Animation</option><option value="2">Autos &amp; Vehicles</option><option value="15">Pets &amp; Animals</option><option value="29">Nonprofits &amp; Activism</option>
            </select></label>
            <p class="hint">YouTube requires a video, title and category. Screenshots alone cannot be published to YouTube.</p>
          </div>
        </div>
        <label class="f">Action<select id="buffer-mode"><option value="schedule">Schedule for a specific time</option><option value="queue">Add to Buffer queue</option><option value="draft">Save as draft in Buffer</option></select></label>
        <div id="buffer-schedule-panel" class="buffer-schedule-panel">
          <label class="f">Scheduled publication date and time<input id="buffer-scheduled-at" type="datetime-local" step="60"></label>
          <p class="hint">Time is entered in your browser's local timezone (<span id="buffer-timezone"></span>). Every selected channel receives the same scheduled UTC timestamp.</p>
        </div>
        <p class="buffer-prerequisites" id="buffer-prerequisites" aria-live="polite"></p>
        <button class="btn gold buffer-publish-btn" id="buffer-publish-btn" type="button"><span>↗</span> Schedule with Buffer</button>
        <p class="buffer-message" id="buffer-publish-message" role="status" aria-live="polite"></p>
        <div id="buffer-publish-results" class="buffer-publish-results" aria-live="polite"></div>
        <p class="buffer-footnote">Buffer will attempt delivery at the chosen time on each channel. Actual publication can vary due to social-platform delays, permission requirements or channel-specific media rules. Queue mode follows each channel's own schedule.</p>
      </section>
    </div>`;

  bufferUi = { config: null, organizations: [], channels: [], selectedImages: new Set(), selectedChannelIds: new Set(), busy: false, source: 'all', items: [], selectedVideoId: null, videos: [] };
  $('#buffer-connect-btn').onclick = bufferConnect;
  $('#buffer-org-save').onclick = bufferSaveOrganization;
  $('#buffer-url-save').onclick = bufferSavePublicUrl;
  $('#buffer-publish-btn').onclick = bufferPublish;
  $('#buffer-video-upload').onclick = bufferUploadVideo;
  ['buffer-facebook-type', 'buffer-instagram-type', 'buffer-instagram-feed', 'buffer-youtube-title', 'buffer-youtube-category'].forEach((id) => {
    $('#' + id).addEventListener('change', bufferUpdatePublishButton);
    $('#' + id).addEventListener('input', bufferUpdatePublishButton);
  });
  $('#buffer-mode').onchange = bufferUpdatePublishButton;
  $('#buffer-scheduled-at').oninput = bufferUpdatePublishButton;
  $('#buffer-all-channels').onchange = (event) => {
    const channels = bufferUsableChannels();
    bufferUi.selectedChannelIds = event.target.checked ? new Set(channels.map((c) => c.id)) : new Set();
    bufferPaintChannels();
    bufferUpdatePublishButton();
  };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  $('#buffer-timezone').textContent = tz;
  const initialTime = new Date(Date.now() + 60 * 60 * 1000);
  initialTime.setSeconds(0, 0);
  $('#buffer-scheduled-at').value = localInput(initialTime);
  $('#buffer-post-text').addEventListener('input', () => {
    $('#buffer-char-count').textContent = `${$('#buffer-post-text').value.length} / 5000`;
    bufferUpdatePublishButton();
  });
  $$('.buffer-source-tabs [data-buffer-source]').forEach((b) => b.onclick = () => {
    bufferUi.source = b.dataset.bufferSource;
    $$('.buffer-source-tabs [data-buffer-source]').forEach((x) => x.classList.toggle('on', x === b));
    bufferPaintGallery();
  });

  try {
    bufferUi.config = await api('/buffer/config');
    $('#buffer-public-url').value = bufferUi.config.publicBaseUrl || '';
    $('#buffer-status').textContent = bufferUi.config.connected ? 'Key saved' : 'Not connected';
    $('#buffer-status').classList.toggle('ready', bufferUi.config.connected);
    if (bufferUi.config.connected) {
      $('#buffer-key').placeholder = 'API key saved — paste a new key to replace it';
      await bufferLoadOrganizations();
      if (bufferUi.config.organizationId) {
        $('#buffer-org').value = bufferUi.config.organizationId;
        await bufferLoadChannels();
      }
    }
  } catch (e) {
    $('#buffer-connect-message').textContent = e.message;
  }
  await Promise.all([bufferLoadImages(), bufferLoadVideos()]);
  bufferUpdatePublishButton();
}

async function bufferConnect() {
  const btn = $('#buffer-connect-btn');
  const message = $('#buffer-connect-message');
  btn.disabled = true; btn.textContent = 'Checking…'; message.textContent = '';
  try {
    const result = await api('/buffer/connect', 'POST', { apiKey: $('#buffer-key').value.trim() });
    bufferUi.organizations = result.organizations || [];
    bufferUi.config = Object.assign({}, bufferUi.config || {}, { connected: true });
    $('#buffer-status').textContent = 'Connected'; $('#buffer-status').classList.add('ready');
    $('#buffer-key').value = ''; $('#buffer-key').placeholder = 'API key saved — paste a new key to replace it';
    bufferPaintOrganizations();
    bufferUpdatePublishButton();
    message.textContent = bufferUi.organizations.length ? 'Connection verified. Choose your organization below.' : 'Connected, but no Buffer organizations were returned.';
  } catch (e) { message.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Connect / verify'; }
}

async function bufferLoadOrganizations() {
  if (!bufferUi.organizations.length) {
    try {
      const result = await api('/buffer/organizations');
      bufferUi.organizations = result.organizations || [];
    } catch (e) {
      $('#buffer-org').innerHTML = '<option value="">Click “Connect / verify” to load organizations</option>';
      $('#buffer-org').disabled = true;
      $('#buffer-org-save').disabled = true;
      return;
    }
  }
  bufferPaintOrganizations();
}

function bufferPaintOrganizations() {
  const select = $('#buffer-org');
  select.innerHTML = '<option value="">Choose organization</option>' + bufferUi.organizations.map((o) => `<option value="${esc(o.id)}">${esc(o.name || o.id)}</option>`).join('');
  select.disabled = false; $('#buffer-org-save').disabled = false;
}

async function bufferSaveOrganization() {
  const id = $('#buffer-org').value;
  if (!id) return ($('#buffer-connect-message').textContent = 'Choose an organization first.');
  const btn = $('#buffer-org-save'); btn.disabled = true;
  try {
    await api('/buffer/organization', 'POST', { organizationId: id });
    bufferUi.config.organizationId = id;
    await bufferLoadChannels();
    $('#buffer-connect-message').textContent = 'Organization saved. Your channels are ready.';
  } catch (e) { $('#buffer-connect-message').textContent = e.message; }
  finally { btn.disabled = false; }
}

function bufferSelectedServices() {
  return new Set(bufferUsableChannels().filter((c) => bufferUi.selectedChannelIds.has(c.id)).map((c) => String(c.service || '').toLowerCase()));
}
function bufferPaintPlatformOptions() {
  const services = bufferSelectedServices();
  $('#buffer-facebook-settings').hidden = !services.has('facebook');
  $('#buffer-instagram-settings').hidden = !services.has('instagram');
  $('#buffer-youtube-settings').hidden = !services.has('youtube');
}
function bufferUsableChannels() {
  return bufferUi.channels.filter((c) => c && c.id && !c.isDisconnected && !c.isLocked);
}

function bufferPaintChannels() {
  const list = $('#buffer-channel-list');
  if (!list) return;
  const usable = bufferUsableChannels();
  list.innerHTML = usable.length ? usable.map((c) => `
    <label class="buffer-channel-choice">
      <input type="checkbox" data-channel-id="${esc(c.id)}" ${bufferUi.selectedChannelIds.has(c.id) ? 'checked' : ''}>
      <span><strong>${esc(c.displayName || c.name || c.service || 'Social account')}</strong><small>${esc(c.service || 'Connected channel')}</small></span>
    </label>`).join('') : '<p class="hint">No available channels found. Verify your organization and channel connections in Buffer.</p>';
  list.querySelectorAll('[data-channel-id]').forEach((input) => input.addEventListener('change', () => {
    if (input.checked) bufferUi.selectedChannelIds.add(input.dataset.channelId);
    else bufferUi.selectedChannelIds.delete(input.dataset.channelId);
    bufferPaintChannels();
    bufferUpdatePublishButton();
  }));
  const all = $('#buffer-all-channels');
  all.disabled = usable.length === 0;
  all.checked = !!usable.length && usable.every((c) => bufferUi.selectedChannelIds.has(c.id));
  all.indeterminate = !all.checked && bufferUi.selectedChannelIds.size > 0;
  $('#buffer-channel-count').textContent = `${bufferUi.selectedChannelIds.size} of ${usable.length} selected`;
  bufferPaintPlatformOptions();
}

async function bufferLoadChannels() {
  $('#buffer-channel-list').innerHTML = '<p class="hint">Loading channels…</p>';
  try {
    const result = await api('/buffer/channels');
    bufferUi.channels = result.channels || [];
    // Start with every available social channel selected. Never include locked/disconnected ones.
    bufferUi.selectedChannelIds = new Set(bufferUsableChannels().map((c) => c.id));
  } catch (e) {
    bufferUi.channels = [];
    bufferUi.selectedChannelIds.clear();
    $('#buffer-connect-message').textContent = e.message;
  }
  bufferPaintChannels();
  bufferUpdatePublishButton();
}

async function bufferSavePublicUrl() {
  const value = $('#buffer-public-url').value.trim();
  try {
    const result = await api('/buffer/public-url', 'POST', { publicBaseUrl: value });
    $('#buffer-public-url').value = result.publicBaseUrl;
    bufferUi.config.publicBaseUrl = result.publicBaseUrl;
    $('#buffer-connect-message').textContent = 'Public media address saved.';
    bufferUpdatePublishButton();
  } catch (e) { $('#buffer-connect-message').textContent = e.message; }
}

async function bufferLoadImages() {
  const gallery = $('#buffer-gallery-items');
  try {
    const [trades, analyses] = await Promise.all([api('/trades'), api('/analyses')]);
    const items = [];
    (analyses || []).forEach((a) => {
      ['before', 'after'].forEach((kind) => (a.images?.[kind] || []).forEach((file) => items.push({ file, source: 'analysis', title: a.title || a.symbol || 'Chart analysis', symbol: a.symbol || '', date: a.date || '', kind, timeframe: a.timeframe || '', bias: a.bias || '' })));
    });
    (trades || []).forEach((t) => {
      ['before', 'after'].forEach((kind) => (t.images?.[kind] || []).forEach((file) => items.push({ file, source: 'trades', title: `${t.symbol || 'Trade'} · ${t.side || ''}`, symbol: t.symbol || '', date: (t.openedAt || '').slice(0, 10), kind, timeframe: '', bias: '' })));
    });
    const seen = new Set();
    bufferUi.items = items.filter((x) => { if (seen.has(x.file)) return false; seen.add(x.file); return true; }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    bufferPaintGallery();
  } catch (e) { gallery.innerHTML = `<div class="buffer-empty">Could not load screenshots: ${esc(e.message)}</div>`; }
}

function bufferPaintGallery() {
  const gallery = $('#buffer-gallery-items');
  if (!gallery) return;
  const items = bufferUi.items.filter((x) => bufferUi.source === 'all' || x.source === bufferUi.source);
  if (!items.length) { gallery.innerHTML = '<div class="buffer-empty">No screenshots found here yet. Save chart screenshots in Analysis or the Trade Journal first.</div>'; return; }
  gallery.innerHTML = items.map((x) => {
    const selected = bufferUi.selectedImages.has(x.file);
    return `<button type="button" class="buffer-image-choice ${selected ? 'selected' : ''}" data-buffer-file="${esc(x.file)}" aria-pressed="${selected}">
      <span class="buffer-image-thumb"><img src="${imgUrl(x.file)}" alt="" loading="lazy"><span class="buffer-check">${selected ? '✓' : '+'}</span></span>
      <span class="buffer-image-title">${esc(x.title)}</span><span class="buffer-image-meta">${esc(x.kind)}${x.timeframe ? ` · ${esc(x.timeframe)}` : ''}${x.bias ? ` · ${esc(x.bias)}` : ''}</span>
    </button>`;
  }).join('');
  gallery.onclick = (e) => {
    const btn = e.target.closest('[data-buffer-file]'); if (!btn) return;
    const file = btn.dataset.bufferFile;
    if (bufferUi.selectedImages.has(file)) bufferUi.selectedImages.delete(file);
    else if (bufferUi.selectedImages.size >= 4) return toast('Choose up to 4 screenshots.', true);
    else { bufferUi.selectedImages.add(file); bufferUi.selectedVideoId = null; bufferPaintVideos(); }
    bufferPaintGallery(); bufferUpdatePublishButton();
  };
  $('#buffer-selected-count').textContent = bufferUi.selectedVideoId ? '1 video selected' : `${bufferUi.selectedImages.size} screenshot(s)`;
}

function bufferPaintVideos() {
  const container = $('#buffer-video-list');
  if (!container) return;
  container.innerHTML = bufferUi.videos.length ? bufferUi.videos.map((v) => `
    <div class="buffer-video-item ${bufferUi.selectedVideoId === v.id ? 'selected' : ''}">
      <button type="button" class="buffer-video-select" data-video-select="${esc(v.id)}" aria-pressed="${bufferUi.selectedVideoId === v.id}">
        <span class="buffer-video-icon">▶</span><span class="buffer-video-details"><strong>${esc(v.name)}</strong><small>${(v.size / 1024 / 1024).toFixed(1)} MB · ${bufferUi.selectedVideoId === v.id ? 'Selected' : 'Click to select'}</small></span>
      </button>
      <button type="button" class="buffer-video-remove" data-video-remove="${esc(v.id)}" aria-label="Delete ${esc(v.name)}" title="Delete video">×</button>
    </div>`).join('') : '<p class="hint">No uploaded videos yet. Choose a file above and upload it.</p>';
  container.querySelectorAll('[data-video-select]').forEach((button) => button.onclick = () => {
    bufferUi.selectedVideoId = bufferUi.selectedVideoId === button.dataset.videoSelect ? null : button.dataset.videoSelect;
    if (bufferUi.selectedVideoId) {
      bufferUi.selectedImages.clear();
      if ($('#buffer-instagram-type').value === 'post') $('#buffer-instagram-type').value = 'reel';
    }
    bufferPaintVideos(); bufferPaintGallery(); bufferUpdatePublishButton();
  });
  container.querySelectorAll('[data-video-remove]').forEach((button) => button.onclick = async () => {
    if (!confirm('Delete this uploaded video? Any scheduled Buffer post using it may fail when it publishes.')) return;
    try {
      await api('/buffer/videos/' + encodeURIComponent(button.dataset.videoRemove), 'DELETE');
      if (bufferUi.selectedVideoId === button.dataset.videoRemove) bufferUi.selectedVideoId = null;
      await bufferLoadVideos(); bufferUpdatePublishButton();
    } catch (e) { $('#buffer-video-upload-status').textContent = e.message; }
  });
  const player = $('#buffer-video-preview');
  if (player) {
    const source = bufferUi.selectedVideoId ? '/api/buffer/videos/' + encodeURIComponent(bufferUi.selectedVideoId) + '/file' : '';
    if (player.getAttribute('src') !== source) { player.pause(); player.setAttribute('src', source); if (!source) player.removeAttribute('src'); }
    player.hidden = !bufferUi.selectedVideoId;
  }
  const badge = $('#buffer-selected-count');
  if (badge) badge.textContent = bufferUi.selectedVideoId ? '1 video selected' : `${bufferUi.selectedImages.size} screenshot(s)`;
}
async function bufferLoadVideos() {
  try {
    const result = await api('/buffer/videos');
    bufferUi.videos = result.videos || [];
    if (bufferUi.selectedVideoId && !bufferUi.videos.some((v) => v.id === bufferUi.selectedVideoId)) bufferUi.selectedVideoId = null;
    bufferPaintVideos();
  } catch (e) { $('#buffer-video-list').textContent = 'Could not load videos: ' + e.message; }
}
async function bufferUploadVideo() {
  const file = $('#buffer-video-file').files?.[0];
  const status = $('#buffer-video-upload-status');
  if (!file) return (status.textContent = 'Choose an MP4 or MOV video first.');
  if (!/\.(mp4|mov)$/i.test(file.name)) return (status.textContent = 'Only MP4 or MOV videos are supported.');
  if (file.size > 200 * 1024 * 1024) return (status.textContent = 'File is over the 200 MB limit.');
  const button = $('#buffer-video-upload');
  button.disabled = true;
  status.textContent = 'Uploading video… keep this page open.';
  try {
    const response = await fetch('/api/buffer/videos', { method: 'POST', body: file, headers: { 'Content-Type': file.type || (file.name.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4'), 'X-Video-Name': encodeURIComponent(file.name) }, credentials: 'same-origin' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`);
    bufferUi.selectedVideoId = result.video.id;
    bufferUi.selectedImages.clear();
    if ($('#buffer-instagram-type').value === 'post') $('#buffer-instagram-type').value = 'reel';
    await bufferLoadVideos(); bufferPaintGallery(); bufferUpdatePublishButton();
    $('#buffer-video-file').value = '';
    status.textContent = 'Video uploaded and selected. Choose post formats, then schedule or queue it.';
  } catch (e) { status.textContent = e.message; }
  finally { button.disabled = false; }
}

function bufferUpdatePublishButton() {
  const btn = $('#buffer-publish-btn');
  if (!btn) return;
  const mode = $('#buffer-mode').value;
  const isSchedule = mode === 'schedule';
  $('#buffer-schedule-panel').hidden = !isSchedule;
  btn.disabled = bufferUi.busy; // Always let users click to see the exact missing prerequisite.
  btn.textContent = bufferUi.busy ? 'Sending to Buffer…' : mode === 'schedule' ? '↗ Schedule with Buffer' : mode === 'draft' ? '↗ Save draft to Buffer' : '↗ Add to Buffer queue';
  const notes = [];
  if (!bufferUi.config?.connected) notes.push('Connect your Buffer API key');
  if (!bufferUi.config?.organizationId) notes.push('choose an organization');
  if (!bufferUi.selectedChannelIds.size) notes.push('select at least one social channel');
  if (!$('#buffer-post-text').value.trim() && !bufferUi.selectedImages.size && !bufferUi.selectedVideoId) notes.push('write a caption or choose screenshots/video');
  if ((bufferUi.selectedImages.size || bufferUi.selectedVideoId) && !bufferUi.config?.publicBaseUrl) notes.push('save your public HTTPS media address for images/videos');
  const services = bufferSelectedServices();
  const hasVideo = !!bufferUi.selectedVideoId;
  const hasImages = bufferUi.selectedImages.size > 0;
  if (services.has('youtube')) {
    if (!hasVideo) notes.push('YouTube requires a video (deselect YouTube for screenshot-only posts)');
    if (!$('#buffer-youtube-title').value.trim()) notes.push('add a YouTube title');
  }
  if (services.has('facebook')) {
    if ($('#buffer-facebook-type').value === 'reel' && !hasVideo) notes.push('Facebook Reel requires a video');
    if ($('#buffer-facebook-type').value === 'story' && !hasImages && !hasVideo) notes.push('Facebook Story requires a photo/video');
  }
  if (services.has('instagram')) {
    if (!hasVideo && !hasImages) notes.push('Instagram requires a photo/video');
    if ($('#buffer-instagram-type').value === 'reel' && !hasVideo) notes.push('Instagram Reel requires a video');
  }
  if (isSchedule) {
    const localTime = $('#buffer-scheduled-at').value;
    if (!localTime || !Number.isFinite(new Date(localTime).getTime()) || new Date(localTime).getTime() <= Date.now() + 30_000) {
      notes.push('choose a future scheduled date/time');
    }
  }
  $('#buffer-prerequisites').textContent = notes.length ? `To continue: ${notes.join('; ')}.` : `Ready to ${mode === 'schedule' ? 'schedule' : mode === 'draft' ? 'save a draft for' : 'queue on'} ${bufferUi.selectedChannelIds.size} channel(s).`;
  $('#buffer-prerequisites').classList.toggle('ready', notes.length === 0);
}

function bufferRenderResults(result) {
  const node = $('#buffer-publish-results');
  node.innerHTML = (result.results || []).map((r) => {
    const caption = r.channelName || r.channelId || 'Channel';
    const status = r.ok ? (result.mode === 'draft' ? 'Draft created' : result.mode === 'schedule' ? `Scheduled${r.post?.dueAt ? ` for ${fmtDateTime(r.post.dueAt)}` : ''}` : 'Added to queue') : `Failed: ${r.error || 'Unknown error'}`;
    return `<div class="buffer-result-line ${r.ok ? 'succeeded' : 'failed'}"><span>${r.ok ? '✓' : '!'}</span><strong>${esc(caption)}</strong><span>${esc(status)}</span></div>`;
  }).join('');
}

async function bufferPublish() {
  if (bufferUi.busy) return;
  const message = $('#buffer-publish-message');
  const mode = $('#buffer-mode').value;
  const channelIds = [...bufferUi.selectedChannelIds];
  const text = $('#buffer-post-text').value.trim();
  const imageFiles = [...bufferUi.selectedImages];
  const videoId = bufferUi.selectedVideoId;
  const scheduledLocal = $('#buffer-scheduled-at').value;
  const dueDate = new Date(scheduledLocal);
  message.textContent = '';
  $('#buffer-publish-results').innerHTML = '';
  if (!bufferUi.config?.connected) return (message.textContent = 'Connect or verify your Buffer API key first.');
  if (!bufferUi.config?.organizationId) return (message.textContent = 'Choose your Buffer organization first.');
  if (!channelIds.length) return (message.textContent = 'Select at least one connected social media channel.');
  if (!text && !imageFiles.length && !videoId) return (message.textContent = 'Write a caption or choose screenshots/video.');
  if ((imageFiles.length || videoId) && !bufferUi.config?.publicBaseUrl) return (message.textContent = 'Save the public HTTPS journal address before sending images or videos.');
  if (mode === 'schedule' && (!scheduledLocal || !Number.isFinite(dueDate.getTime()) || dueDate.getTime() <= Date.now() + 30_000)) {
    return (message.textContent = 'Select a valid future date and time for scheduled posts.');
  }
  const scheduledText = mode === 'schedule' ? ` at ${fmtDateTime(dueDate.toISOString())}` : '';
  const action = mode === 'draft' ? 'save drafts' : mode === 'queue' ? 'queue posts' : 'schedule posts';
  if (!confirm(`Send ${channelIds.length} post(s) to Buffer to ${action}${scheduledText}? Each channel will receive its own post.`)) return;
  bufferUi.busy = true;
  bufferUpdatePublishButton();
  message.textContent = `Sending to ${channelIds.length} channel(s)…`;
  try {
    const result = await api('/buffer/publish', 'POST', {
      channelIds, text, mode, imageFiles, videoId,
      facebookType: $('#buffer-facebook-type').value,
      instagramType: $('#buffer-instagram-type').value,
      instagramShareToFeed: $('#buffer-instagram-feed').checked,
      youtubeTitle: $('#buffer-youtube-title').value.trim(),
      youtubeCategory: $('#buffer-youtube-category').value,
      ...(mode === 'schedule' ? { dueAt: dueDate.toISOString() } : {}),
    });
    bufferRenderResults(result);
    message.textContent = `${result.successCount} successful · ${result.failureCount} failed. ${result.failureCount ? 'Review the failed channels below before retrying, to avoid duplicate posts on successful channels.' : 'All requested posts were accepted by Buffer.'}`;
    if (result.failureCount) toast('Some Buffer channels failed — see results', true);
    else toast(mode === 'draft' ? 'Buffer drafts created' : 'Posts sent to Buffer');
    if (!result.failureCount) { bufferUi.selectedImages.clear(); bufferUi.selectedVideoId = null; bufferPaintGallery(); bufferPaintVideos(); }
  } catch (e) {
    message.textContent = e.message;
    toast('Buffer request failed', true);
  } finally {
    bufferUi.busy = false;
    bufferUpdatePublishButton();
  }
}
