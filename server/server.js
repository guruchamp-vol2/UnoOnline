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

// MongoDB setup
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected for Feedback'))
.catch(err => console.error('❌ MongoDB connection error:', err));

let rooms = {};

// Deck creation
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
  const drawnCards = [];
  for (let i = 0; i < count; i++) {
    const card = room.deck.pop();
    room.players[playerId].push(card);
    drawnCards.push(card);
  }
  if (playerId !== 'AI') {
    io.to(playerId).emit('cardDrawn', drawnCards);
  }
}

// AI Logic
function getAIMove(gameState, aiHand) {
  const { discardTop, currentColor, currentPlayer, players } = gameState;
  
  // First, check if we can play any cards
  const playableCards = aiHand.filter(card => 
    card.color === currentColor || 
    card.value === discardTop.value ||
    card.color === 'wild'
  );

  // Strategy: Play special cards if they're beneficial
  const specialCards = playableCards.filter(card => 
    card.value === '+2' || 
    card.value === 'skip' || 
    card.value === 'reverse' ||
    card.color === 'wild'
  );

  // If we have special cards and opponent has few cards, use them
  const opponent = players.find(p => p.id !== 'AI');
  if (specialCards.length > 0 && opponent.hand.length <= 3) {
    // Prioritize +2 and wild +4 if opponent has few cards
    const drawCards = specialCards.filter(card => 
      card.value === '+2' || 
      (card.color === 'wild' && card.value === '+4')
    );
    if (drawCards.length > 0) {
      const card = drawCards[0];
      if (card.color === 'wild') {
        // Choose the color we have most of
        const colorCounts = aiHand.reduce((acc, c) => {
          if (c.color !== 'wild') acc[c.color] = (acc[c.color] || 0) + 1;
          return acc;
        }, {});
        const chosenColor = Object.entries(colorCounts)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || 'red';
        return { card, chosenColor };
      }
      return { card };
    }
  }

  // If we have a wild card and no good matches, use it
  const wildCards = playableCards.filter(card => card.color === 'wild');
  if (wildCards.length > 0 && playableCards.length === wildCards.length) {
    const card = wildCards[0];
    // Choose the color we have most of
    const colorCounts = aiHand.reduce((acc, c) => {
      if (c.color !== 'wild') acc[c.color] = (acc[c.color] || 0) + 1;
      return acc;
    }, {});
    const chosenColor = Object.entries(colorCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'red';
    return { card, chosenColor };
  }

  // If we have playable cards, play the one that leaves us with the best hand
  if (playableCards.length > 0) {
    // Prefer playing cards that match the current color
    const colorMatches = playableCards.filter(card => card.color === currentColor);
    if (colorMatches.length > 0) {
      return { card: colorMatches[0] };
    }
    // Otherwise play any matching card
    return { card: playableCards[0] };
  }

  // If we can't play, we must draw
  return { action: 'draw' };
}

// Update the game loop to include AI moves
function gameLoop(roomId) {
  const gameState = games.get(roomId);
  if (!gameState) return;

  const { currentPlayer, players } = gameState;
  const currentPlayerObj = players.find(p => p.id === currentPlayer);

  // If it's AI's turn
  if (currentPlayer === 'AI') {
    setTimeout(() => {
      const aiMove = getAIMove(gameState, currentPlayerObj.hand);
      
      if (aiMove.action === 'draw') {
        // Draw a card
        const drawnCard = gameState.deck.pop();
        currentPlayerObj.hand.push(drawnCard);
        
        // Check if we can play the drawn card
        const canPlayDrawnCard = 
          drawnCard.color === gameState.currentColor ||
          drawnCard.value === gameState.discardTop.value ||
          drawnCard.color === 'wild';

        if (canPlayDrawnCard) {
          // Play the drawn card
          const cardIndex = currentPlayerObj.hand.indexOf(drawnCard);
          currentPlayerObj.hand.splice(cardIndex, 1);
          gameState.discardTop = drawnCard;
          
          if (drawnCard.color === 'wild') {
            // Choose the color we have most of
            const colorCounts = currentPlayerObj.hand.reduce((acc, c) => {
              if (c.color !== 'wild') acc[c.color] = (acc[c.color] || 0) + 1;
              return acc;
            }, {});
            const chosenColor = Object.entries(colorCounts)
              .sort((a, b) => b[1] - a[1])[0]?.[0] || 'red';
            gameState.currentColor = chosenColor;
            io.to(roomId).emit('aiDeclaredColor', chosenColor);
          } else {
            gameState.currentColor = drawnCard.color;
          }
        }

        // Update game state
        io.to(roomId).emit('cardDrawn', [drawnCard], 'AI');
        io.to(roomId).emit('updateAIHandCount', currentPlayerObj.hand.length);
        
        // Move to next player
        const nextPlayer = getNextPlayer(gameState);
        gameState.currentPlayer = nextPlayer;
        io.to(roomId).emit('nextTurn', nextPlayer);
      } else {
        // Play the chosen card
        const { card, chosenColor } = aiMove;
        const cardIndex = currentPlayerObj.hand.indexOf(card);
        currentPlayerObj.hand.splice(cardIndex, 1);
        gameState.discardTop = card;

        if (card.color === 'wild') {
          gameState.currentColor = chosenColor;
          io.to(roomId).emit('aiDeclaredColor', chosenColor);
        } else {
          gameState.currentColor = card.color;
        }

        // Handle special cards
        if (card.value === '+2') {
          const nextPlayer = getNextPlayer(gameState);
          const nextPlayerObj = players.find(p => p.id === nextPlayer);
          for (let i = 0; i < 2; i++) {
            nextPlayerObj.hand.push(gameState.deck.pop());
          }
          io.to(roomId).emit('cardDrawn', nextPlayerObj.hand.slice(-2), nextPlayer);
        } else if (card.value === 'skip') {
          // Skip next player's turn
          gameState.currentPlayer = getNextPlayer(gameState);
        } else if (card.value === 'reverse') {
          gameState.direction *= -1;
        }

        // Update game state
        io.to(roomId).emit('cardPlayed', {
          card,
          nextPlayer: getNextPlayer(gameState),
          discardTop: gameState.discardTop,
          playerId: 'AI'
        });
        io.to(roomId).emit('updateAIHandCount', currentPlayerObj.hand.length);

        // Check for win
        if (currentPlayerObj.hand.length === 0) {
          io.to(roomId).emit('gameEnd', 'AI');
          return;
        }

        // Move to next player
        gameState.currentPlayer = getNextPlayer(gameState);
        io.to(roomId).emit('nextTurn', gameState.currentPlayer);
      }
    }, 1000); // Add a 1-second delay to make AI moves feel more natural
  }
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

  socket.on('playCard', ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room || !room.started) return;

    const playerId = socket.id;
    const topCard = room.discard[room.discard.length - 1];
    const currentColor = topCard.chosenColor || topCard.color;

    // Validate the move
    if (!isPlayable(card, topCard, currentColor)) {
      io.to(playerId).emit('illegalMove');
      return;
    }

    // Remove card from player's hand
    const playerHand = room.players[playerId];
    const cardIndex = playerHand.findIndex(c => 
      c.color === card.color && c.value === card.value
    );
    if (cardIndex === -1) return;
    playerHand.splice(cardIndex, 1);

    // Add card to discard pile
    room.discard.push(card);

    // Handle special cards
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

    // Check for winner
    if (playerHand.length === 0) {
      room.started = false;
      io.to(roomId).emit('gameEnd', playerId);
      return;
    }

    // Move to next player
    room.turnOrder.push(room.turnOrder.shift());
    nextPlayer = room.turnOrder[0];

    // Notify all players
    io.to(roomId).emit('cardPlayed', {
      card,
      nextPlayer,
      discardTop: card,
      playerId
    });

    // If next player is AI, trigger AI move
    if (nextPlayer === 'AI') {
      playAI(roomId);
    }
  });

  socket.on('drawCard', roomId => {
    const room = rooms[roomId];
    if (!room || !room.started) return;

    const playerId = socket.id;
    if (room.turnOrder[0] !== playerId) return;

    // Draw a card
    const card = room.deck.pop();
    room.players[playerId].push(card);

    // Move to next player
    room.turnOrder.push(room.turnOrder.shift());
    const nextPlayer = room.turnOrder[0];

    // Notify the player
    io.to(playerId).emit('cardDrawn', [card]);
    io.to(roomId).emit('nextTurn', nextPlayer);

    // If next player is AI, trigger AI move
    if (nextPlayer === 'AI') {
      playAI(roomId);
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

// === Game Start ===
function startGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.deck = createDeck();
  room.discard = [];
  room.started = true;

  // Deal initial cards
  for (let playerId in room.players) {
    room.players[playerId] = [];
    for (let i = 0; i < 7; i++) {
      room.players[playerId].push(room.deck.pop());
    }
  }

  // Start with a non-special card
  let firstCard;
  do {
    firstCard = room.deck.pop();
  } while (firstCard.color === 'wild' || firstCard.value === '+2' || firstCard.value === 'skip' || firstCard.value === 'reverse');

  room.discard.push(firstCard);

  // Notify all players
  for (let playerId in room.players) {
    if (playerId !== 'AI') {
      io.to(playerId).emit('gameStart', {
        discardTop: firstCard,
        color: firstCard.color
      });
      io.to(playerId).emit('hand', room.players[playerId]);
    }
  }

  // Start with first player
  io.to(roomId).emit('nextTurn', room.turnOrder[0]);
  if (room.turnOrder[0] === 'AI') {
    playAI(roomId);
  }
}

// === Start Server ===
server.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
