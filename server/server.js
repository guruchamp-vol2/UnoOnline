// server/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./db');
const Game = require('./models/Game');
const Player = require('./models/Player');
const apiRouter = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '../client')));

function createDeck() {
  const colors = ['red','green','blue','yellow'];
  const values = [...Array(10).keys()].map(String).concat(['skip','reverse','+2']);
  let deck = [];
  colors.forEach(c => {
    values.forEach(v => {
      deck.push({ color: c, value: v });
      if (v !== '0') deck.push({ color: c, value: v });
    });
  });
  for (let i=0; i<4; i++){
    deck.push({ color:'wild', value:'wild' });
    deck.push({ color:'wild', value:'+4' });
  }
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

io.on('connection', socket => {
  socket.on('joinGame', async ({ roomId, name, avatar }) => {
    socket.join(roomId);
    let game = await Game.findOne({ roomId }).populate('players');
    if (!game) {
      game = await Game.create({
        roomId,
        deck: createDeck(),
        discard: [],
        players: [],
        turnIndex: 0,
        direction: 1,
        started: false
      });
    }

    const player = await Player.create({
      socketId: socket.id,
      name,
      avatar,
      hand: []
    });
    game.players.push(player);
    player.hand = game.deck.splice(0,7);
    await player.save();
    await game.save();

    io.to(roomId).emit('lobbyUpdate', game.players.map(p=>({
      id: p.socketId, name: p.name, avatar: p.avatar
    })));

    if (game.players.length >= 2 && !game.started) {
      game.started = true;
      game.discard.push(game.deck.shift());
      await game.save();
      io.to(roomId).emit('gameStart', {
        discardTop: game.discard[0],
        players: game.players.map(p=>p.socketId)
      });
    }
  });

  socket.on('chatMessage', ({ roomId, msg }) => {
    io.to(roomId).emit('chatMessage', {
      from: socket.id,
      msg,
      timestamp: Date.now()
    });
  });

  socket.on('playCard', async ({ roomId, card }) => {
    const game = await Game.findOne({ roomId }).populate('players');
    const idx = game.players.findIndex(p=>p.socketId===socket.id);
    if (idx !== game.turnIndex) return;

    const player = game.players[idx];
    const top = game.discard[game.discard.length-1];
    if (
      card.color !== top.color &&
      card.value !== top.value &&
      card.color !== 'wild'
    ) {
      return socket.emit('illegalMove');
    }

    const handIdx = player.hand.findIndex(c=>c.color===card.color&&c.value===card.value);
    player.hand.splice(handIdx,1);
    game.discard.push(card);

    if (card.value === 'reverse') game.direction *= -1;
    if (card.value === 'skip') {
      game.turnIndex = (idx + game.direction + game.players.length) % game.players.length;
    }
    if (card.value === '+2' || card.value === '+4') {
      const count = card.value === '+2' ? 2 : 4;
      const next = (idx + game.direction + game.players.length) % game.players.length;
      const nextPlayer = game.players[next];
      const draw = game.deck.splice(0,count);
      nextPlayer.hand.push(...draw);
      io.to(nextPlayer.socketId).emit('cardDrawn', draw);
    }

    game.turnIndex = (game.turnIndex + game.direction + game.players.length) % game.players.length;
    await Promise.all([
      game.save(),
      player.save(),
      ...game.players.map(p=>p.save())
    ]);

    io.to(roomId).emit('cardPlayed', {
      card,
      nextPlayer: game.players[game.turnIndex].socketId,
      discardTop: card
    });

    if (player.hand.length === 1) {
      io.to(roomId).emit('mustCallUno', socket.id);
    }
    if (player.hand.length === 0) {
      io.to(roomId).emit('gameEnd', socket.id);
    }
  });

  socket.on('drawCard', async roomId => {
    const game = await Game.findOne({ roomId }).populate('players');
    const idx = game.players.findIndex(p=>p.socketId===socket.id);
    if (idx !== game.turnIndex) return;
    const player = game.players[idx];
    const draw = game.deck.shift();
    player.hand.push(draw);
    await player.save();

    game.turnIndex = (idx + 1) % game.players.length;
    await game.save();

    socket.emit('cardDrawn', [draw]);
    io.to(roomId).emit('nextTurn', game.players[game.turnIndex].socketId);
  });

  socket.on('disconnect', () => {
    // optional cleanup logic
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
