'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRoom,
  addPlayer,
  startGame,
  submitSetup,
  submitOrder,
  quitGame,
  expirePlanning,
  serializeState,
  remainingBunkers,
  gameScore
} = require('../game');
const { createGameServer } = require('../server');

function setupRoom() {
  const { room, player: alpha } = createRoom('TEST1', 'Alpha', {
    rng: () => 0.13,
    orderSeconds: 30,
    maxDays: 30
  });
  const bravo = addPlayer(room, 'Bravo');
  startGame(room, alpha.id);
  submitSetup(room, alpha.id, [
    { siteId: 1, troopId: alpha.handTroops[0].id },
    { siteId: 2, troopId: alpha.handTroops[1].id }
  ]);
  submitSetup(room, bravo.id, [
    { siteId: 1, troopId: bravo.handTroops[0].id },
    { siteId: 2, troopId: bravo.handTroops[1].id }
  ]);
  return { room, alpha, bravo };
}

function pass(room, player) {
  submitOrder(room, player.id, { type: 'pass' });
}

test('setup creates private bunkers and begins simultaneous Day 1', () => {
  const { room, alpha, bravo } = setupRoom();
  assert.equal(room.phase, 'planning');
  assert.equal(room.day, 1);
  assert.ok(room.deadline - Date.now() > 89_000);
  assert.ok(room.deadline - Date.now() <= 90_000);
  assert.equal(remainingBunkers(alpha), 2);
  assert.equal(remainingBunkers(bravo), 2);
  assert.equal(alpha.targetId, bravo.id);
  assert.equal(bravo.targetId, alpha.id);

  const enemyView = serializeState(room, alpha.id).target;
  assert.equal(enemyView.bunkersRemaining, 2);
  assert.equal(enemyView.sites.some((site) => 'kind' in site), false);
});

test('starting bunker defenders are optional', () => {
  const { room, player: alpha } = createRoom('EMPTY', 'Alpha', { rng: () => 0.17 });
  const bravo = addPlayer(room, 'Bravo');
  startGame(room, alpha.id);

  submitSetup(room, alpha.id, [{ siteId: 1 }, { siteId: 4 }]);
  submitSetup(room, bravo.id, [{ siteId: 2, troopId: bravo.handTroops[0].id }, { siteId: 5 }]);

  assert.equal(room.phase, 'planning');
  assert.equal(alpha.handTroops.length, 8);
  assert.deepEqual(alpha.sites.filter((site) => site.kind === 'real').map((site) => site.defenders.length), [0, 0]);
  assert.equal(bravo.handTroops.length, 7);
  assert.deepEqual(bravo.sites.filter((site) => site.kind === 'real').map((site) => site.defenders.length), [1, 0]);
});

test('troop deck contains twenty plain unit types with matching portraits', () => {
  const { room } = createRoom('ROSTR', 'Alpha', { rng: () => 0.21 });
  const types = new Map(room.troopDeck.map((troop) => [troop.unit, troop]));
  assert.equal(types.size, 20);
  for (const name of ['Fodder', 'Commando', 'Dragoons', 'Grenadier', 'Ranger', 'Battle Tank', 'Siege Infantry', 'Sniper', 'Foot Soldier', 'Machine Gunner', 'Cavalry']) {
    assert.ok(types.has(name), `${name} should be in the roster`);
  }
  assert.equal(new Set([...types.values()].map((troop) => troop.art)).size, 20);
  assert.ok([...types.values()].every((troop) => !('nation' in troop) && !('sigil' in troop)));
});

test('later days reserve a 45-second order window after the cutaway', () => {
  const { room, alpha, bravo } = setupRoom();
  const resolvedAt = Date.now();
  pass(room, alpha);
  pass(room, bravo);
  assert.equal(room.day, 2);
  assert.deepEqual(
    { completedDay: room.transition.completedDay, nextDay: room.transition.nextDay },
    { completedDay: 1, nextDay: 2 }
  );
  assert.ok(room.transition.until - resolvedAt >= 2_900);
  assert.ok(room.transition.until - resolvedAt <= 3_100);
  assert.equal(room.deadline - room.transition.until, 30_000);

  const { room: defaultRoom } = createRoom('CLOCK', 'Clock');
  assert.equal(defaultRoom.orderSeconds, 45);
  assert.equal(defaultRoom.firstOrderSeconds, 90);
});

test('scout reports only after completing its full round trip', () => {
  const { room, alpha, bravo } = setupRoom();
  const scout = alpha.handTroops[0];
  scout.mobility = 3;
  submitOrder(room, alpha.id, { type: 'scout', siteId: 5, troopIds: [scout.id] });
  pass(room, bravo);

  assert.equal(room.day, 2);
  assert.equal(alpha.intel[bravo.id], undefined);
  assert.equal(room.missions[0].phase, 'outbound');

  pass(room, alpha);
  pass(room, bravo);
  assert.equal(room.day, 3);
  assert.equal(alpha.intel[bravo.id], undefined);
  assert.equal(room.missions[0].phase, 'return');

  pass(room, alpha);
  pass(room, bravo);
  assert.equal(room.day, 4);
  assert.equal(alpha.intel[bravo.id][5].status, 'clear');
  assert.ok(alpha.handTroops.some((troop) => troop.id === scout.id));
});

test('winning platoon destroys a bunker and loses one random attacker', () => {
  const { room, alpha, bravo } = setupRoom();
  const defenders = bravo.sites.find((site) => site.siteId === 1).defenders;
  defenders[0].power = 1;
  const attackers = alpha.handTroops.slice(0, 2);
  attackers[0].power = 10;
  attackers[1].power = 9;
  attackers.forEach((troop) => { troop.mobility = 3; });

  submitOrder(room, alpha.id, { type: 'attack', siteId: 1, troopIds: attackers.map((troop) => troop.id) });
  pass(room, bravo);
  assert.equal(bravo.sites.find((site) => site.siteId === 1).kind, 'real');

  pass(room, alpha);
  pass(room, bravo);

  assert.equal(bravo.sites.find((site) => site.siteId === 1).kind, 'destroyed');
  const returning = room.missions.find((mission) => mission.ownerId === alpha.id);
  assert.equal(returning.troops.length, 1);
  assert.equal(alpha.bunkersDestroyed, 1);
  assert.equal(gameScore(alpha), 3);
  assert.equal(serializeState(room, alpha.id).me.score, 3);
});

test('UAV reports anonymous total bunker defenses without counts or locations', () => {
  const { room, alpha, bravo } = setupRoom();
  const defenses = bravo.sites.filter((site) => site.kind === 'real').flatMap((site) => site.defenders);
  defenses[0].power = 7;
  defenses[1].power = 4;
  alpha.handTech = [{ id: 'uav_test', type: 'uav', name: 'UAV Sweep' }];

  submitOrder(room, alpha.id, { type: 'tech', techId: 'uav_test' });
  pass(room, bravo);

  assert.deepEqual(alpha.uavReport, {
    targetId: bravo.id,
    day: 1,
    bunkerDefenses: [6, 9]
  });
  assert.equal('defenderCount' in alpha.uavReport, false);
  assert.equal('combinedPower' in alpha.uavReport, false);
  assert.equal('bunkerPowers' in alpha.uavReport, false);
});

test('minefield removes the incoming troop with the greatest battle power', () => {
  const { room, alpha, bravo } = setupRoom();
  const targetSite = bravo.sites.find((site) => site.siteId === 1);
  targetSite.mine = true;
  targetSite.defenders[0].power = 5;
  const attackers = alpha.handTroops.slice(0, 2);
  attackers[0].power = 10;
  attackers[1].power = 2;
  attackers.forEach((troop) => { troop.mobility = 3; });

  submitOrder(room, alpha.id, { type: 'attack', siteId: 1, troopIds: attackers.map((troop) => troop.id) });
  pass(room, bravo);

  pass(room, alpha);
  pass(room, bravo);

  assert.ok(room.troopDiscard.some((troop) => troop.id === attackers[0].id));
  assert.equal(targetSite.mine, false);
  assert.equal(targetSite.kind, 'real');
});

test('signal interceptor detects attacks aimed at any of the five sites', () => {
  const { room, alpha, bravo } = setupRoom();
  bravo.radioHackerUntil = 5;
  const attacker = alpha.handTroops[0];
  attacker.mobility = 2;

  submitOrder(room, alpha.id, { type: 'attack', siteId: 5, troopIds: [attacker.id] });
  pass(room, bravo);

  const view = serializeState(room, bravo.id);
  const intercept = view.events.find((event) => event.text.startsWith('Signal intercept:'));
  assert.ok(intercept);
  assert.match(intercept.text, /Site 5/);
  assert.match(intercept.text, /1 incoming troop/);
});

test('movement launch logs name the selected site and combat is personalized', () => {
  const { room, alpha, bravo } = setupRoom();
  const attacker = alpha.handTroops[0];
  attacker.power = 1;
  attacker.mobility = 3;
  const bunker = bravo.sites.find((site) => site.siteId === 1);
  bunker.defenders[0].power = 5;

  submitOrder(room, alpha.id, { type: 'attack', siteId: 1, troopIds: [attacker.id] });
  pass(room, bravo);
  pass(room, alpha);
  pass(room, bravo);

  const attackerEvents = serializeState(room, alpha.id).events;
  const defenderEvents = serializeState(room, bravo.id).events;
  const launch = attackerEvents.find((event) => event.text.includes('Attack platoon dispatched'));
  const failure = attackerEvents.find((event) => event.text.includes('Your attack on Bunker 1 failed'));
  const defense = defenderEvents.find((event) => event.text.includes('friendly Bunker 1 was attacked and fought off'));

  assert.match(launch.text, /Site 1/);
  assert.equal(launch.day, 1);
  assert.equal(failure.tone, 'danger');
  assert.equal(failure.day, 2);
  assert.equal(defense.tone, 'success');
  assert.equal(defenderEvents.some((event) => event.text.includes('Your attack on Bunker 1 failed')), false);
});

test('Body Enhancers grant power and mobility together', () => {
  const { room, alpha, bravo } = setupRoom();
  const troop = alpha.handTroops[0];
  troop.power = 3;
  troop.mobility = 2;
  alpha.handTech = [{ id: 'body_test', type: 'cyberkinetics', name: 'Body Enhancers' }];

  submitOrder(room, alpha.id, { type: 'tech', techId: 'body_test', troopId: troop.id });
  pass(room, bravo);

  assert.equal(troop.power, 5);
  assert.equal(troop.mobility, 3);
  assert.equal(troop.upgrade, 'body');
});

test('Air Raid attacks immediately and surviving troops begin their return', () => {
  const { room, alpha, bravo } = setupRoom();
  const bunker = bravo.sites.find((site) => site.siteId === 1);
  bunker.defenders[0].power = 1;
  const attackers = alpha.handTroops.slice(0, 2);
  attackers[0].power = 10;
  attackers[1].power = 9;
  attackers.forEach((troop) => { troop.mobility = 3; });
  alpha.handTech = [{ id: 'air_test', type: 'air_raid', name: 'Air Raid' }];

  submitOrder(room, alpha.id, {
    type: 'tech',
    techId: 'air_test',
    siteId: 1,
    troopIds: attackers.map((troop) => troop.id)
  });
  pass(room, bravo);

  assert.equal(bunker.kind, 'destroyed');
  assert.equal(alpha.handTech.length, 0);
  const returning = room.missions.find((mission) => mission.ownerId === alpha.id);
  assert.equal(returning.phase, 'return');
  assert.equal(returning.airRaid, true);
  assert.equal(returning.troops.length, 1);
  assert.ok(serializeState(room, alpha.id).events.some((event) => event.text.includes('contact was immediate')));
});

test('fortification can add two troops at once when a bunker has two open slots', () => {
  const { room, alpha, bravo } = setupRoom();
  const bunker = alpha.sites.find((site) => site.siteId === 1);
  room.troopDiscard.push(...bunker.defenders.splice(0));
  const reinforcements = alpha.handTroops.slice(0, 2);

  submitOrder(room, alpha.id, {
    type: 'fortify',
    siteId: 1,
    troopIds: reinforcements.map((troop) => troop.id)
  });
  pass(room, bravo);

  assert.deepEqual(bunker.defenders.map((troop) => troop.id), reinforcements.map((troop) => troop.id));
  assert.equal(alpha.handTroops.some((troop) => reinforcements.some((item) => item.id === troop.id)), false);
});

test('Day 10 technology draws exclude held types and an active hologram', () => {
  const { room, alpha, bravo } = setupRoom();
  alpha.handTech = [{ id: 'held_uav', type: 'uav', name: 'UAV Sweep' }];
  alpha.sites.find((site) => site.siteId === 3).hologram = true;
  room.techDeck = [
    { id: 'eligible_mine', type: 'minefield', name: 'Minefield' },
    { id: 'blocked_holo', type: 'hologram', name: 'Hologram' },
    { id: 'blocked_uav', type: 'uav', name: 'UAV Sweep' }
  ];
  room.day = 10;

  pass(room, alpha);
  pass(room, bravo);

  assert.deepEqual(alpha.handTech.map((tech) => tech.type).sort(), ['minefield', 'uav']);
  assert.equal(alpha.handTech.some((tech) => tech.id === 'blocked_holo'), false);
  assert.equal(alpha.handTech.some((tech) => tech.id === 'blocked_uav'), false);
});

test('expired order clock auto-passes missing players and advances the day', () => {
  const { room, alpha, bravo } = setupRoom();
  submitOrder(room, alpha.id, { type: 'pass' });
  room.deadline = Date.now() - 1;
  assert.equal(expirePlanning(room), true);
  assert.equal(room.day, 2);
  assert.equal(alpha.order, null);
  assert.equal(bravo.order, null);
  assert.deepEqual(room.transition.missedPlayerIds, [bravo.id]);
  const bravoView = serializeState(room, bravo.id);
  const alphaView = serializeState(room, alpha.id);
  const bravoMiss = bravoView.events.find((event) => event.text.includes('You missed the order window'));
  assert.equal(bravoMiss.tone, 'danger');
  assert.equal(bravoView.room.transition.missedOrder, true);
  assert.equal(alphaView.room.transition.missedOrder, false);
  assert.equal('missedPlayerIds' in bravoView.room.transition, false);
  assert.equal(alphaView.events.some((event) => event.text.includes('missed the order window')), false);
});

test('three consecutive missed order windows cause a private forfeit', () => {
  const { room, alpha, bravo } = setupRoom();

  for (let miss = 1; miss <= 3; miss += 1) {
    pass(room, alpha);
    room.deadline = Date.now() - 1;
    assert.equal(expirePlanning(room), true);
    assert.equal(bravo.consecutiveMissedOrders, miss);
  }

  assert.equal(room.phase, 'finished');
  assert.equal(room.endReason, 'missed-orders');
  assert.equal(bravo.forfeited, true);
  assert.deepEqual(room.winnerIds, [alpha.id]);
  assert.deepEqual(room.forfeitPlayerIds, [bravo.id]);
  const alphaEvents = serializeState(room, alpha.id).events;
  assert.equal(alphaEvents.some((event) => event.text.includes('missed the order window')), false);
  assert.ok(alphaEvents.some((event) => event.text === 'Bravo forfeited the operation.'));
});

test('a missed-order forfeit removes one commander but a three-player operation continues', () => {
  const { room, player: alpha } = createRoom('MISS3', 'Alpha', { rng: () => 0.19 });
  const bravo = addPlayer(room, 'Bravo');
  const charlie = addPlayer(room, 'Charlie');
  startGame(room, alpha.id);
  for (const player of [alpha, bravo, charlie]) {
    submitSetup(room, player.id, [{ siteId: 1 }, { siteId: 2 }]);
  }
  bravo.consecutiveMissedOrders = 2;

  pass(room, alpha);
  pass(room, charlie);
  room.deadline = Date.now() - 1;
  expirePlanning(room);

  assert.equal(room.phase, 'planning');
  assert.equal(room.day, 2);
  assert.equal(bravo.forfeited, true);
  assert.equal(alpha.targetId, charlie.id);
  assert.equal(charlie.targetId, alpha.id);
  assert.equal(serializeState(room, alpha.id).players.find((player) => player.id === bravo.id).forfeited, true);
  assert.equal(serializeState(room, alpha.id).events.some((event) => event.text.includes('missed the order window')), false);
});

test('submitting an order resets the consecutive missed-order streak', () => {
  const { room, bravo } = setupRoom();
  bravo.consecutiveMissedOrders = 2;
  pass(room, bravo);
  assert.equal(bravo.consecutiveMissedOrders, 0);
});

test('reinforcements arrive on Days 5 and 10 at the approved cadence', () => {
  const { room, alpha, bravo } = setupRoom();
  assert.equal(alpha.handTroops.length, 6);
  assert.equal(alpha.handTech.length, 2);
  while (room.day <= 10) {
    pass(room, alpha);
    pass(room, bravo);
  }
  assert.equal(room.day, 11);
  assert.equal(alpha.handTroops.length, 8);
  assert.equal(alpha.handTech.length, 2);
});

test('troop and technology hands never exceed their caps', () => {
  const { room, alpha, bravo } = setupRoom();
  alpha.handTroops.push(room.troopDeck.pop(), room.troopDeck.pop());
  assert.equal(alpha.handTroops.length, 8);
  room.day = 10;
  pass(room, alpha);
  pass(room, bravo);
  assert.equal(alpha.handTroops.length, 8);
  assert.equal(alpha.handTech.length, 2);
  const view = serializeState(room, alpha.id);
  assert.equal(view.constants.maxTroopHand, 8);
  assert.equal(view.constants.maxTechHand, 2);
});

test('a newly launched attack does not expose a hologram before travel completes', () => {
  const { room, alpha, bravo } = setupRoom();
  const decoy = alpha.sites.find((site) => site.siteId === 3);
  decoy.hologram = true;
  const attacker = bravo.handTroops[0];
  attacker.mobility = 3;

  pass(room, alpha);
  submitOrder(room, bravo.id, { type: 'attack', siteId: 3, troopIds: [attacker.id] });
  assert.equal(room.day, 2);
  assert.equal(decoy.hologram, true);
  assert.equal(room.missions[0].phase, 'outbound');

  pass(room, alpha);
  pass(room, bravo);
  assert.equal(decoy.hologram, false);
  const contact = serializeState(room, bravo.id).events.find((event) => event.text.includes('struck a HOLOGRAM'));
  assert.ok(contact);
  assert.equal(contact.day, 2);
  assert.equal(bravo.intel[alpha.id][3].status, 'clear');
});

test('remaining tech effects support deception, relocation, and bunker clearing', () => {
  const { room, alpha, bravo } = setupRoom();

  alpha.handTech = [{ id: 'holo_test', type: 'hologram', name: 'Hologram' }];
  submitOrder(room, alpha.id, { type: 'tech', techId: 'holo_test', siteId: 3 });
  pass(room, bravo);
  assert.equal(alpha.sites.find((site) => site.siteId === 3).hologram, true);

  const originDefenderId = alpha.sites.find((site) => site.siteId === 1).defenders[0].id;
  alpha.handTech = [{ id: 'warp_test', type: 'teleporter', name: 'Teleporter' }];
  submitOrder(room, alpha.id, { type: 'tech', techId: 'warp_test', fromSiteId: 1, toSiteId: 5 });
  pass(room, bravo);
  assert.equal(alpha.sites.find((site) => site.siteId === 1).kind, 'empty');
  assert.equal(alpha.sites.find((site) => site.siteId === 5).kind, 'real');
  assert.equal(alpha.sites.find((site) => site.siteId === 5).defenders.length, 0);
  assert.ok(room.troopDiscard.some((troop) => troop.id === originDefenderId));

  bravo.intel[alpha.id] = { 2: { status: 'signal', day: 2, note: 'Test signal' } };
  bravo.handTech = [{ id: 'napalm_test', type: 'napalm', name: 'Napalm Strike' }];
  room.day = 23;
  pass(room, alpha);
  submitOrder(room, bravo.id, { type: 'tech', techId: 'napalm_test', siteId: 2 });
  assert.equal(alpha.sites.find((site) => site.siteId === 2).defenders.length, 0);
  assert.equal(alpha.sites.find((site) => site.siteId === 2).kind, 'real');
});

test('destroying both target bunkers ends a two-player match', () => {
  const { room, alpha, bravo } = setupRoom();
  for (const site of bravo.sites.filter((candidate) => candidate.kind === 'real')) site.defenders[0].power = 1;
  const strikeOne = alpha.handTroops[0];
  const strikeTwo = alpha.handTroops[1];
  for (const troop of [strikeOne, strikeTwo]) {
    troop.power = 10;
    troop.mobility = 3;
  }

  submitOrder(room, alpha.id, { type: 'attack', siteId: 1, troopIds: [strikeOne.id] });
  pass(room, bravo);
  assert.equal(room.phase, 'planning');

  pass(room, alpha);
  pass(room, bravo);
  assert.equal(bravo.sites.find((site) => site.siteId === 1).kind, 'destroyed');

  submitOrder(room, alpha.id, { type: 'attack', siteId: 2, troopIds: [strikeTwo.id] });
  pass(room, bravo);

  pass(room, alpha);
  pass(room, bravo);

  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.winnerIds, [alpha.id]);
  assert.equal(bravo.eliminated, true);
  assert.equal(alpha.eliminations, 1);
  const winnerMessage = serializeState(room, alpha.id).events.find((event) => event.text === 'You won the operation.');
  const loserMessage = serializeState(room, bravo.id).events.find((event) => event.text.includes('ended in defeat'));
  assert.equal(winnerMessage.tone, 'success');
  assert.equal(loserMessage.tone, 'danger');
});

test('Day 30 uses only bunkers remaining plus bunkers destroyed and equal totals draw', () => {
  const { room, alpha, bravo } = setupRoom();
  alpha.handTroops[0].power = 100;
  bravo.handTroops[0].power = 1;
  room.day = 30;

  pass(room, alpha);
  pass(room, bravo);

  assert.equal(room.phase, 'finished');
  assert.equal(room.endReason, 'day-limit');
  assert.equal(room.isDraw, true);
  assert.equal(alpha.finalScore, 2);
  assert.equal(bravo.finalScore, 2);
  assert.deepEqual(new Set(room.winnerIds), new Set([alpha.id, bravo.id]));
});

test('a two-player quit ends the game with a forfeit winner', () => {
  const { room, alpha, bravo } = setupRoom();
  quitGame(room, bravo.id);

  assert.equal(room.phase, 'finished');
  assert.equal(room.endReason, 'quit');
  assert.equal(room.quitPlayerId, bravo.id);
  assert.deepEqual(room.winnerIds, [alpha.id]);
  assert.equal(bravo.quit, true);
  assert.equal(bravo.eliminated, true);

  const view = serializeState(room, alpha.id);
  assert.equal(view.room.endReason, 'quit');
  assert.equal(view.players.find((player) => player.id === bravo.id).quit, true);
  assert.equal(view.events.find((event) => event.text.includes('win by forfeit')).tone, 'success');
  assert.equal(serializeState(room, bravo.id).events.find((event) => event.text.includes('You quit')).tone, 'danger');
});

test('a quit in a three-player game ends without declaring a winner', () => {
  const { room, player: alpha } = createRoom('QUIT3', 'Alpha', { rng: () => 0.31 });
  addPlayer(room, 'Bravo');
  const charlie = addPlayer(room, 'Charlie');
  startGame(room, alpha.id);

  quitGame(room, charlie.id);

  assert.equal(room.phase, 'finished');
  assert.equal(room.endReason, 'quit');
  assert.equal(room.quitPlayerId, charlie.id);
  assert.deepEqual(room.winnerIds, []);
  assert.ok(room.events.some((event) => event.text === 'Charlie quit. The operation has ended.'));
});

test('leaving a lobby removes the player and transfers host control', () => {
  const { room, player: alpha } = createRoom('LEAVE', 'Alpha');
  const bravo = addPlayer(room, 'Bravo');
  const outcome = quitGame(room, alpha.id);

  assert.equal(outcome.removed, true);
  assert.deepEqual(room.players.map((player) => player.id), [bravo.id]);
  assert.equal(room.hostId, bravo.id);
  assert.equal(room.phase, 'lobby');
});

test('HTTP room API supports create, join, and authenticated live state', async (t) => {
  const { server } = createGameServer({ orderSeconds: 30, hosted: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${base}/api/health`);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.build, '0.5.0');
  assert.equal(health.mode, 'local');
  assert.ok(Array.isArray(health.lanUrls));

  const createResponse = await fetch(`${base}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Alpha' })
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.session.roomCode.length, 5);

  const joinResponse = await fetch(`${base}/api/rooms/${created.session.roomCode}/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bravo' })
  });
  assert.equal(joinResponse.status, 201);
  const joined = await joinResponse.json();

  const presenceResponse = await fetch(`${base}/api/rooms/${created.session.roomCode}/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: joined.session.playerId, token: joined.session.token })
  });
  assert.equal(presenceResponse.status, 200);
  assert.equal((await presenceResponse.json()).ok, true);

  const query = new URLSearchParams({ playerId: created.session.playerId, token: created.session.token });
  const stateResponse = await fetch(`${base}/api/rooms/${created.session.roomCode}/state?${query}`);
  const payload = await stateResponse.json();
  assert.equal(payload.state.players.length, 2);

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await page.text(), /Blacksite Five/);
});

test('hosted health configuration publishes the internet origin without private addresses', async (t) => {
  const { server } = createGameServer({ hosted: true, publicUrl: 'https://blacksite-five.onrender.com' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${base}/api/health`);
  const health = await response.json();
  assert.equal(health.mode, 'hosted');
  assert.equal(health.publicUrl, 'https://blacksite-five.onrender.com');
  assert.deepEqual(health.lanUrls, []);
});

test('public room admission is rate limited', async (t) => {
  const { server } = createGameServer({ admissionLimit: 1 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const create = (name) => fetch(`${base}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
  });

  assert.equal((await create('Alpha')).status, 201);
  const limited = await create('Bravo');
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /Too many room requests/);
});

test('inactive rooms are cleaned up after their configured lifetime', async (t) => {
  const { server, rooms, cleanupRooms } = createGameServer({ roomTtlMs: 100 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Alpha' })
  });
  const created = await response.json();
  const room = rooms.get(created.session.roomCode);
  room.lastActivityAt = 1_000;

  cleanupRooms(1_101);
  assert.equal(rooms.has(created.session.roomCode), false);
});
