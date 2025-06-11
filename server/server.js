const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, '..', 'client')));


let rooms = {};

function createDeck() {
  const colors = ['red', 'green', 'blue', 'yellow'];
  const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', '+2'];
  const deck = [];

  colors.forEach(color => {
    values.forEach(value => {
      deck.push({ color, value });
      if (value !== '0') deck.push({ color, value });
    });
  });

  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'wild' });
    deck.push({ color: 'wild', value: '+4' });
  }

  return shuffle(deck);
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function isPlayable(card, topCard) {
  return (
    card.color === 'wild' ||
    card.color === topCard.color ||
    card.value === topCard.value
  );
}

function playAI(roomId) {
  const room = rooms[roomId];
  if (!room || !room.started) return;

  const aiHand = room.players['AI'];
  const topCard = room.discard[room.discard.length - 1];
  const playable = aiHand.find(c => isPlayable(c, topCard));

  setTimeout(() => {
    if (playable) {
      room.discard.push(playable);
      aiHand.splice(aiHand.indexOf(playable), 1);
      io.to(roomId).emit('cardPlayed', {
        card: playable,
        nextPlayer: room.turnOrder[0],
        discardTop: room.discard[room.discard.length - 1],
      });
    } else {
      const drawn = room.deck.pop();
      aiHand.push(drawn);
      io.to(roomId).emit('cardDrawn', [drawn]);
    }

    // Check if AI wins
    if (aiHand.length === 0) {
      io.to(roomId).emit('gameEnd', 'AI');
      room.started = false;
      return;
    }

    // Next turn
    room.turnOrder.push(room.turnOrder.shift());
    io.to(roomId).emit('nextTurn', room.turnOrder[0]);

    if (room.turnOrder[0] === 'AI') {
      playAI(roomId);
    }
  }, 1000);
}

io.on('connection', socket => {
  socket.on('joinGame', ({ roomId, name, vsAI }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: {},
        turnOrder: [],
        deck: createDeck(),
        discard: [],
        started: false,
      };
    }

    rooms[roomId].players[socket.id] = [];
    rooms[roomId].turnOrder.push(socket.id);
    socket.join(roomId);

    io.emit('roomList', Object.fromEntries(Object.entries(rooms).map(([id, room]) => [id, Object.keys(room.players).length])));

    if (vsAI && !rooms[roomId].players['AI']) {
      rooms[roomId].players['AI'] = [];
      rooms[roomId].turnOrder.push('AI');
    }

    if (Object.keys(rooms[roomId].players).length >= 2 || vsAI) {
      startGame(roomId);
    }
  });

  socket.on('playCard', ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room || room.turnOrder[0] !== socket.id) return;

    const playerHand = room.players[socket.id];
    const topCard = room.discard[room.discard.length - 1];

    if (!isPlayable(card, topCard)) {
      io.to(socket.id).emit('illegalMove');
      return;
    }

    room.discard.push(card);
    playerHand.splice(playerHand.findIndex(c => c.color === card.color && c.value === card.value), 1);

    io.to(roomId).emit('cardPlayed', {
      card,
      nextPlayer: room.turnOrder[0],
      discardTop: room.discard[room.discard.length - 1],
    });

    // Check win
    if (playerHand.length === 0) {
      io.to(roomId).emit('gameEnd', socket.id);
      room.started = false;
      return;
    }

    room.turnOrder.push(room.turnOrder.shift());
    io.to(roomId).emit('nextTurn', room.turnOrder[0]);

    if (room.turnOrder[0] === 'AI') {
      playAI(roomId);
    }
  });

  socket.on('drawCard', roomId => {
    const room = rooms[roomId];
    if (!room || room.turnOrder[0] !== socket.id) return;

    const drawn = room.deck.pop();
    room.players[socket.id].push(drawn);
    io.to(socket.id).emit('cardDrawn', [drawn]);

    room.turnOrder.push(room.turnOrder.shift());
    io.to(roomId).emit('nextTurn', room.turnOrder[0]);

    if (room.turnOrder[0] === 'AI') {
      playAI(roomId);
    }
  });

  socket.on('restartGame', roomId => {
    startGame(roomId);
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        room.turnOrder = room.turnOrder.filter(id => id !== socket.id);
        io.emit('roomList', Object.fromEntries(Object.entries(rooms).map(([id, r]) => [id, Object.keys(r.players).length])));
      }
    }
  });
});

function startGame(roomId) {
  const room = rooms[roomId];
  room.deck = createDeck();
  room.discard = [room.deck.pop()];
  room.started = true;

  for (const playerId of Object.keys(room.players)) {
    room.players[playerId] = room.deck.splice(-7);
    if (playerId !== 'AI') {
      io.to(playerId).emit('hand', room.players[playerId]);
    }
  }

  io.to(roomId).emit('gameStart', { discardTop: room.discard[room.discard.length - 1] });
  io.to(roomId).emit('nextTurn', room.turnOrder[0]);

  if (room.turnOrder[0] === 'AI') {
    playAI(roomId);
  }
}

server.listen(3000, () => console.log('🚀 Server on 3000'));
