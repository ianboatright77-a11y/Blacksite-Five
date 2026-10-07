'use strict';

if (typeof window !== 'undefined') window.__BLACKSITE_READY__ = true;

const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const SESSION_KEY = 'blacksite-five-session';
const LANDING_DRAFT_KEY = 'blacksite-five-landing-draft';
const MUSIC_KEY = 'blacksite-five-music';
const TECH_PORTRAITS = {
  hologram: 'hologram',
  uav: 'uav',
  minefield: 'minefield',
  napalm: 'napalm',
  cyberkinetics: 'body-enhancers',
  teleporter: 'teleporter',
  radio_hacker: 'signal-interceptor',
  air_raid: 'air-raid'
};

const MUSIC_BAR_SECONDS = 5.6;
const MYSTERY_BARS = [
  { root: 55.00, notes: [[1.35, 1.20], [3.85, 1.50]], drums: [0, 5] },
  { root: 58.27, notes: [[0.70, 1.50], [2.80, 1.26], [4.90, 1.20]], drums: [0, 3, 7], snare: [6] },
  { root: 51.91, notes: [[2.10, 1.20], [4.20, 1.41]], drums: [0, 6] },
  { root: 61.74, notes: [[0.70, 1.19], [2.10, 1.50], [4.20, 1.78]], drums: [0, 4], horn: [3.45, 1.50] },
  { root: 55.00, notes: [[1.40, 1.41], [3.50, 1.20]], drums: [0, 2, 7] },
  { root: 65.41, notes: [[0.70, 1.12], [2.80, 1.50], [4.90, 1.26]], drums: [0, 5], snare: [3] },
  { root: 49.00, notes: [[2.10, 1.50], [4.20, 1.19]], drums: [0, 6] },
  { root: 58.27, notes: [[0.70, 1.26], [2.10, 1.50], [3.50, 1.78]], drums: [0, 4, 7], horn: [4.15, 1.20] },
  { root: 51.91, notes: [[1.40, 1.20], [4.20, 1.50]], drums: [0, 3] },
  { root: 46.25, notes: [[0.70, 1.50], [2.80, 1.19], [4.90, 1.41]], drums: [0, 5, 7], snare: [6] },
  { root: 61.74, notes: [[2.10, 1.26], [3.50, 1.50]], drums: [0, 4] },
  { root: 55.00, notes: [[0.70, 1.20], [2.80, 1.50], [4.20, 2.00]], drums: [0, 2, 6], horn: [3.50, 1.00] }
];

let session = readSession();
let landingDraft = readLandingDraft();
let state = null;
let serverConfig = { mode: 'unknown', publicUrl: null, lanUrls: [] };
let eventSource = null;
let presenceTimer = null;
let streamErrorTimer = null;
let busy = false;
let lastPhaseKey = '';
let toastTimer = null;
let transitionTimer = null;
let lastTransitionDay = null;
let musicEnabled = readMusicPreference();
let audioContext = null;
let musicMaster = null;
let musicTimer = null;
let musicStarting = false;
let musicBar = 0;
let noiseBuffer = null;

const draft = {
  setupSites: [],
  setupAssignments: {},
  mulliganIds: [],
  orderType: 'attack',
  siteId: null,
  ownSiteId: null,
  troopIds: [],
  techId: null,
  fromSiteId: null,
  toSiteId: null
};

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}

function readMusicPreference() {
  try { return typeof localStorage === 'undefined' || localStorage.getItem(MUSIC_KEY) !== 'off'; }
  catch { return true; }
}

function saveMusicPreference() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(MUSIC_KEY, musicEnabled ? 'on' : 'off');
  } catch { /* preference storage is optional */ }
}

function scheduleTone(time, frequency, duration, volume, type = 'triangle') {
  if (!audioContext || !musicMaster) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(volume, time + 0.035);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  oscillator.connect(gain).connect(musicMaster);
  oscillator.start(time);
  oscillator.stop(time + duration + 0.06);
}

function scheduleDrum(time, accent = false) {
  if (!audioContext || !musicMaster) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(accent ? 118 : 88, time);
  oscillator.frequency.exponentialRampToValueAtTime(accent ? 40 : 46, time + 0.24);
  gain.gain.setValueAtTime(accent ? 0.2 : 0.12, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
  oscillator.connect(gain).connect(musicMaster);
  oscillator.start(time);
  oscillator.stop(time + 0.32);

  if (noiseBuffer) {
    const impact = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const impactGain = audioContext.createGain();
    impact.buffer = noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.value = accent ? 310 : 230;
    impactGain.gain.setValueAtTime(accent ? 0.055 : 0.03, time);
    impactGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
    impact.connect(filter).connect(impactGain).connect(musicMaster);
    impact.start(time);
    impact.stop(time + 0.13);
  }
}

function scheduleSnare(time) {
  if (!audioContext || !musicMaster || !noiseBuffer) return;
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  source.buffer = noiseBuffer;
  filter.type = 'bandpass';
  filter.frequency.value = 1350;
  gain.gain.setValueAtTime(0.1, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  source.connect(filter).connect(gain).connect(musicMaster);
  source.start(time);
  source.stop(time + 0.2);
}

function scheduleBrass(time, frequency, duration, volume = 0.04) {
  if (!audioContext || !musicMaster) return;
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(760, time);
  filter.frequency.linearRampToValueAtTime(1120, time + Math.min(0.28, duration / 2));
  filter.Q.value = 1.4;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(volume, time + 0.1);
  gain.gain.setValueAtTime(volume, time + Math.max(0.12, duration - 0.18));
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  filter.connect(gain).connect(musicMaster);
  for (const detune of [-7, 7]) {
    const horn = audioContext.createOscillator();
    horn.type = 'sawtooth';
    horn.frequency.value = frequency;
    horn.detune.value = detune;
    horn.connect(filter);
    horn.start(time);
    horn.stop(time + duration + 0.03);
  }
}

function scheduleAtmosphere(time, duration, frequency, volume = 0.009) {
  if (!audioContext || !musicMaster || !noiseBuffer) return;
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  source.buffer = noiseBuffer;
  source.loop = true;
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  filter.Q.value = 0.7;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(volume, time + 0.8);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  source.connect(filter).connect(gain).connect(musicMaster);
  source.start(time);
  source.stop(time + duration + 0.03);
}

function scheduleMusicBar() {
  if (!audioContext || audioContext.state !== 'running') return;
  const bar = MYSTERY_BARS[musicBar % MYSTERY_BARS.length];
  const root = bar.root;
  const start = audioContext.currentTime + 0.06;
  scheduleTone(start, root, MUSIC_BAR_SECONDS - 0.12, 0.026, 'sine');
  scheduleTone(start + 0.05, root * 1.5, MUSIC_BAR_SECONDS - 0.24, 0.011, 'triangle');
  scheduleAtmosphere(start, MUSIC_BAR_SECONDS - 0.08, 320 + (musicBar % 4) * 75);
  for (const [offset, interval] of bar.notes) {
    scheduleTone(start + offset, root * interval * 2, 0.72, 0.018, 'sine');
    scheduleTone(start + offset + 0.04, root * interval, 1.05, 0.01, 'triangle');
  }
  for (const beat of bar.drums) scheduleDrum(start + beat * 0.7, beat === 0);
  for (const beat of bar.snare || []) scheduleSnare(start + beat * 0.7);
  if (bar.horn) scheduleBrass(start + bar.horn[0], root * bar.horn[1], 0.68, 0.022);
  musicBar += 1;
}

function startMusic() {
  if (!musicEnabled || typeof window === 'undefined') return;
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) return;
  if (!audioContext) {
    audioContext = new AudioEngine();
    musicMaster = audioContext.createGain();
    musicMaster.gain.value = 0.52;
    musicMaster.connect(audioContext.destination);
    noiseBuffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * 0.16), audioContext.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) noise[index] = Math.random() * 2 - 1;
  }
  if (musicTimer || musicStarting) return;
  musicStarting = true;
  Promise.resolve(audioContext.resume()).then(() => {
    musicStarting = false;
    if (!musicEnabled || musicTimer) return;
    scheduleMusicBar();
    musicTimer = setInterval(scheduleMusicBar, MUSIC_BAR_SECONDS * 1000);
  }).catch(() => { musicStarting = false; });
}

function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  musicStarting = false;
  if (audioContext?.state === 'running') audioContext.suspend().catch(() => {});
}

function playTransitionSting() {
  if (!musicEnabled || !audioContext || audioContext.state !== 'running') return;
  const at = audioContext.currentTime + 0.03;
  scheduleDrum(at, true);
  scheduleSnare(at + 0.3);
  scheduleBrass(at + 0.08, 110, 0.85, 0.045);
}

function readLandingDraft() {
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(LANDING_DRAFT_KEY)) || {}; } catch { /* use defaults */ }
  const invitedRoom = new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 5);
  return {
    createName: String(saved.createName || ''),
    joinName: String(saved.joinName || ''),
    joinCode: String(invitedRoom || saved.joinCode || '').toUpperCase().slice(0, 5)
  };
}

function saveLandingDraft() {
  sessionStorage.setItem(LANDING_DRAFT_KEY, JSON.stringify(landingDraft));
}

function saveSession(value) {
  session = value;
  if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else sessionStorage.removeItem(SESSION_KEY);
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = `toast show${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3200);
}

function setFormStatus(id, message, tone = '') {
  const element = document.querySelector(`#${id}`);
  if (!element) return;
  element.textContent = message;
  element.className = `form-status${tone ? ` ${tone}` : ''}`;
}

async function request(path, body = null, includeAuth = true) {
  const payload = { ...(body || {}) };
  if (includeAuth && session) {
    payload.playerId = session.playerId;
    payload.token = session.token;
  }
  const response = await fetch(path, {
    method: body === null ? 'GET' : 'POST',
    headers: body === null ? undefined : { 'Content-Type': 'application/json' },
    body: body === null ? undefined : JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function isLoopbackOrigin() {
  try {
    const hostname = location.hostname || new URL(location.origin).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

function invitationUrls() {
  let origins;
  if (serverConfig.mode === 'hosted') {
    origins = [isLoopbackOrigin() && serverConfig.publicUrl ? serverConfig.publicUrl : location.origin];
  }
  else if (isLoopbackOrigin() && serverConfig.lanUrls.length) origins = serverConfig.lanUrls;
  else origins = [location.origin];
  return origins.map((origin) => `${String(origin).replace(/\/$/, '')}/?room=${state.room.code}`);
}

function invitationUrl() {
  return invitationUrls()[0];
}

async function loadServerConfig() {
  try {
    const result = await request('/api/health', null, false);
    serverConfig = {
      mode: result.mode || 'unknown',
      publicUrl: result.publicUrl || null,
      lanUrls: Array.isArray(result.lanUrls) ? result.lanUrls : []
    };
    if (state?.room.phase === 'lobby') render();
  } catch {
    serverConfig = { mode: 'unknown', publicUrl: null, lanUrls: [] };
  }
  return serverConfig;
}

function resetOrderDraft() {
  draft.orderType = 'attack';
  draft.siteId = null;
  draft.ownSiteId = null;
  draft.troopIds = [];
  draft.techId = null;
  draft.fromSiteId = null;
  draft.toSiteId = null;
}

function resetSetupDraft() {
  draft.setupSites = [];
  draft.setupAssignments = {};
  draft.mulliganIds = [];
}

function resetAllDrafts() {
  resetSetupDraft();
  resetOrderDraft();
}

function acceptState(next) {
  const key = `${next.room.phase}:${next.room.day}`;
  const previousPhase = state?.room.phase || lastPhaseKey.split(':')[0];
  if (next.room.phase === 'setup' && previousPhase !== 'setup') resetSetupDraft();
  if (lastPhaseKey && lastPhaseKey !== key && next.room.phase === 'planning') resetOrderDraft();
  const transitionDay = next.room.transition?.completedDay;
  if (transitionDay && transitionDay !== lastTransitionDay) {
    lastTransitionDay = transitionDay;
    playTransitionSting();
  }
  lastPhaseKey = key;
  state = next;
  render();
  updateTimer();
  clearTimeout(transitionTimer);
  if (next.room.transition?.until > Date.now()) {
    transitionTimer = setTimeout(() => {
      render();
      updateTimer();
    }, next.room.transition.until - Date.now() + 40);
  }
}

async function restore() {
  if (!session) return render();
  try {
    const query = new URLSearchParams({ playerId: session.playerId, token: session.token });
    const result = await request(`/api/rooms/${session.roomCode}/state?${query}`, null, false);
    acceptState(result.state);
    connectEvents();
  } catch (error) {
    stopPresence();
    saveSession(null);
    state = null;
    render();
    showToast(`Session expired: ${error.message}`, true);
  }
}

function connectEvents() {
  eventSource?.close();
  if (!session) return;
  const query = new URLSearchParams({ playerId: session.playerId, token: session.token });
  eventSource = new EventSource(`/api/rooms/${session.roomCode}/events?${query}`);
  eventSource.addEventListener('state', (event) => {
    clearTimeout(streamErrorTimer);
    try { acceptState(JSON.parse(event.data)); } catch { /* wait for next update */ }
  });
  eventSource.addEventListener('open', () => clearTimeout(streamErrorTimer));
  eventSource.addEventListener('error', () => {
    clearTimeout(streamErrorTimer);
    streamErrorTimer = setTimeout(() => showToast('Connection interrupted. Reconnecting…', true), 3000);
  });
  startPresence();
}

async function sendPresence() {
  if (!session) return;
  try { await request(`/api/rooms/${session.roomCode}/presence`, {}); }
  catch { /* EventSource and the next presence check will retry */ }
}

function startPresence() {
  stopPresence();
  if (!session) return;
  sendPresence();
  presenceTimer = setInterval(sendPresence, 4 * 60 * 1000);
}

function stopPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
}

function brand(compact = false) {
  return `<div class="brand-lockup"><div class="mark">V</div>${compact ? '' : '<div class="wordmark">Blacksite Five</div>'}</div>`;
}

function formatCountdown(deadline) {
  const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function mobilityLabel(mobility) {
  if (Number(mobility) >= 3) return 'Fast';
  if (Number(mobility) === 2) return 'Medium';
  return 'Slow';
}

function renderTopbar() {
  const timer = state.room.phase === 'planning'
    ? `<div class="top-stat"><span>Order lock</span><strong id="timer" class="timer">${formatCountdown(state.room.deadline)}</strong></div>`
    : '';
  return `
    <header class="topbar">
      <div class="topbar-left">
        ${brand()}
        <div class="room-pill"><span class="invitation-label">Invitation Code:</span><span class="room-code">${esc(state.room.code)}</span></div>
      </div>
      <div class="topbar-right">
        ${state.room.day ? `<div class="top-stat"><span>Day</span><strong>${state.room.day}/${state.room.maxDays}</strong></div>` : ''}
        ${timer}
        <button class="btn btn-ghost btn-small music-toggle" data-action="toggle-music" aria-pressed="${musicEnabled}">Music ${musicEnabled ? 'On' : 'Off'}</button>
        <button class="btn btn-ghost btn-small" data-action="copy-room">Invite</button>
        <button class="btn btn-ghost btn-small" data-action="leave-room">Exit</button>
      </div>
    </header>`;
}

function renderLanding() {
  app.innerHTML = `
    <section class="landing">
      <div class="hero">
        ${brand()}
        <h1>Five sites.<br><span>Two are real.</span></h1>
        <p class="hero-copy">Command a covert bunker network, read your rival's signals, and commit troops before the next order lock. Every movement leaves a trace. Every trace could be bait.</p>
        <div class="feature-row">
          <span class="feature-chip">2–4 commanders</span>
          <span class="feature-chip">Simultaneous orders</span>
          <span class="feature-chip">Private intelligence</span>
          <span class="feature-chip">Online build 0.5.0</span>
        </div>
      </div>
      <div class="command-card">
        <p class="eyebrow">Open command channel</p>
        <h2>Create an operation</h2>
        <form id="create-form" class="form-stack">
          <label class="field"><span>Commander name</span><input name="name" data-draft="createName" maxlength="20" autocomplete="nickname" value="${esc(landingDraft.createName)}" placeholder="e.g. Nightjar" required></label>
          <button class="btn btn-primary btn-wide" type="submit">Create room</button>
          <div id="create-status" class="form-status">Ready to contact the game server.</div>
        </form>
        <div class="divider">OR JOIN BY CODE</div>
        <form id="join-form" class="form-stack">
          <label class="field"><span>Room code</span><input class="code-input" name="code" data-draft="joinCode" maxlength="5" value="${esc(landingDraft.joinCode)}" placeholder="-----" required></label>
          <label class="field"><span>Commander name</span><input name="name" data-draft="joinName" maxlength="20" autocomplete="nickname" value="${esc(landingDraft.joinName)}" placeholder="e.g. Vesper" required></label>
          <button class="btn btn-wide" type="submit">Join operation</button>
          <div id="join-status" class="form-status"></div>
        </form>
      </div>
    </section>`;
}

function initials(name) {
  return String(name).split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function commanderRow(player) {
  return `<div class="commander" style="--player:${esc(player.color)}">
    <div class="avatar">${esc(initials(player.name))}</div>
    <div><div class="commander-name">${esc(player.name)}${player.id === state.me.id ? ' <span class="subtle tiny">(you)</span>' : ''}</div><div class="subtle tiny">${player.id === state.room.hostId ? 'Room host' : 'Commander'}</div></div>
    <span class="status-dot ${player.connected ? 'online' : ''}" title="${player.connected ? 'Connected' : 'Disconnected'}"></span>
  </div>`;
}

function renderLobby() {
  const canStart = state.me.isHost && state.players.length >= 2;
  const shareUrls = invitationUrls();
  const hosted = serverConfig.mode === 'hosted' || (!isLoopbackOrigin() && serverConfig.mode !== 'local');
  const networkNotice = hosted
    ? `<strong>Online invitation</strong><span class="network-url">${shareUrls.map(esc).join('<br>')}</span><span>Friends can open this secure link from any network and join with the invitation code.</span>`
    : isLoopbackOrigin() && !serverConfig.lanUrls.length
      ? '<strong>No same-network address detected yet</strong><span>localhost works only on this computer. Check that the host is connected to Wi-Fi or Ethernet, then restart the server.</span>'
      : `<strong>Same-Wi-Fi invitation${shareUrls.length > 1 ? 's' : ''}</strong><span class="network-url">${shareUrls.map(esc).join('<br>')}</span><span>Copy invitation uses the first address. If another device cannot open it, try the next address or allow Node.js through Windows Firewall on <b>Private networks</b>.</span>`;
  app.innerHTML = `${renderTopbar()}<div class="shell">
    <div class="stage-header">
      <div><p class="eyebrow">Secure lobby</p><h1>Assemble the command ring</h1><p>Two to four commanders can deploy. The host begins when everyone is connected.</p></div>
      <button class="btn" data-action="copy-room">Copy invitation</button>
    </div>
    <div class="lobby-grid">
      <section class="panel">
        <div class="panel-header"><div class="panel-title"><span class="kicker">Connected personnel</span><h2>${state.players.length}/4 commanders</h2></div><span class="tag">Live channel</span></div>
        <div class="network-notice">${networkNotice}</div>
        <div class="commander-list">${state.players.map(commanderRow).join('')}</div>
        <div class="footer-actions">
          ${state.me.isHost
            ? `<button class="btn btn-primary" data-action="start-game" ${canStart ? '' : 'disabled'}>${canStart ? 'Begin deployment' : 'Waiting for rival'}</button>`
            : '<span class="subtle tiny">Waiting for the host to begin deployment.</span>'}
        </div>
      </section>
      <aside class="panel">
        <div class="panel-header"><div class="panel-title"><span class="kicker">Mission briefing</span><h2>The operation</h2></div></div>
        <div class="briefing">
          <div class="brief-item"><span class="brief-index">01</span><span><strong>One turn equals one day.</strong><small>Day 1 lasts 90 seconds; every later day lasts 45. Everyone submits one secret order, then all orders resolve together.</small></span></div>
          <div class="brief-item"><span class="brief-index">02</span><span><strong>Power wins battles; mobility sets travel.</strong><small>Fast takes 1 day, Medium takes 2, and Slow takes 3. A platoon moves at its slowest troop's speed; returning troops use the same travel time.</small></span></div>
          <div class="brief-item"><span class="brief-index">03</span><span><strong>Hide and defend two real bunkers.</strong><small>Choose two of five sites. Starting defenders are optional, and you can later fortify one or two troops at once up to a two-defender maximum. Each real bunker adds +2 armor in combat.</small></span></div>
          <div class="brief-item"><span class="brief-index">04</span><span><strong>Scouts are silent.</strong><small>Send one troop to learn occupied or clear. Scouts never attack, alert the enemy, or trigger mines; holograms read as occupied, and reports arrive after the full round trip.</small></span></div>
          <div class="brief-item"><span class="brief-index">05</span><span><strong>Attacks commit 1–3 troops.</strong><small>Total power must exceed defenders plus +2 bunker armor. Contact alerts the defender. Failure loses the platoon; victory destroys the bunker but costs one random attacker. Survivors—or troops finding an empty site—return after the full round trip.</small></span></div>
          <div class="brief-item"><span class="brief-index">06</span><span><strong>Reinforcements follow the calendar.</strong><small>Every fifth day can bring one troop card; every tenth can bring one technology card. Hands hold at most 8 troops and 2 technologies.</small></span></div>
          <div class="brief-item"><span class="brief-index">07</span><span><strong>Break the command ring.</strong><small>Destroy both bunkers of your assigned target, then inherit the next surviving target. Three consecutive missed orders cause a forfeit.</small></span></div>
          <div class="brief-item"><span class="brief-index">08</span><span><strong>Win the operation.</strong><small>The last commander standing wins. At the end of Day 30, each commander's total is bunkers remaining plus bunkers destroyed; equal leading totals produce a draw.</small></span></div>
        </div>
      </aside>
    </div>
  </div>`;
}

function troopCard(troop, options = {}) {
  const selected = options.selected ? ' selected' : '';
  const interactive = options.action && !options.disabled ? ' interactive' : '';
  const attr = options.action && !options.disabled ? `data-action="${options.action}" data-troop-id="${troop.id}"` : '';
  const art = Number.isInteger(troop.art) ? troop.art : 0;
  const portrait = String(art).padStart(2, '0');
  return `<button type="button" class="troop${selected}${interactive}" ${attr} ${options.disabled ? 'disabled' : ''}>
    ${options.status ? `<span class="troop-status">${esc(options.status)}</span>` : troop.upgrade ? `<span class="upgrade">${troop.upgrade === 'body' ? '+BODY' : `+${troop.upgrade === 'power' ? 'PWR' : 'MOV'}`}</span>` : ''}
    <span class="troop-portrait" aria-hidden="true"><img src="/assets/troops/troop-${portrait}.jpg" alt="" loading="lazy"></span>
    <span class="troop-name">${esc(troop.unit)}</span>
    <span class="stats"><span class="stat">Power<strong>${troop.power}</strong></span><span class="stat">Mobility<strong>${mobilityLabel(troop.mobility)}</strong></span><span class="stat">Travel<strong>${4 - troop.mobility}d</strong></span></span>
  </button>`;
}

function techCard(tech, interactive = false, selected = false) {
  const portrait = TECH_PORTRAITS[tech.type] || 'uav';
  return `<button type="button" class="tech${interactive ? ' interactive' : ''}${selected ? ' selected' : ''}" ${interactive ? `data-action="select-tech" data-tech-id="${tech.id}"` : ''}>
    <span class="tech-portrait" aria-hidden="true"><img src="/assets/tech/${portrait}.jpg" alt="" loading="lazy"></span>
    <span><strong>${esc(tech.name)}</strong><small>${esc(tech.description)}</small></span>
  </button>`;
}

function setupSite(siteId) {
  const selected = draft.setupSites.includes(siteId);
  return `<button type="button" class="site interactive${selected ? ' selected' : ''}" data-action="toggle-setup-site" data-site-id="${siteId}">
    <span class="site-number">SITE 0${siteId}</span><span class="site-state">${selected ? 'REAL BUNKER' : 'UNASSIGNED'}</span><span class="site-meta">${selected ? 'Starting garrison is optional.' : 'Tap to activate this location.'}</span>
  </button>`;
}

function renderSetup() {
  if (state.me.setupComplete) {
    const ownSites = state.me.sites.map((site) => {
      const power = site.defenders.reduce((sum, troop) => sum + troop.power, 0);
      return `<div class="site ${site.kind === 'real' ? 'selected' : ''}"><span class="site-number">SITE 0${site.siteId}</span><span class="site-state">${site.kind === 'real' ? 'REAL BUNKER' : 'EMPTY SITE'}</span><span class="site-meta">${site.kind === 'real' ? `Defense ${power + state.constants.bunkerArmor}` : 'No active defenses'}</span></div>`;
    }).join('');
    app.innerHTML = `${renderTopbar()}<div class="shell">
      <div class="stage-header"><div><p class="eyebrow">Deployment locked</p><h1>Awaiting the command ring</h1><p>Your bunker locations are encrypted. Other commanders are still choosing.</p></div></div>
      <section class="panel"><div class="site-grid">${ownSites}</div><div class="waiting"><div><div class="waiting-icon">RX</div><h2>Standing by</h2><p class="subtle">${state.players.filter((p) => p.setupComplete).length}/${state.players.length} deployments locked</p></div></div></section>
    </div>`;
    return;
  }

  const assignments = draft.setupSites.map((siteId) => {
    const usedElsewhere = Object.entries(draft.setupAssignments).filter(([key]) => Number(key) !== siteId).map(([, value]) => value);
    const options = state.me.handTroops.map((troop) => `<option value="${troop.id}" ${draft.setupAssignments[siteId] === troop.id ? 'selected' : ''} ${usedElsewhere.includes(troop.id) ? 'disabled' : ''}>${esc(troop.unit)} · Power ${troop.power} · ${mobilityLabel(troop.mobility)}</option>`).join('');
    return `<label class="assignment"><strong>SITE 0${siteId}</strong><select data-change="setup-assignment" data-site-id="${siteId}"><option value="">No starting defender</option>${options}</select></label>`;
  }).join('');
  const startingDefenderIds = Object.values(draft.setupAssignments).filter(Boolean);
  const canDeploy = draft.setupSites.length === 2 && new Set(startingDefenderIds).size === startingDefenderIds.length;
  const canMulligan = !state.me.mulliganUsed && draft.mulliganIds.length > 0 && draft.mulliganIds.length <= 2;
  const assignedTroopIds = new Set(Object.values(draft.setupAssignments).filter(Boolean));
  app.innerHTML = `${renderTopbar()}<div class="shell">
    <div class="stage-header"><div><p class="eyebrow">Classified deployment</p><h1>Hide the operation</h1><p>Activate exactly two sites. Starting garrisons are optional.</p></div><span class="tag">Private view</span></div>
    <div class="setup-layout">
      <div class="stack">
        <section class="panel">
          <div class="panel-header"><div class="panel-title"><span class="kicker">Step 1</span><h2>Select two real bunkers</h2></div><span class="tag">${draft.setupSites.length}/2 selected</span></div>
          <div class="site-grid">${[1,2,3,4,5].map(setupSite).join('')}</div>
          ${draft.setupSites.length ? `<div class="assignment-list">${assignments}</div>` : ''}
        </section>
        <section class="panel">
          <div class="panel-header"><div class="panel-title"><span class="kicker">Step 2</span><h2>Review your troop roster</h2></div><button class="btn btn-small" data-action="mulligan" ${canMulligan ? '' : 'disabled'}>${state.me.mulliganUsed ? 'Exchange used' : `Exchange selected (${draft.mulliganIds.length}/2)`}</button></div>
          <p class="subtle tiny">Before deployment, select up to two troops to exchange once. Any optional starting defenders are removed from your mobile hand.</p>
          <div class="troop-grid">${state.me.handTroops.map((troop) => {
            const assigned = assignedTroopIds.has(troop.id);
            return troopCard(troop, {
              action: state.me.mulliganUsed || assigned ? null : 'toggle-mulligan',
              disabled: assigned,
              status: assigned ? 'DEFENDER' : null,
              selected: draft.mulliganIds.includes(troop.id)
            });
          }).join('')}</div>
          <div class="footer-actions"><button class="btn btn-primary" data-action="submit-setup" ${canDeploy ? '' : 'disabled'}>Lock bunker network</button></div>
        </section>
      </div>
      <aside class="panel">
        <div class="panel-header"><div class="panel-title"><span class="kicker">Starting technology</span><h2>Encrypted assets</h2></div></div>
        <div class="tech-list">${state.me.handTech.map((tech) => techCard(tech)).join('')}</div>
        <div class="notice" style="margin-top:14px">Tech is not played during deployment. Your two cards remain private until used.</div>
      </aside>
    </div>
  </div>`;
}

function targetSiteCard(site) {
  const intel = state.target?.intel?.[site.siteId];
  let status = 'UNKNOWN';
  let meta = 'No current intelligence';
  let className = '';
  if (site.destroyed) {
    status = 'DESTROYED'; meta = 'Confirmed neutralized'; className = ' destroyed';
  } else if (intel?.status === 'destroyed') {
    status = 'DESTROYED'; meta = `Confirmed Day ${intel.day}`; className = ' destroyed';
  } else if (intel?.status === 'real') {
    status = 'CONFIRMED BASE'; meta = `Combat contact · Day ${intel.day}`; className = ' signal';
  } else if (intel?.status === 'signal') {
    status = 'OCCUPIED SIGNAL'; meta = `Scout report · Day ${intel.day}`; className = ' signal';
  } else if (intel?.status === 'clear') {
    status = 'LAST SEEN CLEAR'; meta = `Report received Day ${intel.day}`; className = ' clear';
  }
  const selected = draft.siteId === site.siteId;
  return `<button type="button" class="site${className}${selected ? ' selected' : ''}" disabled>
    <span class="site-number">SITE 0${site.siteId}</span><span class="site-state">${status}</span><span class="site-meta">${meta}</span>
  </button>`;
}

function ownSiteCard(site) {
  const status = site.kind === 'real' ? 'REAL BUNKER' : site.kind === 'destroyed' ? 'DESTROYED' : 'EMPTY SITE';
  const details = [];
  const troopPower = site.defenders.reduce((sum, troop) => sum + troop.power, 0);
  if (site.kind === 'real') details.push(`Defense ${troopPower + state.constants.bunkerArmor}`);
  if (site.hologram) details.push('Hologram active');
  if (site.mine) details.push('Minefield armed');
  if (!details.length) details.push(site.kind === 'empty' ? 'No active defenses' : 'Offline');
  return `<div class="site ${site.kind === 'destroyed' ? 'destroyed' : site.kind === 'real' ? 'selected' : ''}">
    <span class="site-number">SITE 0${site.siteId}</span>${site.mine ? '<span class="site-badge">M</span>' : site.hologram ? '<span class="site-badge">H</span>' : ''}<span class="site-state">${status}</span><span class="site-meta">${details.join(' · ')}</span>
  </div>`;
}

function renderScoreboard(compact = false) {
  return `<div class="scoreboard${compact ? ' compact' : ''}">${state.players.map((player) => {
    const status = player.quit ? 'QUIT' : player.forfeited ? 'FORFEIT' : player.eliminated ? 'ELIMINATED' : 'ACTIVE';
    return `<div class="score-card${player.eliminated ? ' eliminated' : ''}" style="--player:${esc(player.color)}">
      <div class="score-name">${esc(player.name)}${player.id === state.me.id ? ' · YOU' : ''}</div>
      <div class="score-status">${status}</div>
      <div class="score-meta"><span>${player.bunkersRemaining ?? 0} bunker${player.bunkersRemaining === 1 ? '' : 's'}</span><span>${player.bunkersDestroyed} destroyed</span></div>
    </div>`;
  }).join('')}</div>`;
}

function selectableTargetSites(qualifier = () => true, hideIneligible = false, emptyMessage = 'No eligible enemy sites are available.') {
  if (!state.target) return '';
  const sites = hideIneligible
    ? state.target.sites.filter((site) => !site.destroyed && qualifier(site))
    : state.target.sites;
  if (!sites.length) return `<div class="empty-state compact">${esc(emptyMessage)}</div>`;
  return `<div class="inline-options">${sites.map((site) => {
    const disabled = site.destroyed || !qualifier(site);
    return `<button type="button" class="choice${draft.siteId === site.siteId ? ' selected' : ''}" data-action="select-target-site" data-site-id="${site.siteId}" ${disabled ? 'disabled' : ''}>Site 0${site.siteId}</button>`;
  }).join('')}</div>`;
}

function selectableOwnSites(qualifier = () => true, hideIneligible = false, emptyMessage = 'No eligible friendly sites are available.') {
  const sites = hideIneligible ? state.me.sites.filter(qualifier) : state.me.sites;
  if (!sites.length) return `<div class="empty-state compact">${esc(emptyMessage)}</div>`;
  return `<div class="inline-options">${sites.map((site) => `<button type="button" class="choice${draft.ownSiteId === site.siteId ? ' selected' : ''}" data-action="select-own-site" data-site-id="${site.siteId}" ${qualifier(site) ? '' : 'disabled'}>Site 0${site.siteId}</button>`).join('')}</div>`;
}

function selectableTroops(limit) {
  return state.me.handTroops.length
    ? `<div class="troop-grid">${state.me.handTroops.map((troop) => troopCard(troop, { action: 'toggle-order-troop', selected: draft.troopIds.includes(troop.id), limit })).join('')}</div>`
    : '<div class="empty-state">No troops are currently available in hand.</div>';
}

function selectedTroops() {
  return state.me.handTroops.filter((troop) => draft.troopIds.includes(troop.id));
}

function selectedTech() {
  return state.me.handTech.find((tech) => tech.id === draft.techId);
}

function renderTechControls(tech) {
  if (!tech) return '<div class="empty-state">Select a technology card to configure it.</div>';
  if (tech.type === 'hologram') return `<div><p class="selection-label">Choose a clean empty site</p>${selectableOwnSites((site) => site.kind === 'empty' && !site.hologram && !state.me.sites.some((candidate) => candidate.hologram), true, 'No clean empty site is available for a hologram.')}</div>`;
  if (tech.type === 'uav') return `<div class="order-summary">The scan will report each of ${esc(state.target?.name)}'s total bunker defense values—including armor—as anonymous readings, without revealing which site holds either reading.</div>`;
  if (tech.type === 'minefield') return `<div><p class="selection-label">Mine one approach</p>${selectableOwnSites((site) => site.kind !== 'destroyed' && !site.mine, true, 'Every valid approach is already mined.')}</div>`;
  if (tech.type === 'napalm') {
    const eligible = (site) => {
      const intel = state.target?.intel?.[site.siteId];
      return intel && ['signal', 'real'].includes(intel.status);
    };
    return `<div><p class="selection-label">Choose a known occupied signal</p>${selectableTargetSites(eligible, true, 'No known occupied signal can be targeted.')}<p class="subtle tiny">Only eligible sites are shown. A hologram can consume this strike.</p></div>`;
  }
  if (tech.type === 'cyberkinetics') return `<div class="order-builder"><div><p class="selection-label">Choose one troop</p>${selectableTroops(1)}</div><div class="order-summary"><strong>Body Enhancers</strong> grant that troop +2 battle power and +1 mobility together.</div></div>`;
  if (tech.type === 'teleporter') {
    const origins = state.me.sites.filter((site) => site.kind === 'real');
    const destinations = state.me.sites.filter((site) => site.kind === 'empty' && !site.hologram);
    return `<div class="order-builder"><label class="field"><span>Move real bunker</span><select data-change="teleport-from"><option value="">Choose origin…</option>${origins.map((site) => `<option value="${site.siteId}" ${draft.fromSiteId === site.siteId ? 'selected' : ''}>Site 0${site.siteId} · ${site.defenders.length} defenders lost</option>`).join('')}</select></label><label class="field"><span>New empty site</span><select data-change="teleport-to"><option value="">Choose destination…</option>${destinations.map((site) => `<option value="${site.siteId}" ${draft.toSiteId === site.siteId ? 'selected' : ''}>Site 0${site.siteId}</option>`).join('')}</select></label></div>`;
  }
  if (tech.type === 'radio_hacker') return '<div class="order-summary">The Signal Interceptor monitors platoons approaching any of your five sites for five days. Intercepts include destination, troop count, and arrival day.</div>';
  if (tech.type === 'air_raid') {
    const troops = selectedTroops();
    const power = troops.reduce((sum, troop) => sum + troop.power, 0);
    return `<div class="order-builder"><div><p class="selection-label">Choose an enemy site</p>${selectableTargetSites()}</div><div><p class="selection-label">Select 1–3 air-deployed troops</p>${selectableTroops(3)}</div>${troops.length ? `<div class="order-summary">Air Raid attack power <strong>${power}</strong> · contact resolves immediately with normal combat and attrition rules. Survivors use their normal travel time to return.</div>` : '<div class="order-summary">Air Raid bypasses outbound travel and resolves its attack immediately.</div>'}</div>`;
  }
  return '';
}

function orderIsReady() {
  if (draft.orderType === 'pass') return true;
  if (draft.orderType === 'attack') return draft.siteId && draft.troopIds.length >= 1 && draft.troopIds.length <= 3;
  if (draft.orderType === 'scout') return draft.siteId && draft.troopIds.length === 1;
  if (draft.orderType === 'fortify') {
    const site = state.me.sites.find((candidate) => candidate.siteId === draft.ownSiteId);
    const openSlots = site ? state.constants.maxGarrison - site.defenders.length : 0;
    return Boolean(draft.ownSiteId && draft.troopIds.length >= 1 && draft.troopIds.length <= Math.min(2, openSlots));
  }
  if (draft.orderType !== 'tech') return false;
  const tech = selectedTech();
  if (!tech) return false;
  if (['uav', 'radio_hacker'].includes(tech.type)) return true;
  if (['hologram', 'minefield'].includes(tech.type)) return Boolean(draft.ownSiteId);
  if (tech.type === 'napalm') return Boolean(draft.siteId);
  if (tech.type === 'cyberkinetics') return draft.troopIds.length === 1;
  if (tech.type === 'teleporter') return Boolean(draft.fromSiteId && draft.toSiteId && draft.fromSiteId !== draft.toSiteId);
  if (tech.type === 'air_raid') return Boolean(draft.siteId && draft.troopIds.length >= 1 && draft.troopIds.length <= 3);
  return false;
}

function renderOrderBuilder() {
  const types = [['attack','Attack'],['scout','Scout'],['fortify','Fortify'],['tech','Tech'],['pass','Pass']];
  let controls = '';
  if (draft.orderType === 'attack') {
    const troops = selectedTroops();
    const power = troops.reduce((sum, troop) => sum + troop.power, 0);
    const travel = troops.length ? Math.max(...troops.map((troop) => 4 - troop.mobility)) : 0;
    controls = `<div><p class="selection-label">Choose an enemy site</p>${selectableTargetSites()}</div><div><p class="selection-label">Select 1–3 troops</p>${selectableTroops(3)}</div>${troops.length ? `<div class="order-summary">Platoon power <strong>${power}</strong> · outbound travel <strong>${travel} day${travel === 1 ? '' : 's'}</strong> · the slowest troop sets the pace.</div>` : ''}`;
  } else if (draft.orderType === 'scout') {
    controls = `<div><p class="selection-label">Choose an enemy site</p>${selectableTargetSites()}</div><div><p class="selection-label">Choose one scout</p>${selectableTroops(1)}</div><div class="order-summary">The report arrives after the complete round trip. Scouts do not alert the enemy or trigger mines.</div>`;
  } else if (draft.orderType === 'fortify') {
    const selectedSite = state.me.sites.find((site) => site.siteId === draft.ownSiteId);
    const openSlots = selectedSite ? state.constants.maxGarrison - selectedSite.defenders.length : 2;
    const troopLimit = Math.max(1, Math.min(2, openSlots));
    controls = `<div><p class="selection-label">Choose a real bunker with space</p>${selectableOwnSites((site) => site.kind === 'real' && site.defenders.length < state.constants.maxGarrison, true, 'No real bunker has an open defender slot.')}</div><div><p class="selection-label">Commit up to ${troopLimit} defender${troopLimit === 1 ? '' : 's'}</p>${selectableTroops(troopLimit)}</div><div class="order-summary">You may fortify one or two troops at once, up to the bunker maximum of two defenders. Committed troops join immediately and cannot be withdrawn normally.</div>`;
  } else if (draft.orderType === 'tech') {
    controls = state.me.handTech.length
      ? `<div><p class="selection-label">Choose one technology</p><div class="tech-list">${state.me.handTech.map((tech) => techCard(tech, true, draft.techId === tech.id)).join('')}</div></div>${renderTechControls(selectedTech())}`
      : '<div class="empty-state">No technology cards are available.</div>';
  } else {
    controls = '<div class="order-summary">Take no action this day. Missions already in transit will still advance and resolve.</div>';
  }
  const seconds = state.room.deadline ? Math.max(0, Math.ceil((state.room.deadline - Date.now()) / 1000)) : 0;
  const urgent = seconds > 0 && seconds <= 10;
  return `<div class="action-tabs">${types.map(([type,label]) => `<button class="action-tab${draft.orderType === type ? ' active' : ''}" data-action="select-order-type" data-order-type="${type}">${label}</button>`).join('')}</div><div class="order-builder">${controls}<button id="lock-order-button" class="btn btn-primary btn-wide lock-order-button" data-action="submit-order" ${orderIsReady() ? '' : 'disabled'}><span>Lock ${draft.orderType} order</span><span id="lock-order-countdown" class="lock-order-countdown${urgent ? ' visible' : ''}" aria-live="off">${seconds}</span></button></div>`;
}

function renderWaitingOrder() {
  const pending = state.players.filter((player) => !player.eliminated && !player.orderSubmitted);
  return `<div class="waiting"><div><div class="waiting-icon">TX</div><h2>${esc(state.me.order?.type || 'Order')} order locked</h2><p class="subtle">${pending.length ? `Waiting for ${pending.map((p) => esc(p.name)).join(', ')}` : 'Resolving the day…'}</p></div></div>`;
}

function renderMissions() {
  if (!state.me.missions.length) return '<div class="empty-state">No troops are currently in transit.</div>';
  return `<div class="mission-list">${state.me.missions.map((mission) => `<div class="mission"><span class="mission-icon">${mission.type === 'attack' ? 'ATK' : 'SCT'}</span><span><strong>${mission.phase === 'outbound' ? 'Toward' : 'Returning from'} ${esc(mission.targetName)} · Site 0${mission.targetSiteId}</strong><small>${mission.troopCount} troop${mission.troopCount === 1 ? '' : 's'} · ${mission.phase}</small></span><span class="eta">${mission.eta}d</span></div>`).join('')}</div>`;
}

function renderEvents(showAll = false) {
  const events = state.events
    .filter((event) => event.tone !== 'system' && !event.text.startsWith('Order locked'))
    .reverse();
  if (!events.length) return '<div class="empty-state compact">No reportable activity yet.</div>';
  return `<div class="event-list">${events.map((event) => `<div class="event ${esc(event.tone)}"><span class="event-day">${event.day ? `D${String(event.day).padStart(2,'0')}` : 'SYS'}</span><span class="event-text">${esc(event.text)}</span></div>`).join('')}</div>`;
}

function renderTransition() {
  const transition = state.room.transition;
  if (!transition || transition.until <= Date.now()) return '';
  const missing = Boolean(transition.missedOrder);
  return `<div class="transition-overlay" role="status" aria-live="assertive">
    <div class="transition-card">
      <div class="transition-scan" aria-hidden="true"></div>
      <h2>${missing ? 'Missing Orders' : 'Orders Received'}</h2>
      <p class="transition-day">Next Day: ${transition.nextDay}</p>
    </div>
  </div>`;
}

function renderGame() {
  const targetName = state.target?.name || 'No active target';
  const ownMap = state.me.sites.map(ownSiteCard).join('');
  const targetMap = state.target ? state.target.sites.map(targetSiteCard).join('') : '<div class="empty-state">No active target.</div>';
  const actionContent = state.me.eliminated
    ? '<div class="waiting"><div><div class="waiting-icon">OFF</div><h2>Command network eliminated</h2><p class="subtle">You can continue watching the remaining operation.</p></div></div>'
    : state.me.order ? renderWaitingOrder() : renderOrderBuilder();
  const uav = state.me.uavReport && state.target && state.me.uavReport.targetId === state.target.id
    ? `<div class="intel-report"><strong>Latest UAV sweep · Day ${state.me.uavReport.day}</strong><br>Anonymous total defense reading${state.me.uavReport.bunkerDefenses.length === 1 ? '' : 's'}: ${state.me.uavReport.bunkerDefenses.join(' · ')}</div>`
    : '';
  app.innerHTML = `${renderTopbar()}<div class="shell game-shell">
    <div class="stage-header operation-header">
      <div><p class="eyebrow">Active operation</p><h1>Day ${state.room.day}: issue one order</h1><p>You hunt <strong style="color:${esc(state.target?.color || '#fff')}">${esc(targetName)}</strong>${state.hunter ? ` while <strong style="color:${esc(state.hunter.color)}">${esc(state.hunter.name)}</strong> hunts you.` : '.'}</p></div>
      <div class="operation-status">${state.me.radioHackerUntil >= state.room.day ? `<span class="tag">Signal watch through D${state.me.radioHackerUntil}</span>` : ''}${renderScoreboard(true)}</div>
    </div>
    <div class="game-grid">
      <div class="main-column">
        <section class="panel">
          <div class="panel-header"><div class="panel-title"><span class="kicker">Friendly network · classified</span><h2>Your five sites</h2></div><span class="tag">Armor +2</span></div>
          <div class="site-grid">${ownMap}</div>
        </section>
        <section class="panel">
          <div class="panel-header"><div class="panel-title"><span class="kicker">Assigned target</span><h2>${esc(targetName)}'s network</h2></div><span class="versus" style="--player:${esc(state.target?.color || '#fff')}"><span class="color-dot"></span>${state.target?.bunkersRemaining ?? 0} active</span></div>
          ${uav}<div class="site-grid" style="margin-top:${uav ? '14px' : '0'}">${targetMap}</div>
        </section>
        <section class="panel">
          <div class="panel-header"><div class="panel-title"><span class="kicker">Day ${state.room.day} order</span><h2>${state.me.order ? 'Transmission pending' : 'Choose your move'}</h2></div><span class="tag">${state.me.handTroops.length}/${state.constants.maxTroopHand} troops ready</span></div>
          ${actionContent}
        </section>
      </div>
      <aside class="side-column">
        <section class="panel"><div class="panel-header"><div class="panel-title"><span class="kicker">Field status</span><h2>Missions</h2></div></div>${renderMissions()}</section>
        <section class="panel"><div class="panel-header"><div class="panel-title"><span class="kicker">Available assets</span><h2>Technology</h2></div><span class="tag">${state.me.handTech.length}/${state.constants.maxTechHand}</span></div><div class="tech-list">${state.me.handTech.length ? state.me.handTech.map((tech) => techCard(tech)).join('') : '<div class="empty-state">No tech cards.</div>'}</div></section>
        <section class="panel"><div class="panel-header"><div class="panel-title"><span class="kicker">All days · your perspective</span><h2>Activity</h2></div></div>${renderEvents()}</section>
      </aside>
    </div>
  </div>${renderTransition()}`;
}

function renderFinished() {
  const winners = state.players.filter((player) => state.room.winnerIds.includes(player.id));
  const won = state.room.winnerIds.includes(state.me.id);
  const draw = Boolean(state.room.isDraw);
  const quitter = state.players.find((player) => player.id === state.room.quitPlayerId);
  const forfeited = state.players.filter((player) => state.room.forfeitPlayerIds?.includes(player.id));
  const quitEnded = state.room.endReason === 'quit';
  let heading;
  let resultCopy;
  let sigil;
  if (quitEnded && state.players.length === 2 && winners[0]) {
    heading = `${esc(winners[0].name)} wins by forfeit`;
    resultCopy = `${esc(quitter?.name || 'The other commander')} quit the operation.`;
    sigil = won ? 'V' : 'X';
  } else if (quitEnded) {
    heading = `${esc(quitter?.name || 'A commander')} quit`;
    resultCopy = 'The operation ended because a commander left the game.';
    sigil = 'Q';
  } else if (state.room.endReason === 'missed-orders' && winners[0]) {
    heading = `${esc(winners[0].name)} wins by forfeit`;
    resultCopy = `${esc(forfeited.map((player) => player.name).join(' & ') || 'The opposing commander')} forfeited after missing three consecutive order windows.`;
    sigil = won ? 'V' : 'X';
  } else if (state.room.endReason === 'day-limit') {
    heading = draw
      ? 'Day 30 ends in a draw'
      : won ? 'Victory secured' : `${esc(winners[0]?.name || 'The leading commander')} wins`;
    resultCopy = draw
      ? 'The leading bunker totals are equal: bunkers remaining plus bunkers destroyed.'
      : `${esc(winners[0]?.name || 'The winning commander')} finished with the higher bunker total: bunkers remaining plus bunkers destroyed.`;
    sigil = draw ? '=' : won ? 'V' : 'X';
  } else {
    heading = draw ? 'Operation ends in a draw' : won ? 'Victory secured' : `${esc(winners.map((player) => player.name).join(' & '))} wins`;
    resultCopy = draw
      ? 'The leading bunker totals are equal.'
      : won ? 'Every enemy bunker network has been neutralized.' : 'All of your bunkers were destroyed.';
    sigil = draw ? '=' : won ? 'V' : 'X';
  }
  app.innerHTML = `${renderTopbar()}<div class="shell">
    <section class="panel result-hero"><div class="result-sigil">${sigil}</div><p class="eyebrow">Operation complete</p><h1>${heading}</h1><p>${resultCopy}</p></section>
    <section class="panel" style="margin-top:18px"><div class="panel-header"><div class="panel-title"><span class="kicker">Final standing</span><h2>Bunker standings</h2></div></div>${renderScoreboard()}<div class="footer-actions"><button class="btn btn-primary" data-action="return-title">Return to title</button></div></section>
    <section class="panel" style="margin-top:18px"><div class="panel-header"><div class="panel-title"><span class="kicker">Debrief</span><h2>Operation log</h2></div></div>${renderEvents(true)}</section>
  </div>`;
}

function render() {
  if (!session || !state) return renderLanding();
  if (state.room.phase === 'lobby') return renderLobby();
  if (state.room.phase === 'setup') return renderSetup();
  if (state.room.phase === 'finished') return renderFinished();
  return renderGame();
}

function updateTimer() {
  const element = document.querySelector('#timer');
  if (!element || !state?.room.deadline) return;
  const seconds = Math.max(0, Math.ceil((state.room.deadline - Date.now()) / 1000));
  element.textContent = formatCountdown(state.room.deadline);
  element.classList?.toggle('urgent', seconds <= 10);
  const buttonCountdown = document.querySelector('#lock-order-countdown');
  if (buttonCountdown?.classList) {
    buttonCountdown.textContent = String(seconds);
    buttonCountdown.classList.toggle('visible', seconds > 0 && seconds <= 10 && !state.me.order);
  }
}

setInterval(updateTimer, 250);

function buildOrder() {
  if (draft.orderType === 'pass') return { type: 'pass' };
  if (draft.orderType === 'attack' || draft.orderType === 'scout') return { type: draft.orderType, siteId: draft.siteId, troopIds: draft.troopIds };
  if (draft.orderType === 'fortify') return { type: 'fortify', siteId: draft.ownSiteId, troopIds: draft.troopIds };
  const tech = selectedTech();
  const order = { type: 'tech', techId: tech.id };
  if (['hologram', 'minefield'].includes(tech.type)) order.siteId = draft.ownSiteId;
  else if (tech.type === 'napalm') order.siteId = draft.siteId;
  else if (tech.type === 'cyberkinetics') order.troopId = draft.troopIds[0];
  else if (tech.type === 'teleporter') Object.assign(order, { fromSiteId: draft.fromSiteId, toSiteId: draft.toSiteId });
  else if (tech.type === 'air_raid') Object.assign(order, { siteId: draft.siteId, troopIds: draft.troopIds });
  return order;
}

async function mutate(path, body) {
  if (busy) return null;
  busy = true;
  try {
    const result = await request(`/api/rooms/${session.roomCode}/${path}`, body);
    if (result.state) acceptState(result.state);
    return result;
  } catch (error) {
    showToast(error.message, true);
    return null;
  } finally {
    busy = false;
  }
}

function returnToTitle() {
  eventSource?.close();
  eventSource = null;
  stopPresence();
  clearTimeout(streamErrorTimer);
  stopMusic();
  lastTransitionDay = null;
  lastPhaseKey = '';
  resetAllDrafts();
  saveSession(null);
  state = null;
  history.replaceState(null, '', '/');
  render();
}

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  if (musicEnabled) startMusic();
  const form = event.target;
  const data = new FormData(form);
  const statusId = form.id === 'create-form' ? 'create-status' : 'join-status';
  const submitButton = form.querySelector?.('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  setFormStatus(statusId, form.id === 'create-form' ? 'Creating room…' : 'Joining room…', 'working');
  busy = true;
  try {
    let result;
    if (form.id === 'create-form') {
      result = await request('/api/rooms', { name: data.get('name') }, false);
    } else if (form.id === 'join-form') {
      const code = String(data.get('code') || '').trim().toUpperCase();
      result = await request(`/api/rooms/${encodeURIComponent(code)}/join`, { name: data.get('name') }, false);
    } else return;
    saveSession(result.session);
    sessionStorage.removeItem(LANDING_DRAFT_KEY);
    history.replaceState(null, '', `/?room=${result.session.roomCode}`);
    acceptState(result.state);
    connectEvents();
  } catch (error) {
    setFormStatus(statusId, `Could not continue: ${error.message}`, 'error');
    showToast(error.message, true);
  } finally {
    if (submitButton?.isConnected) submitButton.disabled = false;
    busy = false;
  }
});

app.addEventListener('input', (event) => {
  const key = event.target?.dataset?.draft;
  if (!key || !(key in landingDraft)) return;
  landingDraft[key] = key === 'joinCode'
    ? String(event.target.value || '').toUpperCase().slice(0, 5)
    : String(event.target.value || '');
  saveLandingDraft();
});

app.addEventListener('change', (event) => {
  const control = event.target;
  const kind = control.dataset.change;
  if (kind === 'setup-assignment') {
    draft.setupAssignments[Number(control.dataset.siteId)] = control.value;
    if (control.value) draft.mulliganIds = draft.mulliganIds.filter((troopId) => troopId !== control.value);
  }
  else if (kind === 'teleport-from') draft.fromSiteId = Number(control.value) || null;
  else if (kind === 'teleport-to') draft.toSiteId = Number(control.value) || null;
  render();
});

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (musicEnabled && session && action !== 'toggle-music') startMusic();
  if (action === 'copy-room') {
    await loadServerConfig();
    if (isLoopbackOrigin() && serverConfig.mode !== 'hosted' && !serverConfig.lanUrls.length) {
      showToast('No LAN address detected. localhost cannot be opened from another device.', true);
      return;
    }
    const url = invitationUrl();
    try { await navigator.clipboard.writeText(url); showToast('Invitation copied.'); }
    catch { showToast(`Share ${url}`); }
  } else if (action === 'leave-room') {
    const phase = state?.room.phase;
    const message = phase === 'lobby'
      ? 'Leave this room?'
      : phase === 'finished'
        ? 'Return to the title screen?'
        : 'Quit the game? This will end the operation for every player.';
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(message)) return;
    if (!session || phase === 'finished') returnToTitle();
    const result = await mutate('quit', {});
    if (phase === 'lobby' && result?.left) returnToTitle();
  } else if (action === 'return-title') {
    returnToTitle();
  } else if (action === 'toggle-music') {
    musicEnabled = !musicEnabled;
    saveMusicPreference();
    if (musicEnabled) startMusic();
    else stopMusic();
    render();
  } else if (action === 'start-game') {
    await mutate('start', {});
  } else if (action === 'toggle-setup-site') {
    const siteId = Number(button.dataset.siteId);
    if (draft.setupSites.includes(siteId)) {
      draft.setupSites = draft.setupSites.filter((id) => id !== siteId);
      delete draft.setupAssignments[siteId];
    } else if (draft.setupSites.length < 2) draft.setupSites.push(siteId);
    render();
  } else if (action === 'toggle-mulligan') {
    const troopId = button.dataset.troopId;
    const assigned = Object.values(draft.setupAssignments).includes(troopId);
    if (assigned) showToast('A bunker defender cannot also be exchanged.', true);
    else if (draft.mulliganIds.includes(troopId)) draft.mulliganIds = draft.mulliganIds.filter((id) => id !== troopId);
    else if (draft.mulliganIds.length < 2) draft.mulliganIds.push(troopId);
    else showToast('You can exchange at most two troops.', true);
    render();
  } else if (action === 'mulligan') {
    await mutate('mulligan', { troopIds: draft.mulliganIds });
    draft.mulliganIds = [];
  } else if (action === 'submit-setup') {
    const bunkers = draft.setupSites.map((siteId) => ({ siteId, troopId: draft.setupAssignments[siteId] || null }));
    await mutate('setup', { bunkers });
  } else if (action === 'select-order-type') {
    resetOrderDraft();
    draft.orderType = button.dataset.orderType;
    render();
  } else if (action === 'select-target-site') {
    draft.siteId = Number(button.dataset.siteId);
    render();
  } else if (action === 'select-own-site') {
    draft.ownSiteId = Number(button.dataset.siteId);
    if (draft.orderType === 'fortify') {
      const site = state.me.sites.find((candidate) => candidate.siteId === draft.ownSiteId);
      const openSlots = site ? state.constants.maxGarrison - site.defenders.length : 0;
      draft.troopIds = draft.troopIds.slice(0, Math.max(0, Math.min(2, openSlots)));
    }
    render();
  } else if (action === 'toggle-order-troop') {
    const troopId = button.dataset.troopId;
    const fortifySite = draft.orderType === 'fortify'
      ? state.me.sites.find((site) => site.siteId === draft.ownSiteId)
      : null;
    const limit = draft.orderType === 'attack'
      ? 3
      : draft.orderType === 'fortify'
        ? Math.max(1, Math.min(2, fortifySite ? state.constants.maxGarrison - fortifySite.defenders.length : 2))
        : draft.orderType === 'tech' && selectedTech()?.type === 'air_raid'
          ? 3
        : 1;
    if (draft.troopIds.includes(troopId)) draft.troopIds = draft.troopIds.filter((id) => id !== troopId);
    else if (draft.troopIds.length < limit) draft.troopIds.push(troopId);
    else if (limit === 1) draft.troopIds = [troopId];
    else showToast(`A platoon can include at most ${limit} troops.`, true);
    render();
  } else if (action === 'select-tech') {
    draft.techId = button.dataset.techId;
    draft.siteId = null;
    draft.ownSiteId = null;
    draft.troopIds = [];
    draft.fromSiteId = null;
    draft.toSiteId = null;
    render();
  } else if (action === 'submit-order') {
    await mutate('order', { order: buildOrder() });
  }
});

restore();
loadServerConfig();
