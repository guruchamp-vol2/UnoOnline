// server/server.js

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Feedback = require('./models/Feedback');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

let rooms = {};

function createDeck() {
  const colors = ['red', 'green', 'blue', 'yellow'];
  const values = ['0','1','2','3','4','5','6','7','8','9','skip','reverse','+2'];
  const deck = [];

  for (let color of colors) {
    for (let value of values) {
      deck.push({ color, value });
      if (value !== '0') deck.push({ color, value });
    }
  }

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
function drawCards(room, playerId, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    const card = room.deck.pop();
    room.players[playerId].push(card);
    drawn.push(card);
  }
  if (playerId !== 'AI') {
    io.to(playerId).emit('cardDrawn', drawn);
  }
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
      aiHand.splice(aiHand.indexOf(playable), 1);

      if (playable.color === 'wild') {
        const colors = ['red', 'green', 'blue', 'yellow'];
        playable.chosenColor = colors[Math.floor(Math.random() * colors.length)];
        io.to(roomId).emit('aiDeclaredColor', playable.chosenColor);
      }

      room.discard.push(playable);

      io.to(roomId).emit('cardPlayed', {
        card: { ...playable },
        nextPlayer: room.turnOrder[0],
        discardTop: playable,
        playerId: 'AI'
      });

      if (aiHand.length === 0) {
        room.started = false;
        io.to(roomId).emit('gameEnd', 'AI');
        return;
      }

      const target = room.turnOrder[1];
      if (playable.value === '+2') {
        drawCards(room, target, 2);
        room.turnOrder.shift();
      } else if (playable.value === '+4') {
        drawCards(room, target, 4);
        room.turnOrder.shift();
      } else if (playable.value === 'skip') {
        room.turnOrder.shift();
      } else if (playable.value === 'reverse' && room.turnOrder.length > 2) {
        room.turnOrder.reverse();
        room.turnOrder.push(room.turnOrder.shift());
        io.to(roomId).emit('nextTurn', room.turnOrder[0]);
        if (room.turnOrder[0] === 'AI') playAI(roomId);
        return;
      }

      room.turnOrder.push(room.turnOrder.shift());
    } else {
      const drawn = room.deck.pop();
      aiHand.push(drawn);
      io.to(roomId).emit('updateAIHandCount', aiHand.length);
      room.turnOrder.push(room.turnOrder.shift());
    }

    io.to(roomId).emit('updateAIHandCount', aiHand.length);
    io.to(roomId).emit('nextTurn', room.turnOrder[0]);

    if (room.turnOrder[0] === 'AI') playAI(roomId);
  }, 800);
}
io.on('connection', socket => {
  socket.on('joinGame', ({ roomId, name, vsAI }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        players: {},
        turnOrder: [],
        deck: [],
        discard: [],
        started: false,
        host: socket.id
      };
    }

    if (!rooms[roomId].players[socket.id]) {
      rooms[roomId].players[socket.id] = [];
      rooms[roomId].turnOrder.push(socket.id);
    }

    socket.join(roomId);
    io.to(socket.id).emit('hostInfo', rooms[roomId].host);

    if (vsAI && !rooms[roomId].players['AI']) {
      rooms[roomId].players['AI'] = [];
      rooms[roomId].turnOrder.push('AI');
    }

    io.emit('roomList', Object.fromEntries(
      Object.entries(rooms).map(([id, room]) => [id, Object.keys(room.players).length])
    ));
  });

  socket.on('startGame', roomId => {
    const room = rooms[roomId];
    if (room && socket.id === room.host) {
      startGame(roomId);
    }
  });

  socket.on('restartGame', roomId => {
    const room = rooms[roomId];
    if (room && room.host === socket.id) {
      startGame(roomId);
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        room.turnOrder = room.turnOrder.filter(id => id !== socket.id);
        if (room.turnOrder.length === 0) {
          delete rooms[roomId];
        } else {
          io.to(roomId).emit('roomList', rooms[roomId]);
        }
      }
    }
  });
});
socket.on('playCard', ({ roomId, card }) => {
  const room = rooms[roomId];
  if (!room || !room.started) return;

  const playerId = socket.id;
  const topCard = room.discard[room.discard.length - 1];
  const currentColor = topCard.chosenColor || topCard.color;

  if (!isPlayable(card, topCard, currentColor)) {
    io.to(playerId).emit('illegalMove');
    return;
  }

  const hand = room.players[playerId];
  const idx = hand.findIndex(c => c.color === card.color && c.value === card.value);
  if (idx === -1) return;
  hand.splice(idx, 1);
  room.discard.push(card);

  let nextPlayer = room.turnOrder[0];
  if (card.value === '+2') {
    const target = room.turnOrder[1];
    drawCards(room, target, 2);
    room.turnOrder.shift();
  } else if (card.value === '+4') {
    const target = room.turnOrder[1];
    drawCards(room, target, 4);
    room.turnOrder.shift();
  } else if (card.value === 'skip') {
    room.turnOrder.shift();
  } else if (card.value === 'reverse' && room.turnOrder.length > 2) {
    room.turnOrder.reverse();
    room.turnOrder.push(room.turnOrder.shift());
  }

  if (hand.length === 0) {
    room.started = false;
    io.to(roomId).emit('gameEnd', playerId);
    return;
  }

  room.turnOrder.push(room.turnOrder.shift());
  nextPlayer = room.turnOrder[0];

  io.to(roomId).emit('cardPlayed', {
    card,
    nextPlayer,
    discardTop: card,
    playerId
  });

  if (nextPlayer === 'AI') {
    playAI(roomId);
  }
});

socket.on('drawCard', roomId => {
  const room = rooms[roomId];
  if (!room || !room.started) return;
  const playerId = socket.id;
  if (room.turnOrder[0] !== playerId) return;

  const card = room.deck.pop();
  room.players[playerId].push(card);

  room.turnOrder.push(room.turnOrder.shift());
  const nextPlayer = room.turnOrder[0];

  io.to(playerId).emit('cardDrawn', [card]);
  io.to(roomId).emit('nextTurn', nextPlayer);

  if (nextPlayer === 'AI') {
    playAI(roomId);
  }
});
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
            <strong>Date:</strong> ${new Date(fb.createdAt).toLocaleString()} <br>
          </div>
        `;
      });
      res.send(html);
    } catch (err) {
      console.error(err);
      res.status(500).send('Error loading feedback.');
    }
  });

  // === Game Start ===
  function startGame(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.deck = createDeck();
    room.discard = [];
    room.started = true;

    for (let playerId in room.players) {
      room.players[playerId] = [];
      for (let i = 0; i < 7; i++) {
        room.players[playerId].push(room.deck.pop());
      }
    }

    let firstCard;
    do {
      firstCard = room.deck.pop();
    } while (
      firstCard.color === 'wild' ||
      ['+2', '+4', 'skip', 'reverse'].includes(firstCard.value)
    );
    room.discard.push(firstCard);

    for (let playerId in room.players) {
      if (playerId !== 'AI') {
        io.to(playerId).emit('gameStart', {
          discardTop: firstCard,
          color: firstCard.color
        });
        io.to(playerId).emit('hand', room.players[playerId]);
      }
    }

    io.to(roomId).emit('nextTurn', room.turnOrder[0]);
    if (room.turnOrder[0] === 'AI') {
      playAI(roomId);
    }
  }
// === Start Server ===
server.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
