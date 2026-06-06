'use strict';

const { buildWall, tileKey, WINDS } = require('./tiles');

class MahjongGame {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = []; // { id, name, seat }
    this.state = 'waiting'; // waiting | playing | finished
    this.wall = [];
    this.hands = {}; // socketId -> tile[]
    this.melds = {}; // socketId -> meld[]  (meld: { type, tiles })
    this.discards = {}; // socketId -> tile[]
    this.currentTurn = 0; // index into this.players
    this.phase = 'draw'; // draw | discard | claim
    this.lastDiscard = null;
    this.lastDiscardBy = null;
    this.claimWindow = null; // pending claim state
    this.pendingClaims = {}; // socketId -> claim type or null
    this.winnerId = null;
  }

  addPlayer(socketId, name) {
    if (this.players.length >= 4) return { error: 'Room full' };
    if (this.state !== 'waiting') return { error: 'Game in progress' };
    const seat = WINDS[this.players.length];
    this.players.push({ id: socketId, name, seat });
    return { seat, seatIndex: this.players.length - 1 };
  }

  removePlayer(socketId) {
    this.players = this.players.filter(p => p.id !== socketId);
  }

  start() {
    if (this.players.length !== 4) return { error: 'Need 4 players' };
    this.state = 'playing';
    this.wall = buildWall();

    for (const p of this.players) {
      this.hands[p.id] = [];
      this.melds[p.id] = [];
      this.discards[p.id] = [];
    }

    // Deal 13 tiles to each player
    for (let i = 0; i < 13; i++) {
      for (const p of this.players) {
        this.hands[p.id].push(this.wall.pop());
      }
    }

    // East (seat 0) draws the 14th tile
    this.currentTurn = 0;
    this.hands[this.players[0].id].push(this.wall.pop());
    this.phase = 'discard';
    return { ok: true };
  }

  // Returns full game state for a specific player (hides other hands)
  getStateFor(socketId) {
    return {
      state: this.state,
      phase: this.phase,
      currentTurn: this.currentTurn,
      currentPlayerId: this.players[this.currentTurn]?.id,
      wallCount: this.wall.length,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        handCount: this.hands[p.id]?.length || 0,
        melds: this.melds[p.id] || [],
        discards: this.discards[p.id] || [],
        isCurrentTurn: this.players[this.currentTurn]?.id === p.id,
      })),
      myHand: this.hands[socketId] || [],
      myMelds: this.melds[socketId] || [],
      lastDiscard: this.lastDiscard,
      lastDiscardBy: this.lastDiscardBy,
      winnerId: this.winnerId,
      pendingClaims: this.phase === 'claim' ? this._pendingClaimSummary() : null,
    };
  }

  _pendingClaimSummary() {
    const summary = {};
    for (const p of this.players) {
      summary[p.id] = this.pendingClaims[p.id] ?? 'pending';
    }
    return summary;
  }

  discard(socketId, tileId) {
    if (this.phase !== 'discard') return { error: 'Not discard phase' };
    if (this.players[this.currentTurn].id !== socketId) return { error: 'Not your turn' };

    const hand = this.hands[socketId];
    const idx = hand.findIndex(t => t.id === tileId);
    if (idx === -1) return { error: 'Tile not in hand' };

    const [tile] = hand.splice(idx, 1);
    this.discards[socketId].push(tile);
    this.lastDiscard = tile;
    this.lastDiscardBy = socketId;

    // Open claim window for other players
    this.phase = 'claim';
    this.pendingClaims = {};
    for (const p of this.players) {
      if (p.id !== socketId) this.pendingClaims[p.id] = null; // null = undecided
    }

    return { ok: true, tile };
  }

  submitClaim(socketId, claimType) {
    // claimType: 'pass' | 'chow' | 'pung' | 'kong' | 'win'
    if (this.phase !== 'claim') return { error: 'No claim window' };
    if (socketId === this.lastDiscardBy) return { error: 'Cannot claim own discard' };
    if (this.pendingClaims[socketId] === undefined) return { error: 'Not waiting for your claim' };

    if (claimType !== 'pass') {
      const valid = this._validateClaim(socketId, claimType);
      if (!valid.ok) return valid;
    }

    this.pendingClaims[socketId] = claimType;

    // Check if all players have decided
    const undecided = Object.values(this.pendingClaims).filter(v => v === null);
    if (undecided.length > 0) return { ok: true, waiting: true };

    return this._resolveClaims();
  }

  _validateClaim(socketId, claimType) {
    const hand = this.hands[socketId];
    const tile = this.lastDiscard;
    const discardPlayerIdx = this.players.findIndex(p => p.id === this.lastDiscardBy);
    const claimerIdx = this.players.findIndex(p => p.id === socketId);

    if (claimType === 'win') {
      const testHand = [...hand, tile];
      return this._isWinningHand(testHand, this.melds[socketId])
        ? { ok: true }
        : { error: 'Not a winning hand' };
    }

    if (claimType === 'pung' || claimType === 'kong') {
      const count = claimType === 'pung' ? 2 : 3;
      const matches = hand.filter(t => tileKey(t) === tileKey(tile));
      return matches.length >= count ? { ok: true } : { error: `Need ${count} matching tiles` };
    }

    if (claimType === 'chow') {
      // Only the player to the left of discarder can chow
      const leftOfDiscarder = (discardPlayerIdx + 1) % 4;
      if (claimerIdx !== leftOfDiscarder) return { error: 'Can only chow from left player' };
      if (tile.type !== 'number') return { error: 'Cannot chow honor tiles' };
      const suits = hand.filter(t => t.suit === tile.suit && t.type === 'number');
      return this._canFormChow(suits, tile.rank) ? { ok: true } : { error: 'No chow possible' };
    }

    return { error: 'Unknown claim type' };
  }

  _canFormChow(suitTiles, rank) {
    const ranks = suitTiles.map(t => t.rank);
    return (ranks.includes(rank - 2) && ranks.includes(rank - 1)) ||
           (ranks.includes(rank - 1) && ranks.includes(rank + 1)) ||
           (ranks.includes(rank + 1) && ranks.includes(rank + 2));
  }

  _resolveClaims() {
    // Priority: win > kong > pung > chow > pass
    const priority = ['win', 'kong', 'pung', 'chow', 'pass'];
    let bestClaim = null;
    let bestClaimerIdx = -1;

    for (const type of priority) {
      // Among players who made this claim, pick by turn order
      const claimers = this.players
        .map((p, idx) => ({ p, idx }))
        .filter(({ p }) => this.pendingClaims[p.id] === type);

      if (claimers.length > 0) {
        // Pick the one closest in turn order after the discarder
        const discardIdx = this.players.findIndex(p => p.id === this.lastDiscardBy);
        claimers.sort((a, b) => {
          const da = (a.idx - discardIdx + 4) % 4;
          const db = (b.idx - discardIdx + 4) % 4;
          return da - db;
        });
        bestClaim = type;
        bestClaimerIdx = claimers[0].idx;
        break;
      }
    }

    if (bestClaim === 'pass' || !bestClaim) {
      return this._advanceTurn();
    }

    const claimerId = this.players[bestClaimerIdx].id;

    if (bestClaim === 'win') {
      this._applyWin(claimerId);
      return { ok: true, resolved: 'win', winner: claimerId };
    }

    this._applyMeld(claimerId, bestClaim);
    this.currentTurn = bestClaimerIdx;
    this.phase = 'discard';
    return { ok: true, resolved: bestClaim, claimer: claimerId };
  }

  _applyMeld(socketId, type) {
    const hand = this.hands[socketId];
    const tile = this.lastDiscard;

    // Remove the discard from the last discarder's pile
    const dp = this.discards[this.lastDiscardBy];
    dp.splice(dp.length - 1, 1);

    let meldTiles = [tile];

    if (type === 'pung') {
      const needed = 2;
      let found = 0;
      this.hands[socketId] = hand.filter(t => {
        if (found < needed && tileKey(t) === tileKey(tile)) { found++; return false; }
        return true;
      });
      meldTiles = [...Array(needed).fill(null).map(() => ({ ...tile })), tile];
    } else if (type === 'kong') {
      const needed = 3;
      let found = 0;
      this.hands[socketId] = hand.filter(t => {
        if (found < needed && tileKey(t) === tileKey(tile)) { found++; return false; }
        return true;
      });
      meldTiles = [...Array(needed).fill(null).map(() => ({ ...tile })), tile];
      // Draw replacement tile for kong
      if (this.wall.length > 0) this.hands[socketId].push(this.wall.pop());
    } else if (type === 'chow') {
      const rank = tile.rank;
      const suit = tile.suit;
      // Find best chow combination
      const combo = this._findChowCombo(hand, suit, rank);
      meldTiles = [...combo, tile];
      const comboIds = new Set(combo.map(t => t.id));
      this.hands[socketId] = hand.filter(t => !comboIds.has(t.id));
    }

    this.melds[socketId].push({ type, tiles: meldTiles });
  }

  _findChowCombo(hand, suit, rank) {
    const suitTiles = hand.filter(t => t.suit === suit && t.type === 'number');
    const getRank = r => suitTiles.find(t => t.rank === r);

    const combos = [
      [rank - 2, rank - 1],
      [rank - 1, rank + 1],
      [rank + 1, rank + 2],
    ];

    for (const [a, b] of combos) {
      const ta = getRank(a), tb = getRank(b);
      if (ta && tb) return [ta, tb];
    }
    return [];
  }

  _advanceTurn() {
    if (this.wall.length === 0) {
      this.state = 'finished';
      return { ok: true, resolved: 'draw' };
    }
    this.currentTurn = (this.currentTurn + 1) % 4;
    const nextId = this.players[this.currentTurn].id;
    this.hands[nextId].push(this.wall.pop());
    this.phase = 'discard';
    return { ok: true, resolved: 'pass', nextPlayer: nextId };
  }

  _applyWin(socketId) {
    this.winnerId = socketId;
    this.state = 'finished';
  }

  // Check if a hand (13/14 tiles + melds) is a winning hand
  _isWinningHand(hand, melds) {
    const meldsNeeded = 4 - melds.length;
    return this._canComplete(hand.slice().sort(this._sortTiles), meldsNeeded);
  }

  _sortTiles(a, b) {
    if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
    return String(a.rank).localeCompare(String(b.rank));
  }

  _canComplete(tiles, meldsNeeded) {
    if (tiles.length === 2 && meldsNeeded === 0) {
      return tileKey(tiles[0]) === tileKey(tiles[1]);
    }
    if (tiles.length !== meldsNeeded * 3 + 2) return false;
    if (tiles.length === 0) return false;

    // Try using first tile as part of a pair
    for (let i = 1; i < tiles.length; i++) {
      if (tileKey(tiles[0]) === tileKey(tiles[i])) {
        const rest = tiles.filter((_, idx) => idx !== 0 && idx !== i);
        if (this._canFillMelds(rest, meldsNeeded)) return true;
      }
    }
    return false;
  }

  _canFillMelds(tiles, needed) {
    if (needed === 0) return tiles.length === 0;
    if (tiles.length < 3) return false;

    const first = tiles[0];

    // Try pung
    if (tiles.filter(t => tileKey(t) === tileKey(first)).length >= 3) {
      let removed = 0;
      const rest = tiles.filter(t => {
        if (removed < 3 && tileKey(t) === tileKey(first)) { removed++; return false; }
        return true;
      });
      if (this._canFillMelds(rest, needed - 1)) return true;
    }

    // Try chow (number tiles only)
    if (first.type === 'number') {
      const t2 = tiles.find((t, i) => i > 0 && t.suit === first.suit && t.rank === first.rank + 1);
      const t3 = tiles.find((t, i) => i > 0 && t.suit === first.suit && t.rank === first.rank + 2);
      if (t2 && t3) {
        const used = new Set([tiles[0].id, t2.id, t3.id]);
        const rest = tiles.filter(t => !used.has(t.id));
        if (this._canFillMelds(rest, needed - 1)) return true;
      }
    }

    return false;
  }

  declareSelfDraw(socketId) {
    if (this.phase !== 'discard') return { error: 'Not discard phase' };
    if (this.players[this.currentTurn].id !== socketId) return { error: 'Not your turn' };

    const hand = this.hands[socketId];
    if (this._isWinningHand(hand, this.melds[socketId])) {
      this._applyWin(socketId);
      return { ok: true };
    }
    return { error: 'Not a winning hand' };
  }
}

module.exports = MahjongGame;
