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

function isPlayable(card, topCard, currentColor) {
  return (
    card.color === 'wild' ||
    card.color === currentColor ||
    card.value === topCard.value
  );
}

function playAI(roomId) {
  const room = rooms[roomId];
  if (!room || !room.started) return;

  const aiHand = room.players['AI'];
  const topCard = room.discard[room.discard.length - 1];
  const playable = aiHand.find(c => isPlayable(c, topCard, room.currentColor));

  setTimeout(() => {
    if (playable) {
      // If wild, choose color
      if (playable.color === 'wild') {
        const colors = ['red', 'green', 'blue', 'yellow'];
        playable.chosenColor = colors[Math.floor(Math.random() * colors.length)];
        room.currentColor = playable.chosenColor;
        io.to(roomId).emit('aiDeclaredColor', playable.chosenColor);
      } else {
        room.currentColor = playable.color;
      }

      room.discard.push(playable);
      aiHand.splice(aiHand.indexOf(playable), 1);

      io.to(roomId).emit('cardPlayed', {
        card: playable,
        nextPlayer: room.turnOrder[0],
        discardTop: room.discard[room.discard.length - 1],
        playerId: 'AI'
      });

      // If AI wins
      if (aiHand.length === 0) {
        io.to(roomId).emit('gameEnd', 'AI');
        room.started = false;
        return;
      }

      // Emit AI hand count
      io.to(roomId).emit('updateAIHandCount', aiHand.length);

      // Special handling: +4 → next player must draw 4 and skip
      if (playable.value === '+4') {
        handleDrawAndSkip(roomId, 4);
        return;
      }

      room.turnOrder.push(room.turnOrder.shift());
      io.to(roomId).emit('nextTurn', room.turnOrder[0]);

      if (room.turnOrder[0] === 'AI') {
        playAI(roomId);
      }
    } else {
      // No playable → draw card
      const drawn = room.deck.pop();
      aiHand.push(drawn);
      io.to(roomId).emit('cardDrawn', [drawn]);
      io.to(roomId).emit('updateAIHandCount', aiHand.length);

      room.turnOrder.push(room.turnOrder.shift());
      io.to(roomId).emit('nextTurn', room.turnOrder[0]);

      if (room.turnOrder[0] === 'AI') {
        playAI(roomId);
      }
    }
  }, 1000);
}

function handleDrawAndSkip(roomId, count) {
  const room = rooms[roomId];
  const nextPlayer = room.turnOrder[1];
  const drawnCards = [];

  for (let i = 0; i < count; i++) {
    if (room.deck.length === 0) room.deck = createDeck();
    drawnCards.push(room.deck.pop());
  }

  room.players[nextPlayer] = room.players[nextPlayer].concat(drawnCards);
  io.to(nextPlayer).emit('cardDrawn', drawnCards);

  // Emit AI hand count if AI in room
  if (room.players['AI']) {
    io.to(roomId).emit('updateAIHandCount', room.players['AI'].length);
  }

  // Skip turn of next player
  room.turnOrder.push(room.turnOrder.shift()); // Current player to back
  room.turnOrder.push(room.turnOrder.shift()); // Skip next player

  io.to(roomId).emit('nextTurn', room.turnOrder[0]);

  if (room.turnOrder[0] === 'AI') {
    playAI(roomId);
  }
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
        currentColor: null
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

    if (!isPlayable(card, topCard, room.currentColor)) {
      io.to(socket.id).emit('illegalMove');
      return;
    }

    if (card.color === 'wild' && card.chosenColor) {
      card.color = card.chosenColor;
      delete card.chosenColor;
      room.currentColor = card.color;
    } else {
      room.currentColor = card.color;
    }

    room.discard.push(card);
    playerHand.splice(playerHand.findIndex(c => c.color === card.color && c.value === card.value), 1);

    io.to(roomId).emit('cardPlayed', {
      card,
      nextPlayer: room.turnOrder[0],
      discardTop: room.discard[room.discard.length - 1],
      playerId: socket.id
    });

    // Check win
    if (playerHand.length === 0) {
      io.to(roomId).emit('gameEnd', socket.id);
      room.started = false;
      return;
    }

    // Emit AI hand count if AI in room
    if (room.players['AI']) {
      io.to(roomId).emit('updateAIHandCount', room.players['AI'].length);
    }

    // Special handling: +4 → next player must draw 4 and skip
    if (card.value === '+4') {
      handleDrawAndSkip(roomId, 4);
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

    if (room.players['AI']) {
      io.to(roomId).emit('updateAIHandCount', room.players['AI'].length);
    }

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
  room.currentColor = room.discard[0].color;

  for (const playerId of Object.keys(room.players)) {
    room.players[playerId] = room.deck.splice(-7);
    if (playerId !== 'AI') {
      io.to(playerId).emit('hand', room.players[playerId]);
    }
  }

  io.to(roomId).emit('gameStart', { discardTop: room.discard[room.discard.length - 1], color: room.currentColor });
  io.to(roomId).emit('nextTurn', room.turnOrder[0]);

  if (room.players['AI']) {
    io.to(roomId).emit('updateAIHandCount', room.players['AI'].length);
  }

  if (room.turnOrder[0] === 'AI') {
    playAI(roomId);
  }
}

server.listen(3000, () => console.log('🚀 Server on 3000'));
