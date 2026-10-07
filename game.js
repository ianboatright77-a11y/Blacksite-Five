'use strict';

const crypto = require('node:crypto');

const SITE_IDS = [1, 2, 3, 4, 5];
const COLORS = ['#58e6c2', '#ff9b5e', '#8aa7ff', '#f56b9d'];
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const BUNKER_ARMOR = 2;
const MAX_GARRISON = 2;
const MAX_PLATOON = 3;
const MAX_TROOP_HAND = 8;
const MAX_TECH_HAND = 2;
const DEFAULT_ORDER_SECONDS = 45;
const DEFAULT_FIRST_ORDER_SECONDS = 90;
const DAY_TRANSITION_MS = 3_000;
const DEFAULT_MAX_DAYS = 30;
const MAX_CONSECUTIVE_MISSED_ORDERS = 3;

const TROOP_TEMPLATES = [
  { unit: 'Fodder', power: 1, mobility: 2, art: 0 },
  { unit: 'Foot Soldier', power: 2, mobility: 2, art: 1 },
  { unit: 'Scout', power: 1, mobility: 3, art: 2 },
  { unit: 'Ranger', power: 3, mobility: 3, art: 3 },
  { unit: 'Commando', power: 4, mobility: 3, art: 4 },
  { unit: 'Sniper', power: 4, mobility: 2, art: 5 },
  { unit: 'Machine Gunner', power: 4, mobility: 1, art: 6 },
  { unit: 'Grenadier', power: 4, mobility: 2, art: 7 },
  { unit: 'Combat Medic', power: 2, mobility: 2, art: 8 },
  { unit: 'Sapper', power: 3, mobility: 2, art: 9 },
  { unit: 'Dragoons', power: 3, mobility: 3, art: 10 },
  { unit: 'Cavalry', power: 2, mobility: 3, art: 11 },
  { unit: 'Shock Trooper', power: 4, mobility: 2, art: 12 },
  { unit: 'Heavy Infantry', power: 5, mobility: 1, art: 13 },
  { unit: 'Mortar Team', power: 4, mobility: 1, art: 14 },
  { unit: 'Siege Infantry', power: 5, mobility: 1, art: 15 },
  { unit: 'Tank Hunter', power: 5, mobility: 1, art: 16 },
  { unit: 'Light Tank', power: 4, mobility: 2, art: 17 },
  { unit: 'Battle Tank', power: 5, mobility: 1, art: 18 },
  { unit: 'Signal Corps', power: 2, mobility: 2, art: 19 }
];

const TECH_DEFINITIONS = {
  hologram: {
    name: 'Hologram',
    icon: 'HOLO',
    description: 'Make one empty site report as occupied until attacked.'
  },
  uav: {
    name: 'UAV Sweep',
    icon: 'UAV',
    description: 'Reveal each enemy bunker\'s total defense as anonymous readings.'
  },
  minefield: {
    name: 'Minefield',
    icon: 'MINE',
    description: 'Destroy the strongest troop in the first platoon attacking one site.'
  },
  napalm: {
    name: 'Napalm Strike',
    icon: 'FIRE',
    description: 'Remove all defenders from any site with known occupied intel.'
  },
  cyberkinetics: {
    name: 'Body Enhancers',
    icon: 'BODY',
    description: 'Give one troop in hand +2 power and +1 mobility.'
  },
  teleporter: {
    name: 'Teleporter',
    icon: 'WARP',
    description: 'Move a real bunker to an empty site and discard its garrison.'
  },
  radio_hacker: {
    name: 'Signal Interceptor',
    icon: 'SIG',
    description: 'For five days, detect platoons approaching any of your five sites.'
  },
  air_raid: {
    name: 'Air Raid',
    icon: 'AIR',
    description: 'Deploy 1–3 troops to attack one enemy site immediately.'
  }
};

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'GameError';
    this.status = status;
  }
}

function id(prefix = '') {
  return `${prefix}${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function clampName(name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!clean) throw new GameError('Enter a commander name.');
  return clean;
}

function shuffle(items, rng = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function choose(items, rng = Math.random) {
  return items[Math.floor(rng() * items.length)];
}

function travelDays(troop) {
  return 4 - troop.mobility;
}

function makeTroop(template) {
  return {
    id: id('tr_'),
    ...template,
    basePower: template.power,
    baseMobility: template.mobility,
    upgrade: null
  };
}

function makeTech(type) {
  return { id: id('tc_'), type, ...TECH_DEFINITIONS[type] };
}

function refillTroopDeck(room) {
  const cards = [];
  for (let cycle = 0; cycle < 8; cycle += 1) {
    for (const template of TROOP_TEMPLATES) cards.push(makeTroop(template));
  }
  room.troopDeck.push(...shuffle(cards, room.rng));
}

function refillTechDeck(room) {
  const types = Object.keys(TECH_DEFINITIONS);
  const cards = [];
  for (let cycle = 0; cycle < 10; cycle += 1) {
    for (const type of types) cards.push(makeTech(type));
  }
  room.techDeck.push(...shuffle(cards, room.rng));
}

function drawTroop(room) {
  if (!room.troopDeck.length) refillTroopDeck(room);
  return room.troopDeck.pop();
}

function drawTech(room) {
  if (!room.techDeck.length) refillTechDeck(room);
  return room.techDeck.pop();
}

function drawTechForPlayer(room, player) {
  const excludedTypes = new Set(player.handTech.map((tech) => tech.type));
  if (player.sites.some((site) => site.hologram)) excludedTypes.add('hologram');
  const held = [];
  let selected = null;
  for (let attempt = 0; attempt < 200 && !selected; attempt += 1) {
    const card = drawTech(room);
    if (excludedTypes.has(card.type)) held.push(card);
    else selected = card;
  }
  room.techDeck.unshift(...held);
  if (!selected) throw new GameError('No eligible technology card is available.', 503);
  return selected;
}

function addTroopsToHand(room, player, troops) {
  const combined = [...player.handTroops, ...troops];
  if (combined.length <= MAX_TROOP_HAND) {
    player.handTroops = combined;
    return;
  }

  const ranked = combined
    .map((troop, index) => ({ troop, index }))
    .sort((left, right) => (
      right.troop.power - left.troop.power
      || right.troop.mobility - left.troop.mobility
      || left.index - right.index
    ));
  const keptIds = new Set(ranked.slice(0, MAX_TROOP_HAND).map(({ troop }) => troop.id));
  const overflow = combined.filter((troop) => !keptIds.has(troop.id));
  player.handTroops = combined.filter((troop) => keptIds.has(troop.id));
  room.troopDiscard.push(...overflow);
  addEvent(
    room,
    `Hand limit reached: ${overflow.map((troop) => troop.unit).join(', ')} ${overflow.length === 1 ? 'was' : 'were'} demobilized. The strongest eight troops remain ready.`,
    'warning',
    [player.id]
  );
}

function drawUniqueStartingTech(room, count) {
  const result = [];
  const held = [];
  const types = new Set();
  while (result.length < count) {
    const card = drawTech(room);
    if (!types.has(card.type)) {
      types.add(card.type);
      result.push(card);
    } else {
      held.push(card);
    }
  }
  room.techDeck.unshift(...held);
  return result;
}

function emptySites() {
  return SITE_IDS.map((siteId) => ({
    siteId,
    kind: 'empty',
    defenders: [],
    hologram: false,
    mine: false
  }));
}

function newPlayer(name, index) {
  return {
    id: id('pl_'),
    token: id('key_'),
    name: clampName(name),
    color: COLORS[index],
    connected: true,
    active: true,
    eliminated: false,
    forfeited: false,
    quit: false,
    eliminatedDay: null,
    handTroops: [],
    handTech: [],
    sites: emptySites(),
    mulliganUsed: false,
    setupComplete: false,
    targetId: null,
    hunterId: null,
    order: null,
    consecutiveMissedOrders: 0,
    radioHackerUntil: 0,
    intel: {},
    uavReport: null,
    bunkersDestroyed: 0,
    eliminations: 0,
    finalScore: null
  };
}

function createRoom(code, hostName, options = {}) {
  const room = {
    code,
    status: 'lobby',
    phase: 'lobby',
    hostId: null,
    players: [],
    seating: [],
    day: 0,
    maxDays: options.maxDays || DEFAULT_MAX_DAYS,
    orderSeconds: options.orderSeconds || DEFAULT_ORDER_SECONDS,
    firstOrderSeconds: options.firstOrderSeconds || DEFAULT_FIRST_ORDER_SECONDS,
    deadline: null,
    transition: null,
    troopDeck: [],
    techDeck: [],
    troopDiscard: [],
    techDiscard: [],
    missions: [],
    events: [],
    winnerIds: [],
    isDraw: false,
    endReason: null,
    quitPlayerId: null,
    forfeitPlayerIds: [],
    revision: 0,
    createdAt: Date.now(),
    rng: options.rng || Math.random
  };
  refillTroopDeck(room);
  refillTechDeck(room);
  const host = addPlayer(room, hostName);
  room.hostId = host.id;
  addEvent(room, `${host.name} opened command channel ${code}.`, 'system', 'all');
  return { room, player: host };
}

function addPlayer(room, name) {
  if (room.status !== 'lobby') throw new GameError('That operation is already underway.');
  if (room.players.length >= MAX_PLAYERS) throw new GameError('This room is full.');
  const clean = clampName(name);
  if (room.players.some((player) => player.name.toLowerCase() === clean.toLowerCase())) {
    throw new GameError('That commander name is already in use.');
  }
  const player = newPlayer(clean, room.players.length);
  room.players.push(player);
  room.revision += 1;
  if (room.players.length > 1) addEvent(room, `${player.name} joined the operation.`, 'system', 'all');
  return player;
}

function getPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function authenticate(room, playerId, token) {
  const player = getPlayer(room, playerId);
  if (!player || player.token !== token) throw new GameError('Player session not found.', 401);
  return player;
}

function addEvent(room, text, tone = 'info', audience = 'all', details = null) {
  room.events.push({ id: id('ev_'), day: room.day, text, tone, audience, details, createdAt: Date.now() });
  if (room.events.length > 1200) room.events.splice(0, room.events.length - 1200);
}

function addPerspectiveEvents(room, perspectives, observer = null) {
  const participantIds = new Set();
  for (const perspective of perspectives) {
    if (!perspective?.playerId) continue;
    participantIds.add(perspective.playerId);
    addEvent(room, perspective.text, perspective.tone, [perspective.playerId]);
  }
  if (!observer?.text) return;
  const observers = room.players
    .map((player) => player.id)
    .filter((playerId) => !participantIds.has(playerId));
  if (observers.length) addEvent(room, observer.text, observer.tone || 'info', observers);
}

function startGame(room, requesterId) {
  if (room.status !== 'lobby') throw new GameError('The game has already started.');
  if (room.hostId !== requesterId) throw new GameError('Only the host can start the game.', 403);
  if (room.players.length < MIN_PLAYERS) throw new GameError('At least two commanders are required.');

  room.seating = shuffle(room.players.map((player) => player.id), room.rng);
  for (const player of room.players) {
    player.handTroops = Array.from({ length: 8 }, () => drawTroop(room));
    player.handTech = drawUniqueStartingTech(room, 2);
    player.sites = emptySites();
    player.mulliganUsed = false;
    player.active = true;
    player.eliminated = false;
    player.forfeited = false;
    player.quit = false;
    player.eliminatedDay = null;
    player.setupComplete = false;
    player.order = null;
    player.consecutiveMissedOrders = 0;
    player.radioHackerUntil = 0;
    player.intel = {};
    player.uavReport = null;
    player.bunkersDestroyed = 0;
    player.eliminations = 0;
    player.finalScore = null;
  }
  room.winnerIds = [];
  room.isDraw = false;
  room.endReason = null;
  room.quitPlayerId = null;
  room.forfeitPlayerIds = [];
  assignTargets(room);
  room.status = 'setup';
  room.phase = 'setup';
  addEvent(room, 'Operation started. Select two real bunkers; starting defenders are optional.', 'system', 'all');
  room.revision += 1;
}

function assignTargets(room) {
  const activeIds = room.seating.filter((playerId) => {
    const player = getPlayer(room, playerId);
    return player && !player.eliminated;
  });
  for (const player of room.players) {
    player.targetId = null;
    player.hunterId = null;
  }
  if (activeIds.length < 2) return;
  for (let i = 0; i < activeIds.length; i += 1) {
    const player = getPlayer(room, activeIds[i]);
    const target = getPlayer(room, activeIds[(i + 1) % activeIds.length]);
    player.targetId = target.id;
    target.hunterId = player.id;
  }
}

function mulligan(room, playerId, troopIds) {
  if (room.phase !== 'setup') throw new GameError('The exchange window is closed.');
  const player = getPlayer(room, playerId);
  if (!player || player.eliminated) throw new GameError('Player not found.');
  if (player.setupComplete) throw new GameError('Your deployment is already locked.');
  if (player.mulliganUsed) throw new GameError('You have already exchanged troops.');
  const unique = [...new Set(troopIds || [])];
  if (unique.length < 1 || unique.length > 2) throw new GameError('Exchange one or two troop cards.');
  const selected = unique.map((troopId) => player.handTroops.find((troop) => troop.id === troopId));
  if (selected.some((troop) => !troop)) throw new GameError('One of those troops is no longer in hand.');
  player.handTroops = player.handTroops.filter((troop) => !unique.includes(troop.id));
  room.troopDiscard.push(...selected);
  player.handTroops.push(...unique.map(() => drawTroop(room)));
  player.mulliganUsed = true;
  addEvent(room, 'Your troop exchange is complete.', 'success', [player.id]);
  room.revision += 1;
}

function submitSetup(room, playerId, bunkers) {
  if (room.phase !== 'setup') throw new GameError('Deployment is not available now.');
  const player = getPlayer(room, playerId);
  if (!player || player.eliminated) throw new GameError('Player not found.');
  if (player.setupComplete) throw new GameError('Your deployment is already locked.');
  if (!Array.isArray(bunkers) || bunkers.length !== 2) throw new GameError('Select exactly two bunkers.');
  const siteIds = bunkers.map((entry) => Number(entry.siteId));
  const troopIds = bunkers.map((entry) => entry.troopId || null).filter(Boolean);
  if (new Set(siteIds).size !== 2 || siteIds.some((siteId) => !SITE_IDS.includes(siteId))) {
    throw new GameError('Select two different bunker sites.');
  }
  if (new Set(troopIds).size !== troopIds.length) throw new GameError('A troop can defend only one starting bunker.');
  const troops = troopIds.map((troopId) => player.handTroops.find((troop) => troop.id === troopId));
  if (troops.some((troop) => !troop)) throw new GameError('A selected defender is no longer available.');
  const troopsById = new Map(troops.map((troop) => [troop.id, troop]));

  player.handTroops = player.handTroops.filter((troop) => !troopIds.includes(troop.id));
  bunkers.forEach((entry) => {
    const site = player.sites.find((candidate) => candidate.siteId === Number(entry.siteId));
    site.kind = 'real';
    site.defenders = entry.troopId ? [troopsById.get(entry.troopId)] : [];
  });
  player.setupComplete = true;
  addEvent(room, `${player.name} locked their bunker network.`, 'system', 'all');

  if (room.players.every((candidate) => candidate.setupComplete)) {
    room.status = 'playing';
    room.phase = 'planning';
    room.day = 1;
    room.transition = null;
    room.deadline = Date.now() + room.firstOrderSeconds * 1000;
    addEvent(room, 'Day 1 has begun. Submit one secret order.', 'system', 'all');
  }
  room.revision += 1;
}

function findTroopsInHand(player, troopIds, min, max) {
  const unique = [...new Set(troopIds || [])];
  if (unique.length < min || unique.length > max) {
    throw new GameError(`Select ${min === max ? min : `${min}-${max}`} troop card${max === 1 ? '' : 's'}.`);
  }
  const troops = unique.map((troopId) => player.handTroops.find((troop) => troop.id === troopId));
  if (troops.some((troop) => !troop)) throw new GameError('One of those troops is no longer in hand.');
  return troops;
}

function targetOf(room, player) {
  const target = getPlayer(room, player.targetId);
  if (!target || target.eliminated) throw new GameError('No active target is available.');
  return target;
}

function validateSite(siteId) {
  const value = Number(siteId);
  if (!SITE_IDS.includes(value)) throw new GameError('Choose a valid bunker site.');
  return value;
}

function positiveIntel(player, targetId, siteId) {
  const intel = player.intel[targetId]?.[siteId];
  return Boolean(intel && ['signal', 'real'].includes(intel.status));
}

function normalizeOrder(room, player, raw) {
  const type = raw?.type;
  if (!type) throw new GameError('Choose an order.');
  if (type === 'pass') return { type: 'pass' };

  if (type === 'attack') {
    targetOf(room, player);
    const siteId = validateSite(raw.siteId);
    const troops = findTroopsInHand(player, raw.troopIds, 1, MAX_PLATOON);
    return { type, siteId, troopIds: troops.map((troop) => troop.id) };
  }
  if (type === 'scout') {
    targetOf(room, player);
    const siteId = validateSite(raw.siteId);
    const [troop] = findTroopsInHand(player, raw.troopIds, 1, 1);
    return { type, siteId, troopIds: [troop.id] };
  }
  if (type === 'fortify') {
    const siteId = validateSite(raw.siteId);
    const site = player.sites.find((candidate) => candidate.siteId === siteId);
    if (site.kind !== 'real') throw new GameError('Only a real bunker can be fortified.');
    if (site.defenders.length >= MAX_GARRISON) throw new GameError('That bunker already has its maximum garrison.');
    const openSlots = MAX_GARRISON - site.defenders.length;
    const troops = findTroopsInHand(player, raw.troopIds, 1, Math.min(2, openSlots));
    return { type, siteId, troopIds: troops.map((troop) => troop.id) };
  }
  if (type === 'tech') {
    const card = player.handTech.find((tech) => tech.id === raw.techId);
    if (!card) throw new GameError('Choose an available technology card.');
    const order = { type, techId: card.id, techType: card.type };
    switch (card.type) {
      case 'hologram': {
        order.siteId = validateSite(raw.siteId);
        const site = player.sites.find((candidate) => candidate.siteId === order.siteId);
        if (site.kind !== 'empty' || site.hologram) throw new GameError('Holograms require a clean, empty site.');
        if (player.sites.some((candidate) => candidate.hologram)) throw new GameError('Only one hologram can be active at a time.');
        break;
      }
      case 'uav':
        targetOf(room, player);
        break;
      case 'minefield': {
        order.siteId = validateSite(raw.siteId);
        const site = player.sites.find((candidate) => candidate.siteId === order.siteId);
        if (site.kind === 'destroyed' || site.mine) throw new GameError('That approach cannot be mined.');
        break;
      }
      case 'napalm':
        targetOf(room, player);
        order.siteId = validateSite(raw.siteId);
        if (!positiveIntel(player, player.targetId, order.siteId)) {
          throw new GameError('Napalm requires a known occupied signal.');
        }
        break;
      case 'cyberkinetics': {
        const [troop] = findTroopsInHand(player, [raw.troopId], 1, 1);
        order.troopId = troop.id;
        break;
      }
      case 'teleporter': {
        order.fromSiteId = validateSite(raw.fromSiteId);
        order.toSiteId = validateSite(raw.toSiteId);
        if (order.fromSiteId === order.toSiteId) throw new GameError('Choose a different destination.');
        const origin = player.sites.find((candidate) => candidate.siteId === order.fromSiteId);
        const destination = player.sites.find((candidate) => candidate.siteId === order.toSiteId);
        if (origin.kind !== 'real') throw new GameError('The origin must be a real bunker.');
        if (destination.kind !== 'empty' || destination.hologram) throw new GameError('The destination must be a clean, empty site.');
        break;
      }
      case 'radio_hacker':
        break;
      case 'air_raid': {
        targetOf(room, player);
        order.siteId = validateSite(raw.siteId);
        const troops = findTroopsInHand(player, raw.troopIds, 1, MAX_PLATOON);
        order.troopIds = troops.map((troop) => troop.id);
        break;
      }
      default:
        throw new GameError('Unknown technology card.');
    }
    return order;
  }
  throw new GameError('Unknown order type.');
}

function submitOrder(room, playerId, rawOrder) {
  if (room.phase !== 'planning') throw new GameError('Orders are not being accepted now.');
  const player = getPlayer(room, playerId);
  if (!player || player.eliminated) throw new GameError('You are not an active commander.');
  if (player.order) throw new GameError('Your order is already locked.');
  player.order = normalizeOrder(room, player, rawOrder);
  player.consecutiveMissedOrders = 0;
  addEvent(room, 'Order locked. Waiting for other commanders.', 'success', [player.id]);
  room.revision += 1;
  if (activePlayers(room).every((candidate) => candidate.order)) resolveDay(room);
}

function activePlayers(room) {
  return room.players.filter((player) => !player.eliminated);
}

function removeTroopsFromHand(player, troopIds) {
  const selected = troopIds.map((troopId) => player.handTroops.find((troop) => troop.id === troopId)).filter(Boolean);
  player.handTroops = player.handTroops.filter((troop) => !troopIds.includes(troop.id));
  return selected;
}

function consumeTech(room, player, techId) {
  const index = player.handTech.findIndex((tech) => tech.id === techId);
  if (index < 0) return null;
  const [card] = player.handTech.splice(index, 1);
  room.techDiscard.push(card);
  return card;
}

function processImmediateOrder(room, player, order) {
  if (!order || order.type === 'pass' || ['attack', 'scout'].includes(order.type)) return;
  if (order.type === 'fortify') {
    const troops = removeTroopsFromHand(player, order.troopIds);
    const site = player.sites.find((candidate) => candidate.siteId === order.siteId);
    if (troops.length && site.kind === 'real' && site.defenders.length < MAX_GARRISON) {
      const availableSlots = MAX_GARRISON - site.defenders.length;
      const placed = troops.slice(0, availableSlots);
      const returned = troops.slice(availableSlots);
      site.defenders.push(...placed);
      if (returned.length) addTroopsToHand(room, player, returned);
      addEvent(
        room,
        `Bunker ${site.siteId} received ${placed.map((troop) => troop.unit).join(' and ')}.`,
        'success',
        [player.id]
      );
    } else if (troops.length) {
      addTroopsToHand(room, player, troops);
      addEvent(room, 'Fortification failed because the bunker was no longer available.', 'warning', [player.id]);
    }
    return;
  }

  const card = consumeTech(room, player, order.techId);
  if (!card) return;
  const target = player.targetId ? getPlayer(room, player.targetId) : null;
  if (card.type === 'hologram') {
    const site = player.sites.find((candidate) => candidate.siteId === order.siteId);
    if (site.kind === 'empty' && !site.hologram) {
      site.hologram = true;
      addEvent(room, `Hologram activated at Site ${site.siteId}.`, 'success', [player.id]);
    }
  } else if (card.type === 'uav' && target) {
    const realSites = target.sites.filter((site) => site.kind === 'real');
    const bunkerDefenses = shuffle(
      realSites.map((site) => BUNKER_ARMOR + site.defenders.reduce((sum, troop) => sum + troop.power, 0)),
      room.rng
    );
    player.uavReport = {
      targetId: target.id,
      day: room.day,
      bunkerDefenses
    };
    addEvent(
      room,
      `UAV report: anonymous total defense reading${bunkerDefenses.length === 1 ? '' : 's'} ${bunkerDefenses.join(' and ')}. Locations are excluded.`,
      'intel',
      [player.id]
    );
  } else if (card.type === 'minefield') {
    const site = player.sites.find((candidate) => candidate.siteId === order.siteId);
    if (site.kind !== 'destroyed') {
      site.mine = true;
      addEvent(room, `Minefield armed at Site ${site.siteId}.`, 'success', [player.id]);
    }
  } else if (card.type === 'napalm' && target) {
    const site = target.sites.find((candidate) => candidate.siteId === order.siteId);
    if (site.hologram) {
      site.hologram = false;
      setIntel(player, target.id, site.siteId, 'clear', room.day, 'Napalm burned away a hologram.');
      addPerspectiveEvents(room, [
        { playerId: player.id, text: `Your Napalm Strike at Site ${site.siteId} destroyed an enemy hologram.`, tone: 'success' },
        { playerId: target.id, text: `Enemy napalm destroyed your hologram at Site ${site.siteId}.`, tone: 'danger' }
      ]);
    } else if (site.kind === 'real') {
      const removed = site.defenders.splice(0);
      room.troopDiscard.push(...removed);
      setIntel(player, target.id, site.siteId, 'real', room.day, 'Napalm confirmed a real bunker.');
      addPerspectiveEvents(room, [
        { playerId: player.id, text: `Your Napalm Strike stripped ${removed.length} defender${removed.length === 1 ? '' : 's'} from enemy Bunker ${site.siteId}.`, tone: 'success' },
        { playerId: target.id, text: `Enemy napalm stripped ${removed.length} defender${removed.length === 1 ? '' : 's'} from your Bunker ${site.siteId}.`, tone: 'danger' }
      ]);
    } else {
      setIntel(player, target.id, site.siteId, 'clear', room.day, 'Napalm found no active bunker.');
      addPerspectiveEvents(room, [
        { playerId: player.id, text: `Your Napalm Strike at Site ${site.siteId} found nothing.`, tone: 'danger' },
        { playerId: target.id, text: `An enemy Napalm Strike missed your bunkers at Site ${site.siteId}.`, tone: 'success' }
      ]);
    }
  } else if (card.type === 'cyberkinetics') {
    const troop = player.handTroops.find((candidate) => candidate.id === order.troopId);
    if (troop) {
      troop.power += 2;
      troop.mobility = Math.min(3, troop.mobility + 1);
      troop.upgrade = 'body';
      addEvent(room, `${troop.unit} received Body Enhancers: +2 power and +1 mobility.`, 'success', [player.id]);
    }
  } else if (card.type === 'teleporter') {
    const origin = player.sites.find((candidate) => candidate.siteId === order.fromSiteId);
    const destination = player.sites.find((candidate) => candidate.siteId === order.toSiteId);
    if (origin.kind === 'real' && destination.kind === 'empty' && !destination.hologram) {
      room.troopDiscard.push(...origin.defenders);
      origin.defenders = [];
      origin.kind = 'empty';
      origin.mine = false;
      destination.kind = 'real';
      destination.defenders = [];
      addEvent(room, `${player.name} transferred a bunker. Origin and destination remain classified.`, 'warning', 'all');
      addEvent(room, `Bunker ${order.fromSiteId} transferred to Site ${order.toSiteId}; its defenders were lost.`, 'danger', [player.id]);
    }
  } else if (card.type === 'radio_hacker') {
    player.radioHackerUntil = Math.max(player.radioHackerUntil, room.day + 4);
    addEvent(room, `Signal Interceptor is monitoring all five sites through Day ${player.radioHackerUntil}.`, 'success', [player.id]);
  } else if (card.type === 'air_raid' && target) {
    const troops = removeTroopsFromHand(player, order.troopIds);
    if (!troops.length || target.eliminated) {
      addTroopsToHand(room, player, troops);
      addEvent(room, 'Air Raid canceled because its target was no longer available.', 'warning', [player.id]);
      return;
    }
    const travelTime = Math.max(...troops.map(travelDays));
    const mission = {
      id: id('ms_'),
      type: 'attack',
      phase: 'outbound',
      ownerId: player.id,
      targetId: target.id,
      targetSiteId: order.siteId,
      troops,
      travelTime,
      eta: 0,
      launchedDay: room.day,
      report: null,
      airRaid: true
    };
    addEvent(
      room,
      `Air Raid deployed ${troops.length} troop${troops.length === 1 ? '' : 's'} to ${target.name}'s Site ${order.siteId}; contact was immediate.`,
      'info',
      [player.id]
    );
    const returning = resolveAttackArrival(room, mission);
    if (returning) {
      returning.returnStartedDay = room.day;
      room.missions.push(returning);
    }
  }
}

function launchMovementOrder(room, player, order) {
  if (!order || !['attack', 'scout'].includes(order.type)) return;
  const troops = removeTroopsFromHand(player, order.troopIds);
  if (!troops.length) return;
  const target = getPlayer(room, player.targetId);
  if (!target || target.eliminated) {
    addTroopsToHand(room, player, troops);
    addEvent(room, 'Mission canceled because the assigned target is no longer active.', 'warning', [player.id]);
    return;
  }
  const travelTime = Math.max(...troops.map(travelDays));
  const mission = {
    id: id('ms_'),
    type: order.type,
    phase: 'outbound',
    ownerId: player.id,
    targetId: target.id,
    targetSiteId: order.siteId,
    troops,
    travelTime,
    eta: travelTime,
    launchedDay: room.day,
    report: null
  };
  room.missions.push(mission);
  addEvent(
    room,
    `${order.type === 'attack' ? 'Attack platoon' : 'Scout'} dispatched to ${target.name}'s Site ${order.siteId}; estimated outbound travel ${travelTime} day${travelTime === 1 ? '' : 's'}.`,
    'info',
    [player.id]
  );
  if (order.type === 'attack' && target.radioHackerUntil >= room.day) {
    addEvent(
      room,
      `Signal intercept: ${troops.length} incoming troop${troops.length === 1 ? '' : 's'} detected toward Site ${order.siteId}, arriving in ${travelTime} day${travelTime === 1 ? '' : 's'}.`,
      'danger',
      [target.id]
    );
  }
}

function setIntel(player, targetId, siteId, status, day, note) {
  if (!player.intel[targetId]) player.intel[targetId] = {};
  player.intel[targetId][siteId] = { status, day, note };
}

function returnMission(mission, troops, report = null) {
  if (!troops.length) return null;
  return { ...mission, id: id('ms_'), phase: 'return', troops, eta: mission.travelTime, report };
}

function triggerMine(room, mission, target, site) {
  if (!site.mine || !mission.troops.length) return;
  site.mine = false;
  const highest = Math.max(...mission.troops.map((troop) => troop.power));
  const candidates = mission.troops.filter((troop) => troop.power === highest);
  const casualty = choose(candidates, room.rng);
  mission.troops = mission.troops.filter((troop) => troop.id !== casualty.id);
  room.troopDiscard.push(casualty);
  addPerspectiveEvents(room, [
    {
      playerId: mission.ownerId,
      text: `Your attack on Site ${site.siteId} hit a minefield. ${casualty.unit}, your strongest troop, was destroyed.`,
      tone: 'danger'
    },
    {
      playerId: target.id,
      text: `Your minefield at Site ${site.siteId} destroyed the enemy platoon's strongest troop (${casualty.unit}).`,
      tone: 'success'
    }
  ]);
}

function resolveAttackArrival(room, mission) {
  const attacker = getPlayer(room, mission.ownerId);
  const target = getPlayer(room, mission.targetId);
  if (!attacker || !target || target.eliminated) return returnMission(mission, mission.troops, 'canceled');
  const site = target.sites.find((candidate) => candidate.siteId === mission.targetSiteId);
  triggerMine(room, mission, target, site);
  if (!mission.troops.length) {
    addEvent(room, `Your attack on Site ${site.siteId} was eliminated before contact.`, 'danger', [attacker.id]);
    return null;
  }

  if (site.kind === 'real') {
    const attackPower = mission.troops.reduce((sum, troop) => sum + troop.power, 0);
    const troopDefense = site.defenders.reduce((sum, troop) => sum + troop.power, 0);
    const defensePower = troopDefense + BUNKER_ARMOR;
    setIntel(attacker, target.id, site.siteId, 'real', room.day, 'Combat confirmed a real bunker.');
    if (attackPower > defensePower) {
      room.troopDiscard.push(...site.defenders);
      site.defenders = [];
      site.kind = 'destroyed';
      site.hologram = false;
      site.mine = false;
      attacker.bunkersDestroyed += 1;
      target.pendingEliminatedBy = attacker.id;
      setIntel(attacker, target.id, site.siteId, 'destroyed', room.day, 'Bunker destroyed.');

      const casualty = choose(mission.troops, room.rng);
      const survivors = mission.troops.filter((troop) => troop.id !== casualty.id);
      room.troopDiscard.push(casualty);
      addPerspectiveEvents(room, [
        {
          playerId: attacker.id,
          text: `Your attack destroyed enemy Bunker ${site.siteId} (${attackPower} vs ${defensePower}). Random attrition claimed ${casualty.unit}.`,
          tone: 'success'
        },
        {
          playerId: target.id,
          text: `Your Bunker ${site.siteId} was destroyed by ${attacker.name} (${defensePower} defense vs ${attackPower} attack). Its defenders were lost.`,
          tone: 'danger'
        }
      ], {
        text: `${attacker.name} destroyed one of ${target.name}'s real bunkers.`,
        tone: 'info'
      });
      return returnMission(mission, survivors, 'victory');
    }

    room.troopDiscard.push(...mission.troops);
    addPerspectiveEvents(room, [
      {
        playerId: attacker.id,
        text: `Your attack on Bunker ${site.siteId} failed (${attackPower} attack vs ${defensePower} defense). Your platoon was lost.`,
        tone: 'danger'
      },
      {
        playerId: target.id,
        text: `Your friendly Bunker ${site.siteId} was attacked and fought off the attacker (${defensePower} defense vs ${attackPower} attack).`,
        tone: 'success'
      }
    ]);
    return null;
  }

  if (site.hologram) {
    site.hologram = false;
    setIntel(attacker, target.id, site.siteId, 'clear', room.day, 'Attack exposed and destroyed a hologram.');
    addPerspectiveEvents(room, [
      {
        playerId: attacker.id,
        text: `Your attack on Site ${site.siteId} struck a HOLOGRAM. The decoy collapsed and your platoon began returning.`,
        tone: 'intel'
      },
      {
        playerId: target.id,
        text: `Your hologram at Site ${site.siteId} diverted an enemy attack successfully, then collapsed.`,
        tone: 'success'
      }
    ]);
    return returnMission(mission, mission.troops, 'decoy');
  }

  return returnMission(mission, mission.troops, 'clear');
}

function resolveScoutArrival(room, mission) {
  const target = getPlayer(room, mission.targetId);
  if (!target || target.eliminated) return returnMission(mission, mission.troops, 'canceled');
  const site = target.sites.find((candidate) => candidate.siteId === mission.targetSiteId);
  const report = site.kind === 'real' || site.hologram ? 'signal' : 'clear';
  return returnMission(mission, mission.troops, report);
}

function completeReturn(room, mission) {
  const owner = getPlayer(room, mission.ownerId);
  if (!owner || owner.eliminated) {
    room.troopDiscard.push(...mission.troops);
    return;
  }
  addTroopsToHand(room, owner, mission.troops);
  if (mission.type === 'scout') {
    if (mission.report === 'signal') {
      setIntel(owner, mission.targetId, mission.targetSiteId, 'signal', room.day, 'Scout detected an occupied signal; it may be real or holographic.');
      addEvent(room, `Scout mission succeeded: Site ${mission.targetSiteId} shows an OCCUPIED signal.`, 'success', [owner.id]);
    } else if (mission.report === 'clear') {
      setIntel(owner, mission.targetId, mission.targetSiteId, 'clear', room.day, 'Scout found no occupied signal.');
      addEvent(room, `Scout mission succeeded: Site ${mission.targetSiteId} appears CLEAR.`, 'success', [owner.id]);
    } else {
      addEvent(room, `Scout mission to Site ${mission.targetSiteId} failed because its target operation ended.`, 'danger', [owner.id]);
    }
  } else {
    if (mission.report === 'decoy') {
      addEvent(room, `Your platoon returned from Site ${mission.targetSiteId} after exposing a hologram.`, 'info', [owner.id]);
    } else if (mission.report === 'clear') {
      setIntel(owner, mission.targetId, mission.targetSiteId, 'clear', room.day, 'Attack found no active bunker.');
      addEvent(room, `Your attack on Site ${mission.targetSiteId} found it EMPTY. The platoon returned.`, 'danger', [owner.id]);
    } else {
      addEvent(room, `${mission.troops.length} surviving troop${mission.troops.length === 1 ? '' : 's'} returned from the successful attack on Site ${mission.targetSiteId}.`, 'success', [owner.id]);
    }
  }
}

function advanceMissions(room) {
  const advancing = room.missions;
  const next = [];
  room.missions = [];
  for (const mission of advancing) {
    if (mission.phase === 'outbound' && mission.launchedDay === room.day) {
      next.push(mission);
      continue;
    }
    if (mission.phase === 'return' && mission.returnStartedDay === room.day) {
      next.push(mission);
      continue;
    }
    mission.eta -= 1;
    if (mission.eta > 0) {
      next.push(mission);
      continue;
    }
    if (mission.phase === 'return') {
      completeReturn(room, mission);
      continue;
    }
    const returning = mission.type === 'attack'
      ? resolveAttackArrival(room, mission)
      : resolveScoutArrival(room, mission);
    if (returning) next.push(returning);
  }
  room.missions = next;
}

function remainingBunkers(player) {
  return player.sites.filter((site) => site.kind === 'real').length;
}

function gameScore(player) {
  return remainingBunkers(player) + player.bunkersDestroyed;
}

function forfeitMissedOrders(room, player) {
  player.forfeited = true;
  player.eliminated = true;
  player.active = false;
  player.eliminatedDay = room.day;
  player.order = null;
  if (!room.forfeitPlayerIds.includes(player.id)) room.forfeitPlayerIds.push(player.id);
  addEvent(room, 'You forfeited after missing three consecutive order windows.', 'danger', [player.id]);
  const observers = room.players
    .filter((candidate) => candidate.id !== player.id && !candidate.eliminated)
    .map((candidate) => candidate.id);
  if (observers.length) addEvent(room, `${player.name} forfeited the operation.`, 'warning', observers);
}

function processEliminations(room) {
  for (const player of room.players) {
    if (!player.eliminated && player.setupComplete && remainingBunkers(player) === 0) {
      player.eliminated = true;
      player.active = false;
      player.eliminatedDay = room.day;
      const eliminator = getPlayer(room, player.pendingEliminatedBy);
      if (eliminator && !eliminator.eliminated) {
        eliminator.eliminations += 1;
        addPerspectiveEvents(room, [
          {
            playerId: eliminator.id,
            text: `You eliminated ${player.name} by destroying their final bunker.`,
            tone: 'success'
          },
          {
            playerId: player.id,
            text: `${eliminator.name} destroyed your final bunker. Your command network was eliminated.`,
            tone: 'danger'
          }
        ], {
          text: `${eliminator.name} eliminated ${player.name}.`,
          tone: 'info'
        });
      } else {
        addEvent(room, 'Your command network was eliminated.', 'danger', [player.id]);
        const observers = room.players.filter((candidate) => candidate.id !== player.id).map((candidate) => candidate.id);
        if (observers.length) addEvent(room, `${player.name}'s command network was eliminated.`, 'info', observers);
      }
    }
    delete player.pendingEliminatedBy;
  }

  const eliminatedIds = new Set(room.players.filter((player) => player.eliminated).map((player) => player.id));
  const kept = [];
  for (const mission of room.missions) {
    const owner = getPlayer(room, mission.ownerId);
    if (eliminatedIds.has(mission.ownerId)) {
      room.troopDiscard.push(...mission.troops);
    } else if (eliminatedIds.has(mission.targetId)) {
      addTroopsToHand(room, owner, mission.troops);
      addEvent(room, 'A mission was recalled because its target was eliminated.', 'warning', [owner.id]);
    } else {
      kept.push(mission);
    }
  }
  room.missions = kept;
  assignTargets(room);
}

function endGame(room, reason) {
  room.status = 'finished';
  room.phase = 'finished';
  room.deadline = null;
  room.transition = null;
  room.endReason = reason;
  room.quitPlayerId = null;
  for (const player of room.players) {
    player.finalScore = gameScore(player);
  }
  const active = activePlayers(room);
  room.isDraw = false;
  if (active.length === 1 && ['last-standing', 'missed-orders'].includes(reason)) {
    room.winnerIds = [active[0].id];
  } else {
    const stillEligible = room.players.filter((player) => !player.forfeited && !player.quit);
    const eligible = active.length ? active : stillEligible.length ? stillEligible : room.players;
    const topScore = Math.max(...eligible.map((player) => player.finalScore));
    const winners = eligible.filter((player) => player.finalScore === topScore);
    room.winnerIds = winners.map((player) => player.id);
    room.isDraw = winners.length > 1;
  }
  const winnerNames = room.winnerIds.map((winnerId) => getPlayer(room, winnerId)?.name).filter(Boolean);
  const winnerIdSet = new Set(room.winnerIds);
  for (const player of room.players) {
    if (room.isDraw && winnerIdSet.has(player.id)) {
      addEvent(room, 'The operation ended in a draw on bunker score.', 'info', [player.id]);
    } else if (room.isDraw) {
      addEvent(room, `${winnerNames.join(' & ')} finished level on bunker score. Your operation ended in defeat.`, 'danger', [player.id]);
    } else if (winnerIdSet.has(player.id)) {
      addEvent(
        room,
        'You won the operation.',
        'success',
        [player.id]
      );
    } else {
      addEvent(
        room,
        `${winnerNames.join(' & ')} ${winnerNames.length === 1 ? 'won' : 'share victory'}. Your operation ended in defeat.`,
        'danger',
        [player.id]
      );
    }
  }
}

function quitGame(room, playerId) {
  const player = getPlayer(room, playerId);
  if (!player) throw new GameError('Player not found.', 404);

  if (room.phase === 'lobby') {
    room.players = room.players.filter((candidate) => candidate.id !== player.id);
    room.seating = room.seating.filter((candidateId) => candidateId !== player.id);
    if (room.hostId === player.id) room.hostId = room.players[0]?.id || null;
    addEvent(room, `${player.name} left the lobby.`, 'system', 'all');
    room.revision += 1;
    return { removed: true, roomEmpty: room.players.length === 0 };
  }

  if (room.phase === 'finished') return { removed: false, finished: true };

  player.quit = true;
  player.active = false;
  player.eliminated = true;
  player.eliminatedDay = room.day;
  player.order = null;
  room.status = 'finished';
  room.phase = 'finished';
  room.deadline = null;
  room.transition = null;
  room.endReason = 'quit';
  room.quitPlayerId = player.id;
  room.isDraw = false;

  for (const candidate of room.players) {
    candidate.finalScore = gameScore(candidate);
  }

  if (room.players.length === 2) {
    const winner = room.players.find((candidate) => candidate.id !== player.id);
    room.winnerIds = winner ? [winner.id] : [];
    if (winner) addEvent(room, `You win by forfeit after ${player.name} quit.`, 'success', [winner.id]);
    addEvent(room, `You quit the operation. ${winner?.name || 'The remaining commander'} wins by forfeit.`, 'danger', [player.id]);
  } else {
    room.winnerIds = [];
    addEvent(room, 'You quit. The operation has ended for every commander.', 'danger', [player.id]);
    const remaining = room.players.filter((candidate) => candidate.id !== player.id).map((candidate) => candidate.id);
    if (remaining.length) addEvent(room, `${player.name} quit. The operation has ended.`, 'warning', remaining);
  }
  room.revision += 1;
  return { removed: false, finished: true };
}

function resolveDay(room) {
  if (room.phase !== 'planning') return;
  const missedPlayerIds = [];
  const forfeitedThisDay = [];
  for (const player of activePlayers(room)) {
    if (!player.order) {
      player.order = { type: 'pass', automatic: true };
      missedPlayerIds.push(player.id);
      player.consecutiveMissedOrders += 1;
      addEvent(
        room,
        `You missed the order window and automatically passed (${player.consecutiveMissedOrders}/${MAX_CONSECUTIVE_MISSED_ORDERS} consecutive).`,
        'danger',
        [player.id]
      );
      if (player.consecutiveMissedOrders >= MAX_CONSECUTIVE_MISSED_ORDERS) forfeitedThisDay.push(player);
    }
  }
  for (const player of forfeitedThisDay) forfeitMissedOrders(room, player);

  const ordered = activePlayers(room);
  const immediatePriority = ['fortify', 'cyberkinetics', 'hologram', 'minefield', 'radio_hacker', 'teleporter', 'uav', 'napalm', 'air_raid'];
  for (const priority of immediatePriority) {
    for (const player of ordered) {
      const order = player.order;
      const key = order?.type === 'tech' ? order.techType : order?.type;
      if (key === priority) processImmediateOrder(room, player, order);
    }
  }
  for (const player of ordered) launchMovementOrder(room, player, player.order);
  advanceMissions(room);
  processEliminations(room);

  if (room.day % 5 === 0) {
    for (const player of activePlayers(room)) {
      if (player.handTroops.length < MAX_TROOP_HAND) {
        const troop = drawTroop(room);
        player.handTroops.push(troop);
        addEvent(room, `Reinforcement arrived: ${troop.unit}.`, 'success', [player.id]);
      } else {
        addEvent(room, `Troop reinforcement held: your hand is full (${MAX_TROOP_HAND}/${MAX_TROOP_HAND}).`, 'warning', [player.id]);
      }
    }
  }
  if (room.day % 10 === 0) {
    for (const player of activePlayers(room)) {
      if (player.handTech.length < MAX_TECH_HAND) {
        const tech = drawTechForPlayer(room, player);
        player.handTech.push(tech);
        addEvent(room, `New technology acquired: ${tech.name}.`, 'success', [player.id]);
      } else {
        addEvent(room, `Technology delivery held: your hand is full (${MAX_TECH_HAND}/${MAX_TECH_HAND}).`, 'warning', [player.id]);
      }
    }
  }

  for (const player of room.players) player.order = null;
  const active = activePlayers(room);
  if (active.length <= 1) {
    endGame(room, forfeitedThisDay.length ? 'missed-orders' : 'last-standing');
  } else if (room.day >= room.maxDays) {
    endGame(room, 'day-limit');
  } else {
    const completedDay = room.day;
    room.day += 1;
    const transitionUntil = Date.now() + DAY_TRANSITION_MS;
    room.transition = { completedDay, nextDay: room.day, until: transitionUntil, missedPlayerIds };
    room.deadline = transitionUntil + room.orderSeconds * 1000;
    addEvent(room, `Day ${room.day} has begun.`, 'system', 'all');
  }
  room.revision += 1;
}

function expirePlanning(room, now = Date.now()) {
  if (room.phase !== 'planning' || !room.deadline || now < room.deadline) return false;
  resolveDay(room);
  return true;
}

function visibleEvent(event, playerId) {
  return event.audience === 'all' || (Array.isArray(event.audience) && event.audience.includes(playerId));
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    connected: player.connected,
    eliminated: player.eliminated,
    forfeited: player.forfeited,
    quit: player.quit,
    setupComplete: player.setupComplete,
    orderSubmitted: Boolean(player.order),
    bunkersRemaining: player.setupComplete ? remainingBunkers(player) : null,
    bunkersDestroyed: player.bunkersDestroyed,
    eliminations: player.eliminations,
    score: gameScore(player),
    finalScore: player.finalScore,
    sites: player.sites.map((site) => ({ siteId: site.siteId, destroyed: site.kind === 'destroyed' }))
  };
}

function missionView(room, mission) {
  const target = getPlayer(room, mission.targetId);
  return {
    id: mission.id,
    type: mission.type,
    phase: mission.phase,
    targetName: target?.name || 'Former target',
    targetSiteId: mission.targetSiteId,
    troopCount: mission.troops.length,
    troops: mission.troops,
    eta: mission.eta,
    travelTime: mission.travelTime
  };
}

function serializeState(room, playerId) {
  const player = getPlayer(room, playerId);
  if (!player) throw new GameError('Player not found.', 404);
  const target = getPlayer(room, player.targetId);
  const hunter = getPlayer(room, player.hunterId);
  const intel = target ? (player.intel[target.id] || {}) : {};
  const transition = room.transition ? {
    completedDay: room.transition.completedDay,
    nextDay: room.transition.nextDay,
    until: room.transition.until,
    missedOrder: room.transition.missedPlayerIds.includes(player.id)
  } : null;
  return {
    room: {
      code: room.code,
      status: room.status,
      phase: room.phase,
      hostId: room.hostId,
      day: room.day,
      maxDays: room.maxDays,
      orderSeconds: room.orderSeconds,
      firstOrderSeconds: room.firstOrderSeconds,
      deadline: room.deadline,
      transition,
      revision: room.revision,
      winnerIds: room.winnerIds,
      isDraw: room.isDraw,
      endReason: room.endReason,
      quitPlayerId: room.quitPlayerId,
      forfeitPlayerIds: room.forfeitPlayerIds
    },
    me: {
      id: player.id,
      name: player.name,
      color: player.color,
      isHost: room.hostId === player.id,
      eliminated: player.eliminated,
      forfeited: player.forfeited,
      quit: player.quit,
      mulliganUsed: player.mulliganUsed,
      setupComplete: player.setupComplete,
      order: player.order,
      consecutiveMissedOrders: player.consecutiveMissedOrders,
      handTroops: player.handTroops,
      handTech: player.handTech,
      sites: player.sites,
      targetId: player.targetId,
      hunterId: player.hunterId,
      radioHackerUntil: player.radioHackerUntil,
      uavReport: player.uavReport,
      score: gameScore(player),
      finalScore: player.finalScore,
      missions: room.missions.filter((mission) => mission.ownerId === player.id).map((mission) => missionView(room, mission))
    },
    target: target ? { ...publicPlayer(target), intel } : null,
    hunter: hunter ? { id: hunter.id, name: hunter.name, color: hunter.color } : null,
    players: room.players.map(publicPlayer),
    events: room.events.filter((event) => visibleEvent(event, player.id)),
    constants: {
      bunkerArmor: BUNKER_ARMOR,
      maxGarrison: MAX_GARRISON,
      maxPlatoon: MAX_PLATOON,
      maxTroopHand: MAX_TROOP_HAND,
      maxTechHand: MAX_TECH_HAND,
      maxConsecutiveMissedOrders: MAX_CONSECUTIVE_MISSED_ORDERS
    }
  };
}

module.exports = {
  SITE_IDS,
  TECH_DEFINITIONS,
  GameError,
  createRoom,
  addPlayer,
  authenticate,
  startGame,
  mulligan,
  submitSetup,
  submitOrder,
  quitGame,
  resolveDay,
  expirePlanning,
  serializeState,
  getPlayer,
  remainingBunkers,
  gameScore,
  travelDays
};
