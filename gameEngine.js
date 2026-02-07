'use strict';
const crypto = require('crypto');
const EventEmitter = require('events');
const logger = require('./logger');

/**
 * Game engine that supports provably-fair deterministic crash calculation.
 * Seeds are provided by server (via setNextSeed / startEngine).
 *
 * Exports:
 * - startEngine() -> starts rounds loop (use server to initialize seeds first)
 * - setNextSeed(nextSeedObj) -> { seed, seedHash, commitIdx }
 * - getRoundStatus()
 * - joinRound(playerId, betAmount)
 * - cashOut(playerId)
 * - dispose()
 * - emitter (EventEmitter) emits 'roundStarted' and 'roundCrashed'
 *
 * Deterministic crash calculation:
 * - Uses HMAC-SHA256 with serverSeed as key and empty message (or optionally clientSeed)
 * - Uses the first 52 bits of the resulting hash to compute the multiplier using the commonly-used mapping
 *   (compatible with standard crash provably-fair implementations).
 */

class GameEngineEmitter extends EventEmitter {}
const emitter = new GameEngineEmitter();

let currentRound = null;
let disposed = false;
let pendingSeedObj = null; // { seed, seedHash, commitIdx }

/* ========================= HELPERS ========================= */

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function hmacSha256Hex(key, message = '') {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

// Convert hash hex to crash point using 52-bit mapping:
// result = floor((100 * 2^52 - h) / (2^52 - h)) / 100
// ensures deterministic mapping and avoids infinite multipliers.
function hashToCrashPoint(hashHex) {
  // take first 13 hex characters -> 52 bits (13 * 4 = 52)
  const prefix = (hashHex || '').slice(0, 13);
  const h = parseInt(prefix, 16);
  const e = Math.pow(2, 52);
  // Avoid divide by zero; ensure result is finite
  const numerator = (100 * e - h);
  const denominator = (e - h);
  if (denominator <= 0) return 1.0;
  const result = Math.floor((numerator / denominator)) / 100;
  return Math.max(1.0, Number(result.toFixed(2)));
}

// compute multiplier from serverSeed (and optional clientSeed — currently unused)
function computeCrashPointFromSeed(serverSeed, clientSeed = '') {
  try {
    // Use HMAC with serverSeed as key and clientSeed as message for verifiability.
    const hashHex = hmacSha256Hex(serverSeed, clientSeed);
    return { crashPoint: hashToCrashPoint(hashHex), hashHex };
  } catch (e) {
    logger.error('computeCrashPointFromSeed.error', { message: e && e.message ? e.message : String(e) });
    return { crashPoint: 1.0, hashHex: null };
  }
}

// compute current multiplier based on startedAt ms
function computeMultiplier(startedAt) {
  const elapsedMs = Date.now() - startedAt;
  const growthPerSecond = 1;
  const multiplier = 1 + (elapsedMs / 1000) * growthPerSecond;
  return Number(multiplier.toFixed(2));
}

function safeClearTimer(t) {
  try { if (t) clearTimeout(t); } catch (e) {}
}

/* ========================= ENGINE BEHAVIOR ========================= */

// Set the next seed (provided/provisioned by server). nextSeedObj: { seed, seedHash, commitIdx }
function setNextSeed(obj) {
  if (!obj || !obj.seed || !obj.seedHash || typeof obj.commitIdx === 'undefined') {
    logger.warn('game.setNextSeed.invalid', { obj });
    pendingSeedObj = null;
    return;
  }
  pendingSeedObj = {
    seed: String(obj.seed),
    seedHash: String(obj.seedHash),
    commitIdx: Number(obj.commitIdx)
  };
  logger.info('game.next_seed_set', { commitIdx: pendingSeedObj.commitIdx, seedHash: pendingSeedObj.seedHash });
}

// internal: mark round crashed and schedule next
function markRoundCrashed(round, reason = 'auto') {
  if (!round) return;
  if (round.status === 'crashed') return;

  round.status = 'crashed';
  round.locked = true;
  round.endedAt = Date.now();

  if (round.timer) {
    try { clearTimeout(round.timer); } catch (e) {}
    round.timer = null;
  }

  logger.info('game.round.crashed', { roundId: round.roundId, reason, crashPoint: round.crashPoint });

  // emit event for persistence; include revealed serverSeed so server can persist it
  try {
    emitter.emit('roundCrashed', {
      roundId: round.roundId,
      crashPoint: round.crashPoint,
      serverSeedHash: round.serverSeedHash,
      serverSeed: round.serverSeed,
      commitIdx: round.commitIdx,
      startedAt: round.startedAt,
      endedAt: round.endedAt,
      meta: round.meta || {}
    });
  } catch (e) {
    logger.warn('gameEngine.emit.roundCrashed_failed', { message: e && e.message ? e.message : String(e) });
  }

  // schedule next round
  if (!round.nextRoundTimer && !disposed) {
    const t = setTimeout(() => {
      try {
        // clear currentRound so next createNewRound won't conflict
        currentRound = null;
        if (!disposed) {
          createNewRound();
        } else {
          logger.info('game.round.not_restarting_because_disposed', { roundId: round.roundId });
        }
      } catch (e) {
        logger.error('game.round.schedule_next_error', { message: e && e.message ? e.message : String(e) });
      }
    }, 5000);
    if (typeof t.unref === 'function') t.unref();
    round.nextRoundTimer = t;
  }
}

// Create and start a new global round. Uses pendingSeedObj if present; otherwise generates an ephemeral seed.
function createNewRound() {
  if (disposed) {
    logger.info('game.round.create_skipped_disposed');
    return null;
  }

  if (currentRound) {
    try {
      if (currentRound.timer) { clearTimeout(currentRound.timer); currentRound.timer = null; }
      if (currentRound.nextRoundTimer) { clearTimeout(currentRound.nextRoundTimer); currentRound.nextRoundTimer = null; }
    } catch (e) {
      // ignore
    }
  }

  const roundId = crypto.randomUUID();

  // Determine serverSeed (use pendingSeedObj if available)
  let serverSeed = null;
  let serverSeedHash = null;
  let commitIdx = null;

  if (pendingSeedObj && pendingSeedObj.seed && pendingSeedObj.seedHash && typeof pendingSeedObj.commitIdx !== 'undefined') {
    serverSeed = pendingSeedObj.seed;
    serverSeedHash = pendingSeedObj.seedHash;
    commitIdx = pendingSeedObj.commitIdx;
    // consume pendingSeedObj (server should generate and set a new pending seed for next round)
    pendingSeedObj = null;
  } else {
    // Fallback: generate ephemeral seed (not recommended for production)
    serverSeed = crypto.randomBytes(32).toString('hex');
    serverSeedHash = sha256hex(serverSeed);
    commitIdx = null;
    logger.warn('game.round.generated_ephemeral_seed', { roundId });
  }

  // Deterministic crash point from serverSeed
  const { crashPoint, hashHex } = computeCrashPointFromSeed(serverSeed, '');
  // compute crash delay from crashPoint (approx)
  const delayMs = Math.max(100, Math.floor((crashPoint - 1) * 1000));

  currentRound = {
    roundId,
    crashPoint,
    serverSeed,
    serverSeedHash,
    commitIdx,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    locked: false,
    players: new Map(),
    timer: null,
    nextRoundTimer: null,
    meta: {}
  };

  // Auto-crash after computed delay
  const t = setTimeout(() => {
    if (currentRound && currentRound.status === 'running') {
      markRoundCrashed(currentRound, 'timer');
    }
  }, delayMs);
  if (typeof t.unref === 'function') t.unref();
  currentRound.timer = t;

  logger.info('game.round.started', { roundId: currentRound.roundId, crashPoint: currentRound.crashPoint, startedAt: currentRound.startedAt, serverSeedHash: currentRound.serverSeedHash, commitIdx: currentRound.commitIdx });

  // emit event for persistence (hide serverSeed — only send hash and commitIdx)
  try {
    emitter.emit('roundStarted', {
      roundId: currentRound.roundId,
      serverSeedHash: currentRound.serverSeedHash,
      commitIdx: currentRound.commitIdx,
      crashPoint: currentRound.crashPoint,
      startedAt: currentRound.startedAt,
      meta: currentRound.meta || {}
    });
  } catch (e) {
    logger.warn('gameEngine.emit.roundStarted_failed', { message: e && e.message ? e.message : String(e) });
  }

  return currentRound;
}

/* ========================================================= PUBLIC API ========================================================= */

function startEngine() {
  // Start first round
  if (disposed) return;
  logger.info('game.engine.starting');
  createNewRound();
}

function getRoundStatus() {
  if (!currentRound) {
    return { status: 'waiting' };
  }

  let multiplier = null;

  if (currentRound.status === 'running') {
    multiplier = computeMultiplier(currentRound.startedAt);

    if (multiplier >= currentRound.crashPoint) {
      markRoundCrashed(currentRound, 'threshold');
      multiplier = currentRound.crashPoint;
    }
  } else {
    multiplier = currentRound.crashPoint;
  }

  return {
    roundId: currentRound.roundId,
    status: currentRound.status,
    multiplier,
    startedAt: currentRound.startedAt,
    endedAt: currentRound.endedAt,
    serverSeedHash: currentRound.serverSeedHash,
    commitIdx: currentRound.commitIdx
  };
}

function joinRound(playerId, betAmount) {
  if (!currentRound || currentRound.status !== 'running') {
    throw new Error('No active running round');
  }

  if (!playerId) throw new Error('playerId required');
  if (!betAmount || isNaN(betAmount) || Number(betAmount) <= 0) throw new Error('Invalid bet amount');

  if (currentRound.players.has(playerId)) {
    throw new Error('Player already joined this round');
  }

  currentRound.players.set(playerId, {
    betAmount: Number(betAmount),
    cashedOut: false
  });

  return {
    roundId: currentRound.roundId,
    serverSeedHash: currentRound.serverSeedHash,
    startedAt: currentRound.startedAt,
    commitIdx: currentRound.commitIdx
  };
}

function cashOut(playerId) {
  if (!currentRound) {
    throw new Error('No active round');
  }

  const player = currentRound.players.get(playerId);
  if (!player) {
    throw new Error('Player not in round');
  }

  if (player.cashedOut) {
    throw new Error('Already cashed out');
  }

  let multiplier = computeMultiplier(currentRound.startedAt);

  if (multiplier >= currentRound.crashPoint || currentRound.status !== 'running') {
    if (currentRound.status !== 'crashed') {
      markRoundCrashed(currentRound, 'cashout-detected-crash');
    }
    return { win: false, payout: 0, multiplier: currentRound.crashPoint };
  }

  player.cashedOut = true;

  multiplier = Number(multiplier.toFixed(2));
  const payout = Number((Number(player.betAmount) * Number(multiplier)).toFixed(2));

  player.payout = payout;
  player.cashedAt = Date.now();
  player.cashedMultiplier = multiplier;

  logger.info('game.player.cashed', { playerId, roundId: currentRound.roundId, multiplier, payout });

  return {
    win: true,
    payout,
    multiplier
  };
}

/* ========================================================= DISPOSE / SHUTDOWN ========================================================= */

async function dispose() {
  try {
    if (disposed) {
      logger.info('game.dispose.already_disposed');
      currentRound = null;
      return;
    }
    disposed = true;

    if (!currentRound) {
      logger.info('game.dispose.no_current_round');
      return;
    }

    try {
      if (currentRound.timer) {
        clearTimeout(currentRound.timer);
        currentRound.timer = null;
      }
      if (currentRound.nextRoundTimer) {
        clearTimeout(currentRound.nextRoundTimer);
        currentRound.nextRoundTimer = null;
      }
    } catch (e) {}

    try {
      if (currentRound.players && typeof currentRound.players.clear === 'function') {
        currentRound.players.clear();
      }
    } catch (e) {}

    try {
      if (currentRound.serverSeed) {
        currentRound.serverSeed = null;
      }
    } catch (e) {}

    logger.info('game.dispose.completed', { roundId: currentRound.roundId });

    currentRound = null;
  } catch (err) {
    logger.error('game.dispose.error', { message: err && err.message ? err.message : String(err) });
  }
}

/* ========================================================= EXPORTS ========================================================= */

module.exports = {
  startEngine,
  setNextSeed,
  getRoundStatus,
  joinRound,
  cashOut,
  dispose,
  emitter,
  _internal: { hashToCrashPoint, computeCrashPointFromSeed }
};
