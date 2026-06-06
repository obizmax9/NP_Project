'use strict';

const socket = io();

// ── State ─────────────────────────────────────────────────
let myId = null;
let myRoomId = null;
let gameState = null;
let selectedTileId = null;
let claimSubmitted = false;

// ── Helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

const SUIT_CHARS = { man: '万', pin: '筒', sou: '条' };
const WIND_CHARS = { East: '東', South: '南', West: '西', North: '北' };
const DRAGON_CHARS = { Chun: '中', Hatsu: '發', Haku: '白' };

function tileLabel(tile) {
  if (!tile) return '?';
  if (tile.type === 'number') return tile.rank + SUIT_CHARS[tile.suit];
  if (tile.suit === 'wind') return WIND_CHARS[tile.rank];
  return DRAGON_CHARS[tile.rank];
}

function createTileEl(tile, opts = {}) {
  const el = document.createElement('div');
  el.className = 'tile';

  if (opts.faceDown) {
    el.classList.add('face-down');
    if (opts.small) el.classList.add('small');
    return el;
  }

  el.classList.add(tile.suit);
  if (tile.suit === 'dragon') el.classList.add(tile.rank);
  if (opts.small) el.classList.add('small');
  if (opts.myTile) {
    el.classList.add('my-tile');
    el.dataset.id = tile.id;
    el.addEventListener('click', () => selectTile(tile.id, el));
  }
  el.textContent = tileLabel(tile);
  return el;
}

// ── Lobby ─────────────────────────────────────────────────
$('createBtn').addEventListener('click', () => {
  const name = $('playerName').value.trim() || 'Player';
  socket.emit('create_room', { name });
});

$('joinBtn').addEventListener('click', () => {
  const code = $('roomCode').value.trim().toUpperCase();
  if (!code) return showLobbyError('Enter a room code');
  const name = $('playerName').value.trim() || 'Player';
  socket.emit('join_room', { roomId: code, name });
});

$('playAgainBtn').addEventListener('click', () => location.reload());

function showLobbyError(msg) {
  $('lobbyError').textContent = msg;
}

// ── Socket events ─────────────────────────────────────────
socket.on('connect', () => { myId = socket.id; });

socket.on('room_created', ({ roomId, seat, gameState: gs }) => {
  myRoomId = roomId;
  gameState = gs;
  hide('lobby');
  show('waitingRoom');
  $('displayRoomCode').textContent = roomId;
  updateWaitingRoom(gs);
});

socket.on('room_joined', ({ roomId, seat, gameState: gs }) => {
  myRoomId = roomId;
  gameState = gs;
  hide('lobby');
  show('waitingRoom');
  $('displayRoomCode').textContent = roomId;
  updateWaitingRoom(gs);
});

socket.on('player_joined', ({ gameState: gs }) => {
  gameState = gs;
  updateWaitingRoom(gs);
});

socket.on('game_started', ({ gameState: gs }) => {
  gameState = gs;
  hide('waitingRoom');
  show('gameBoard');
  renderBoard(gs);
  showMessage('Game started! ' + currentPlayerName(gs) + "'s turn.");
});

socket.on('tile_discarded', ({ gameState: gs }) => {
  gameState = gs;
  claimSubmitted = false;
  renderBoard(gs);
  showMessage('Waiting for claims...');
  if (gs.phase === 'claim' && gs.currentPlayerId !== myId) {
    showClaimButtons(gs);
  }
});

socket.on('claim_update', ({ gameState: gs }) => {
  gameState = gs;
  renderBoard(gs);
});

socket.on('claim_resolved', ({ resolved, winner, claimer, gameState: gs }) => {
  gameState = gs;
  hideClaimButtons();
  claimSubmitted = false;
  selectedTileId = null;

  if (resolved === 'win') {
    showResult(gs, winner);
    return;
  }
  if (resolved === 'draw') {
    showResult(gs, null);
    return;
  }
  renderBoard(gs);
  if (resolved === 'pass') {
    showMessage(currentPlayerName(gs) + "'s turn");
  } else {
    const claimerName = gs.players.find(p => p.id === claimer)?.name || 'Someone';
    showMessage(`${claimerName} claimed ${resolved.toUpperCase()}!`);
  }
});

socket.on('player_left', ({ gameState: gs }) => {
  gameState = gs;
  showMessage('A player disconnected.');
});

socket.on('error', ({ message }) => {
  if ($('lobby').offsetParent !== null) showLobbyError(message);
  else showMessage('Error: ' + message, true);
});

// ── Claim buttons ─────────────────────────────────────────
document.querySelectorAll('.btn-claim, .btn-pass').forEach(btn => {
  btn.addEventListener('click', () => {
    if (claimSubmitted) return;
    claimSubmitted = true;
    socket.emit('claim', { claimType: btn.dataset.claim });
    hideClaimButtons();
    showMessage('Claim submitted, waiting...');
  });
});

$('selfDrawBtn').addEventListener('click', () => {
  socket.emit('self_draw_win');
});

function showClaimButtons(gs) {
  if (claimSubmitted) return;
  show('claimButtons');
  $('claimPrompt').textContent = 'Last discard: ' + tileLabel(gs.lastDiscard) + ' — claim?';
}

function hideClaimButtons() {
  hide('claimButtons');
}

// ── Tile selection & discard ──────────────────────────────
function selectTile(id, el) {
  if (gameState?.phase !== 'discard') return;
  if (gameState?.currentPlayerId !== myId) return;

  if (selectedTileId === id) {
    // Double-click discard
    discardSelected();
    return;
  }

  document.querySelectorAll('.tile.selected').forEach(t => t.classList.remove('selected'));
  selectedTileId = id;
  el.classList.add('selected');
  showMessage('Click again to discard, or select another tile.');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && selectedTileId) discardSelected();
});

function discardSelected() {
  if (!selectedTileId) return;
  socket.emit('discard', { tileId: selectedTileId });
  selectedTileId = null;
  document.querySelectorAll('.tile.selected').forEach(t => t.classList.remove('selected'));
}

// ── Board rendering ───────────────────────────────────────
function renderBoard(gs) {
  const myPlayer = gs.players.find(p => p.id === myId);
  if (!myPlayer) return;

  const myIdx = gs.players.indexOf(myPlayer);
  // Positions: bottom=me, top=opposite, left=left, right=right
  const opposite = gs.players[(myIdx + 2) % 4];
  const left     = gs.players[(myIdx + 3) % 4];
  const right    = gs.players[(myIdx + 1) % 4];

  renderOpponent('top', opposite, gs);
  renderOpponent('left', left, gs);
  renderOpponent('right', right, gs);
  renderMyHand(gs);
  renderCenter(gs);

  // Self-draw win button
  const isMyTurn = gs.currentPlayerId === myId && gs.phase === 'discard';
  if (isMyTurn) show('selfDrawBtn');
  else hide('selfDrawBtn');
}

function renderOpponent(position, player, gs) {
  if (!player) return;
  const info = $(`info-${position}`);
  const handEl = $(`hand-${position}`);
  const discardsEl = $(`discards-${position}`);
  const meldsEl = $(`melds-${position}`);

  const isCurrentTurn = gs.currentPlayerId === player.id;
  info.innerHTML = (isCurrentTurn ? '<span class="current-turn-indicator"></span>' : '') +
    `<strong>${player.name}</strong> (${player.seat}) · ${player.handCount} tiles`;

  handEl.innerHTML = '';
  for (let i = 0; i < player.handCount; i++) {
    handEl.appendChild(createTileEl(null, { faceDown: true, small: true }));
  }

  discardsEl.innerHTML = '';
  for (const t of player.discards) {
    const el = createTileEl(t, { small: true });
    if (gs.lastDiscard && t.id === gs.lastDiscard.id && gs.lastDiscardBy === player.id) {
      el.classList.add('last-discard');
    }
    discardsEl.appendChild(el);
  }

  meldsEl.innerHTML = '';
  for (const meld of player.melds) {
    const group = document.createElement('div');
    group.className = 'meld-group';
    for (const t of meld.tiles) group.appendChild(createTileEl(t, { small: true }));
    meldsEl.appendChild(group);
  }
}

function renderMyHand(gs) {
  const handEl = $('myHand');
  const meldsEl = $('myMelds');
  const infoEl = $('myInfo');

  const myPlayer = gs.players.find(p => p.id === myId);
  if (!myPlayer) return;

  const isMyTurn = gs.currentPlayerId === myId && gs.phase === 'discard';
  infoEl.innerHTML = (isMyTurn ? '<span class="current-turn-indicator"></span>' : '') +
    `<strong>${myPlayer.name}</strong> (${myPlayer.seat})` +
    (isMyTurn ? ' — <em>Your turn! Click tile to select, click again to discard</em>' : '');

  handEl.innerHTML = '';
  for (const tile of gs.myHand) {
    const el = createTileEl(tile, { myTile: true });
    if (tile.id === selectedTileId) el.classList.add('selected');
    handEl.appendChild(el);
  }

  meldsEl.innerHTML = '';
  for (const meld of (gs.myMelds || [])) {
    const group = document.createElement('div');
    group.className = 'meld-group';
    for (const t of meld.tiles) group.appendChild(createTileEl(t));
    meldsEl.appendChild(group);
  }
}

function renderCenter(gs) {
  $('wallCount').textContent = `Wall: ${gs.wallCount} tiles remaining`;

  const pile = $('discardPile');
  pile.innerHTML = '';
  if (gs.lastDiscard) {
    const el = createTileEl(gs.lastDiscard, { small: false });
    el.classList.add('last-discard');
    pile.appendChild(el);
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:.75rem;color:#aed581;margin-top:4px;';
    const discardPlayerName = gs.players.find(p => p.id === gs.lastDiscardBy)?.name || '?';
    lbl.textContent = `Discarded by ${discardPlayerName}`;
    pile.appendChild(lbl);
  }
}

// ── Waiting room ──────────────────────────────────────────
function updateWaitingRoom(gs) {
  const list = $('playerList');
  list.innerHTML = '';
  const seats = ['East', 'South', 'West', 'North'];
  for (let i = 0; i < 4; i++) {
    const slot = document.createElement('div');
    slot.className = 'player-slot';
    const p = gs.players[i];
    slot.innerHTML = `<div class="seat">${seats[i]}</div><div class="pname">${p ? p.name : '—'}</div>`;
    list.appendChild(slot);
  }
  const needed = 4 - gs.players.length;
  $('waitingMsg').textContent = needed > 0
    ? `Waiting for ${needed} more player${needed !== 1 ? 's' : ''}...`
    : 'All players joined! Starting...';
}

// ── Result screen ─────────────────────────────────────────
function showResult(gs, winnerId) {
  hide('gameBoard');
  show('resultScreen');
  if (winnerId) {
    const winner = gs.players.find(p => p.id === winnerId);
    $('resultTitle').textContent = winnerId === myId ? '🏆 You Win!' : `${winner?.name || 'Someone'} Wins!`;
    $('resultDetail').textContent = `${winner?.name || '?'} (${winner?.seat || '?'}) declared Mahjong!`;
  } else {
    $('resultTitle').textContent = 'Draw!';
    $('resultDetail').textContent = 'The wall is empty. No winner this round.';
  }
}

// ── Utility ───────────────────────────────────────────────
function showMessage(msg, isError = false) {
  const el = $('gameMessage');
  el.textContent = msg;
  el.style.color = isError ? '#ff8a80' : '#fff59d';
}

function currentPlayerName(gs) {
  return gs.players.find(p => p.id === gs.currentPlayerId)?.name || '?';
}
