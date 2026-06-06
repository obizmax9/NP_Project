'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const MahjongGame = require('./game/mahjong');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// rooms: roomId -> MahjongGame
const rooms = new Map();
// socketToRoom: socketId -> roomId
const socketToRoom = new Map();

function broadcast(roomId, event, data) {
  const game = rooms.get(roomId);
  if (!game) return;
  for (const p of game.players) {
    io.to(p.id).emit(event, { ...data, gameState: game.getStateFor(p.id) });
  }
}

io.on('connection', (socket) => {
  console.log('connect', socket.id);

  socket.on('create_room', ({ name }) => {
    const roomId = uuidv4().slice(0, 6).toUpperCase();
    const game = new MahjongGame(roomId);
    rooms.set(roomId, game);
    const result = game.addPlayer(socket.id, name || 'Player');
    socketToRoom.set(socket.id, roomId);
    socket.join(roomId);
    socket.emit('room_created', { roomId, seat: result.seat, gameState: game.getStateFor(socket.id) });
    console.log(`Room ${roomId} created by ${socket.id}`);
  });

  socket.on('join_room', ({ roomId, name }) => {
    const game = rooms.get(roomId);
    if (!game) return socket.emit('error', { message: 'Room not found' });
    const result = game.addPlayer(socket.id, name || 'Player');
    if (result.error) return socket.emit('error', { message: result.error });
    socketToRoom.set(socket.id, roomId);
    socket.join(roomId);
    socket.emit('room_joined', { roomId, seat: result.seat, gameState: game.getStateFor(socket.id) });
    broadcast(roomId, 'player_joined', { name: name || 'Player', seat: result.seat });
    console.log(`${socket.id} joined room ${roomId} as ${result.seat}`);

    // Auto-start when 4 players join
    if (game.players.length === 4) {
      const startResult = game.start();
      if (startResult.ok) {
        broadcast(roomId, 'game_started', {});
        console.log(`Game started in room ${roomId}`);
      }
    }
  });

  socket.on('discard', ({ tileId }) => {
    const roomId = socketToRoom.get(socket.id);
    const game = rooms.get(roomId);
    if (!game) return;
    const result = game.discard(socket.id, tileId);
    if (result.error) return socket.emit('error', { message: result.error });
    broadcast(roomId, 'tile_discarded', { by: socket.id, tile: result.tile });
  });

  socket.on('claim', ({ claimType }) => {
    const roomId = socketToRoom.get(socket.id);
    const game = rooms.get(roomId);
    if (!game) return;
    const result = game.submitClaim(socket.id, claimType);
    if (result.error) return socket.emit('error', { message: result.error });

    if (result.waiting) {
      broadcast(roomId, 'claim_update', {});
    } else {
      broadcast(roomId, 'claim_resolved', { resolved: result.resolved, winner: result.winner, claimer: result.claimer });
    }
  });

  socket.on('self_draw_win', () => {
    const roomId = socketToRoom.get(socket.id);
    const game = rooms.get(roomId);
    if (!game) return;
    const result = game.declareSelfDraw(socket.id);
    if (result.error) return socket.emit('error', { message: result.error });
    broadcast(roomId, 'claim_resolved', { resolved: 'win', winner: socket.id });
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) {
      const game = rooms.get(roomId);
      if (game) {
        game.removePlayer(socket.id);
        socketToRoom.delete(socket.id);
        if (game.players.length === 0) {
          rooms.delete(roomId);
        } else {
          broadcast(roomId, 'player_left', { id: socket.id });
        }
      }
    }
    console.log('disconnect', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Mahjong server running on http://localhost:${PORT}`));
