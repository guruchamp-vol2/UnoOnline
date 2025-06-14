const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Feedback = require('./models/Feedback');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected for Feedback'))
  .catch(err => console.error('❌ MongoDB error:', err));

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

function applyCardEffect(room, card) {
  let extraDraw = 0;
  let skipNext = false;
  let reverseOrder = false;

  if (card.value === '+2') {
    extraDraw = 2;
  } else if (card.value === '+4') {
    extraDraw = 4;
  } else if (card.value === 'skip') {
    skipNext = true;
  } else if (card.value === 'reverse') {
    reverseOrder = true;
  }

  return { extraDraw, skipNext, reverseOrder };
}

function playAI(roomId) {
  const room = rooms[roomId];
  if (!room || !room.started) return;

  const aiHand = room.players['AI'];
  const topCard = room.discard[room.discard.length - 1];
  const currentColor = topCard.chosenColor || topCard.color;
  const playable = aiHand.find(c => isPlayable(c, topCard, currentColor));

  setTimeout(() => {
    if (!room.started) return;

    if (playable) {
      if (playable.color === 'wild') {
        const colors = ['red', 'green', 'blue', 'yellow'];
        const chosenColor = colors[Math.floor(Math.random() * colors.length)];
        playable.chosenColor = chosenColor;
        io.to(roomId).emit('aiDeclaredColor', chosenColor);
      }

      room.discard.push(playable);
      aiHand.splice(aiHand.indexOf(playable), 1);

      const discardTop = { ...playable };
      if (playable.color === 'wild' && playable.chosenColor) {
        discardTop.chosenColor = playable.chosenColor;
      }

      io.to(roomId).emit('cardPlayed', {
        card: discardTop,
        nextPlayer: room.turnOrder[0],
        discardTop: discardTop,
        playerId: 'AI'
      });

      io.to(roomId).emit('updateAIHandCount', aiHand.length);

      if (aiHand.length === 0) {
        io.to(roomId).emit('gameEnd', 'AI');
        room.started = false;
        return;
      }

      const { extraDraw, skipNext, reverseOrder } = applyCardEffect(room, playable);

      if (reverseOrder) {
        room.turnOrder.reverse();
      }

      // Apply extraDraw BEFORE shifting turn
      const nextPlayer = room.turnOrder[0];
      if (extraDraw > 0) {
        const drawnCards = [];
        for (let i = 0; i < extraDraw; i++) {
          drawnCards.push(room.deck.pop());
        }
        if (nextPlayer !== 'AI') {
          room.players[nextPlayer].push(...drawnCards);
          io.to(nextPlayer).emit('cardDrawn', drawnCards);
        } else {
          room.players['AI'].push(...drawnCards);
          io.to(roomId).emit('updateAIHandCount', room.players['AI'].length);
        }
      }

      room.turnOrder.push(room.turnOrder.shift());

      if (skipNext) {
        room.turnOrder.push(room.turnOrder.shift());
      }

      io.to(roomId).emit('nextTurn', room.turnOrder[0]);

      if (room.turnOrder[0] === 'AI') {
        playAI(roomId);
      }
    } else {
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

io.on('connection', socket => {
  socket.on('joinGame', ({ roomId, name, vsAI }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: {},
        turnOrder: [],
        deck: createDeck(),
        discard: [],
        started: false,
        host: socket.id
      };
    }

    rooms[roomId].players[socket.id] = [];
    rooms[roomId].turnOrder.push(socket.id);
    socket.join(roomId);

    io.emit('roomList', Object.fromEntries(Object.entries(rooms).map(([id, room]) => [id, Object.keys(room.players).length])));

    io.to(roomId).emit('hostInfo', rooms[roomId].host);

    if (vsAI && !rooms[roomId].players['AI']) {
      rooms[roomId].players['AI'] = [];
      rooms[roomId].turnOrder.push('AI');
      startGame(roomId);
    }
  });

  socket.on('startGame', roomId => {
    if (rooms[roomId] && rooms[roomId].host === socket.id && !rooms[roomId].started) {
      startGame(roomId);
    }
  });

  socket.on('playCard', ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room || room.turnOrder[0] !== socket.id) return;

    const playerHand = room.players[socket.id];
    const topCard = room.discard[room.discard.length - 1];
    const currentColor = topCard.chosenColor || topCard.color;

    if (!isPlayable(card, topCard, currentColor)) {
      io.to(socket.id).emit('illegalMove');
      return;
    }

    if (card.color === 'wild' && card.chosenColor) {
      io.to(roomId).emit('aiDeclaredColor', card.chosenColor);
    }

    room.discard.push(card);
    playerHand.splice(playerHand.findIndex(c =>
      c.color === card.color &&
      c.value === card.value
    ), 1);

    const discardTop = { ...card };
    if (card.color === 'wild' && card.chosenColor) {
      discardTop.chosenColor = card.chosenColor;
    }

    io.to(roomId).emit('cardPlayed', {
      card: discardTop,
      nextPlayer: room.turnOrder[0],
      discardTop: discardTop,
      playerId: socket.id
    });

    if (playerHand.length === 0) {
      io.to(roomId).emit('gameEnd', socket.id);
      room.started = false;
      return;
    }

    const { extraDraw, skipNext, reverseOrder } = applyCardEffect(room, card);

    if (reverseOrder) {
      room.turnOrder.reverse();
    }

    // Apply extraDraw BEFORE shifting turn
    const nextPlayer = room.turnOrder[0];
    if (extraDraw > 0) {
      const drawnCards = [];
      for (let i = 0; i < extraDraw; i++) {
        drawnCards.push(room.deck.pop());
      }
      if (nextPlayer !== 'AI') {
        room.players[nextPlayer].push(...drawnCards);
        io.to(nextPlayer).emit('cardDrawn', drawnCards);
      } else {
        room.players['AI'].push(...drawnCards);
        io.to(roomId).emit('updateAIHandCount', room.players['AI'].length);
      }
    }

    room.turnOrder.push(room.turnOrder.shift());

    if (skipNext) {
      room.turnOrder.push(room.turnOrder.shift());
    }

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

        if (room.host === socket.id && Object.keys(room.players).length > 0) {
          room.host = Object.keys(room.players)[0];
        }

        io.emit('roomList', Object.fromEntries(Object.entries(rooms).map(([id, r]) => [id, Object.keys(r.players).length])));
        io.to(roomId).emit('hostInfo', room.host);
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

// === Feedback API ===
app.post('/feedback', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !message) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    const fb = new Feedback({ name, email, message });
    await fb.save();
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Feedback save error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// === Feedback List Page ===
app.get('/feedback-list', async (req, res) => {
  try {
    const feedbacks = await Feedback.find().sort({ createdAt: -1 });
    let html = '<h1>Feedback List</h1>';

    feedbacks.forEach(fb => {
      html += `
        <div style="border:1px solid #ccc; padding:10px; margin:10px;">
          <strong>Name:</strong> ${fb.name} <br>
          <strong>Email:</strong> ${fb.email || 'N/A'} <br>
          <strong>Message:</strong> ${fb.message} <br>
          <strong>Date:</strong> ${fb.createdAt ? new Date(fb.createdAt).toLocaleString() : 'N/A'} <br>
        </div>
      `;
    });

    res.send(html);
  } catch (err) {
    res.status(500).send('Error loading feedback.');
  }
});

server.listen(3000, () => console.log('🚀 Server on 3000'));
