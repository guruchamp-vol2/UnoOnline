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
  .then(() => console.log('✅ MongoDB connected for Feedback'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

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
function drawCards(room, playerId, count) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    const drawn = room.deck.pop();
    room.players[playerId].push(drawn);
    cards.push(drawn);
  }
  if (playerId !== 'AI') {
    io.to(playerId).emit('cardDrawn', cards);
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
      const index = aiHand.indexOf(playable);
      aiHand.splice(index, 1);

      if (playable.color === 'wild') {
        const colors = ['red', 'green', 'blue', 'yellow'];
        const chosenColor = colors[Math.floor(Math.random() * colors.length)];
        playable.chosenColor = chosenColor;
        io.to(roomId).emit('aiDeclaredColor', chosenColor);
      }

      room.discard.push(playable);
      io.to(roomId).emit('cardPlayed', {
        card: { ...playable },
        nextPlayer: room.turnOrder[0],
        discardTop: playable,
        playerId: 'AI'
      });

      if (aiHand.length === 0) {
        io.to(roomId).emit('gameEnd', 'AI');
        room.started = false;
        return;
      }

      if (playable.value === '+2') {
        const target = room.turnOrder[1];
        drawCards(room, target, 2);
        room.turnOrder.shift();
      } else if (playable.value === '+4') {
        const target = room.turnOrder[1];
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
    if (room && room.host === socket.id) {
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

function startGame(roomId) {
  const room = rooms[roomId];
  room.deck = createDeck();

  // Ensure valid starting card
  do {
    room.discard = [room.deck.pop()];
  } while (['+2', '+4', 'skip', 'reverse', 'wild'].includes(room.discard[0].value));

  room.started = true;

  for (const playerId of Object.keys(room.players)) {
    room.players[playerId] = room.deck.splice(-7);
    if (playerId !== 'AI') {
      io.to(playerId).emit('hand', room.players[playerId]);
    }
  }

  io.to(roomId).emit('gameStart', { discardTop: room.discard[0] });
  io.to(roomId).emit('nextTurn', room.turnOrder[0]);

  if (room.turnOrder[0] === 'AI') {
    playAI(roomId);
  }
}

server.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
