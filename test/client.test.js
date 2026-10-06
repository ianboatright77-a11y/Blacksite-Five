'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGameServer } = require('../server');

test('browser client creates a room and renders the lobby', async (t) => {
  const { server } = createGameServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const handlers = {};
  const app = {
    innerHTML: '',
    addEventListener(type, handler) { handlers[type] = handler; }
  };
  const toast = { textContent: '', className: '' };
  const stored = new Map();
  let confirmCalls = 0;
  class BrowserFormData {
    constructor(form) { this.form = form; }
    get(name) { return this.form.fields[name]; }
  }
  class EventSourceStub {
    addEventListener() {}
    close() {}
  }

  const context = vm.createContext({
    console,
    document: {
      querySelector(selector) { return selector === '#app' ? app : toast; }
    },
    sessionStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); },
      removeItem(key) { stored.delete(key); }
    },
    location: { search: '', origin: base },
    history: { replaceState() {} },
    navigator: { clipboard: { async writeText() {} } },
    confirm() { confirmCalls += 1; return false; },
    FormData: BrowserFormData,
    EventSource: EventSourceStub,
    URL,
    URLSearchParams,
    fetch(url, options) { return fetch(new URL(url, base), options); },
    setTimeout,
    clearTimeout,
    clearInterval() {},
    setInterval() { return 0; }
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'app.js' });
  assert.match(app.innerHTML, /Create an operation/);

  handlers.input({ target: { dataset: { draft: 'createName' }, value: 'Alpha' } });
  vm.runInContext('render()', context);
  assert.match(app.innerHTML, /value="Alpha"/);

  await handlers.submit({
    preventDefault() {},
    target: { id: 'create-form', fields: { name: 'Alpha' } }
  });

  assert.match(app.innerHTML, /Assemble the command ring/);
  assert.match(app.innerHTML, /Alpha/);
  assert.match(app.innerHTML, /Invitation Code:/);
  assert.doesNotMatch(app.innerHTML, /Share code/);
  assert.match(app.innerHTML, /Fast takes 1 day/);
  assert.match(app.innerHTML, /Day 1 lasts 90 seconds/);
  assert.ok(stored.has('blacksite-five-session'));

  const lanInvitation = vm.runInContext(`
    serverConfig = { mode: 'local', publicUrl: null, lanUrls: ['http://192.168.1.25:4173'] };
    invitationUrl();
  `, context);
  assert.match(lanInvitation, /^http:\/\/192\.168\.1\.25:4173\/\?room=/);
  assert.doesNotMatch(lanInvitation, /localhost|127\.0\.0\.1/);

  const hostedInvitation = vm.runInContext(`
    serverConfig = { mode: 'hosted', publicUrl: 'https://blacksite-five.example', lanUrls: [] };
    renderLobby();
    invitationUrl();
  `, context);
  assert.match(hostedInvitation, /^https:\/\/blacksite-five\.example\/\?room=/);
  assert.match(app.innerHTML, /Online invitation/);
  assert.match(app.innerHTML, /from any network/);
  assert.doesNotMatch(app.innerHTML, /Same-Wi-Fi invitation/);

  const planningTopbar = vm.runInContext(`
    state.room.phase = 'planning';
    state.room.deadline = Date.now() + 60_000;
    renderTopbar();
  `, context);
  assert.doesNotMatch(planningTopbar, /--:--/);
  assert.match(planningTopbar, /\d{2}:\d{2}/);

  const napalmControls = vm.runInContext(`
    state.room.day = 23;
    state.target = {
      name: 'Bravo',
      sites: [1, 2, 3, 4, 5].map((siteId) => ({ siteId, destroyed: false })),
      intel: { 2: { status: 'signal', day: 2 } }
    };
    renderTechControls({ type: 'napalm' });
  `, context);
  assert.match(napalmControls, /Site 02/);
  assert.doesNotMatch(napalmControls, /Site 01|Site 03|Site 04|Site 05/);

  const technologySiteControls = vm.runInContext(`
    state.me.sites = [
      { siteId: 1, kind: 'empty', defenders: [], hologram: false, mine: false },
      { siteId: 2, kind: 'real', defenders: [], hologram: false, mine: true },
      { siteId: 3, kind: 'destroyed', defenders: [], hologram: false, mine: false },
      { siteId: 4, kind: 'empty', defenders: [], hologram: false, mine: true },
      { siteId: 5, kind: 'real', defenders: [], hologram: false, mine: false }
    ];
    ({ hologram: renderTechControls({ type: 'hologram' }), minefield: renderTechControls({ type: 'minefield' }) });
  `, context);
  assert.match(technologySiteControls.hologram, /Site 01|Site 04/);
  assert.doesNotMatch(technologySiteControls.hologram, /Site 02|Site 03|Site 05/);
  assert.match(technologySiteControls.minefield, /Site 01/);
  assert.match(technologySiteControls.minefield, /Site 05/);
  assert.doesNotMatch(technologySiteControls.minefield, /Site 02|Site 03|Site 04/);

  vm.runInContext(`
    const alphaView = state.players.find((player) => player.id === state.me.id);
    state.players = [alphaView, {
      id: 'bravo', name: 'Bravo', color: '#ff9b5e', connected: false,
      eliminated: true, quit: true, setupComplete: true, orderSubmitted: false,
      bunkersRemaining: 1, bunkersDestroyed: 0, eliminations: 0, score: 0,
      finalScore: 1, sites: []
    }];
    state.room.phase = 'finished';
    state.room.endReason = 'quit';
    state.room.quitPlayerId = 'bravo';
    state.room.winnerIds = [state.me.id];
    renderFinished();
  `, context);
  assert.match(app.innerHTML, /Alpha wins by forfeit/);
  assert.match(app.innerHTML, /Bravo quit the operation/);

  vm.runInContext(`
    state.players.push({
      id: 'charlie', name: 'Charlie', color: '#8aa7ff', connected: true,
      eliminated: false, quit: false, setupComplete: true, orderSubmitted: false,
      bunkersRemaining: 2, bunkersDestroyed: 0, eliminations: 0, score: 0,
      finalScore: 2, sites: []
    });
    state.room.winnerIds = [];
    renderFinished();
  `, context);
  assert.match(app.innerHTML, /Bravo quit/);
  assert.doesNotMatch(app.innerHTML, /wins by forfeit/);

  vm.runInContext("state.room.phase = 'planning';", context);
  await handlers.click({
    target: { closest() { return { disabled: false, dataset: { action: 'leave-room' } }; } }
  });
  assert.equal(confirmCalls, 1);
  assert.ok(stored.has('blacksite-five-session'), 'cancelling the exit keeps the active session');

  const transition = vm.runInContext(`
    state.room.transition = { completedDay: 1, nextDay: 2, until: Date.now() + 3_000 };
    renderTransition();
  `, context);
  assert.match(transition, /Orders Received/);
  assert.match(transition, /Next Day: 2/);
  assert.doesNotMatch(transition, /report|resolved/i);

  const missedTransition = vm.runInContext(`
    state.room.transition = { completedDay: 2, nextDay: 3, until: Date.now() + 3_000, missedPlayerIds: ['bravo'] };
    renderTransition();
  `, context);
  assert.match(missedTransition, /Missing Orders/);

  const troopLabels = vm.runInContext(`
    troopCard({ id: 'speed', unit: 'Ranger', power: 3, mobility: 3, art: 3 });
  `, context);
  assert.match(troopLabels, /Mobility<strong>Fast<\/strong>/);
  assert.doesNotMatch(troopLabels, /Mobility<strong>3<\/strong>/);

  const techPortrait = vm.runInContext(`
    techCard({ id: 'uav-card', type: 'uav', name: 'UAV Sweep', description: 'Scan' });
  `, context);
  assert.match(techPortrait, /assets\/tech\/uav\.jpg/);

  const siteDetails = vm.runInContext(`
    state.constants = { ...state.constants, bunkerArmor: 2, maxGarrison: 2 };
    ({
      real: ownSiteCard({ siteId: 1, kind: 'real', defenders: [{ power: 4 }], hologram: false, mine: false }),
      empty: ownSiteCard({ siteId: 2, kind: 'empty', defenders: [], hologram: false, mine: false })
    });
  `, context);
  assert.match(siteDetails.real, /Defense 6/);
  assert.doesNotMatch(siteDetails.real, /Troop power|defenders/);
  assert.match(siteDetails.empty, /No active defenses/);
  assert.doesNotMatch(siteDetails.empty, /Power 0/);

  const fullActivity = vm.runInContext(`
    state.room.day = 4;
    state.events = [
      { id: 'e1', day: 1, tone: 'success', text: 'Day one success' },
      { id: 'e2', day: 3, tone: 'danger', text: 'Day three setback' }
    ];
    renderEvents();
  `, context);
  assert.match(fullActivity, /Day one success/);
  assert.match(fullActivity, /Day three setback/);

  vm.runInContext(`
    state.room.phase = 'setup';
    state.me.setupComplete = false;
    state.me.mulliganUsed = false;
    state.me.handTech = [];
    state.me.handTroops = [
      { id: 't1', unit: 'Fodder', power: 1, mobility: 2, art: 0 },
      { id: 't2', unit: 'Ranger', power: 3, mobility: 3, art: 3 }
    ];
    draft.setupSites = [1, 2];
    draft.setupAssignments = { 1: 't1', 2: 't2' };
    draft.mulliganIds = ['t1'];
  `, context);
  handlers.change({ target: { dataset: { change: 'setup-assignment', siteId: '1' }, value: 't1' } });
  assert.equal(vm.runInContext('draft.mulliganIds.length', context), 0);
  assert.match(app.innerHTML, /troop-status">BUNKER/);

  const twoTroopFortify = vm.runInContext(`
    state.room.phase = 'planning';
    state.room.deadline = Date.now() + 9_500;
    state.me.order = null;
    state.me.sites = [
      { siteId: 1, kind: 'real', defenders: [], hologram: false, mine: false },
      { siteId: 2, kind: 'real', defenders: [{ id: 'guard', power: 2 }], hologram: false, mine: false }
    ];
    draft.orderType = 'fortify';
    draft.ownSiteId = 1;
    draft.troopIds = ['t1', 't2'];
    renderOrderBuilder();
  `, context);
  assert.match(twoTroopFortify, /Commit up to 2 defenders/);
  assert.match(twoTroopFortify, /lock-order-countdown visible/);
  assert.equal(vm.runInContext('orderIsReady()', context), true);

  vm.runInContext(`
    state.room.phase = 'finished';
    state.room.endReason = 'day-limit';
    state.room.quitPlayerId = null;
    state.room.winnerIds = [state.me.id];
    state.players.find((player) => player.id === state.me.id).finalScore = 6;
    renderFinished();
  `, context);
  assert.match(app.innerHTML, /more resources and battle achievements when Day 30 ended/);

  const portraitFiles = fs.readdirSync(path.join(__dirname, '..', 'public', 'assets', 'troops'))
    .filter((name) => /^troop-\d{2}\.jpg$/.test(name));
  assert.equal(portraitFiles.length, 20);

  const techPortraitFiles = fs.readdirSync(path.join(__dirname, '..', 'public', 'assets', 'tech'))
    .filter((name) => /\.jpg$/.test(name));
  assert.deepEqual(techPortraitFiles.sort(), [
    'body-enhancers.jpg', 'hologram.jpg', 'minefield.jpg', 'napalm.jpg',
    'signal-interceptor.jpg', 'teleporter.jpg', 'uav.jpg'
  ]);

  vm.runInContext(`
    draft.setupSites = [1, 2];
    draft.setupAssignments = { 1: 't1', 2: 't2' };
    draft.mulliganIds = ['t1'];
    returnToTitle();
  `, context);
  assert.equal(vm.runInContext('draft.setupSites.length', context), 0);
  assert.equal(vm.runInContext('draft.mulliganIds.length', context), 0);
  assert.equal(vm.runInContext('Object.keys(draft.setupAssignments).length', context), 0);
});
