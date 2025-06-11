const socket = io(window.location.origin, { transports: ['websocket'] });

const joinBtn = document.getElementById('join');
const playAIBtn = document.getElementById('playAI');
const roomListDiv = document.getElementById('roomList');
const roomInput = document.getElementById('room');
const nameInput = document.getElementById('name');
const lobby = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const handDiv = document.getElementById('hand');
const discardDiv = document.getElementById('discard');
const statusDiv = document.getElementById('status');
const currentColorDisplay = document.getElementById('currentColorDisplay');
const currentTurnDisplay = document.getElementById('currentTurnDisplay');
const drawBtn = document.getElementById('draw');
const playAgainBtn = document.getElementById('playAgain');
const aiHandCountDiv = document.getElementById('aiHandCount');

let currentRoom = '';
let myTurn = false;
let myHand = [];
let currentColor = null;
let currentTurn = null;

joinBtn.onclick = () => {
  currentRoom = roomInput.value;
  socket.emit('joinGame', { roomId: currentRoom, name: nameInput.value });
};

playAIBtn.onclick = () => {
  currentRoom = 'AI-' + Date.now();
  socket.emit('joinGame', { roomId: currentRoom, name: nameInput.value, vsAI: true });
};

drawBtn.onclick = () => {
  socket.emit('drawCard', currentRoom);
};

playAgainBtn.onclick = () => {
  socket.emit('restartGame', currentRoom);
  playAgainBtn.classList.add('hidden');
  aiHandCountDiv.textContent = '';
  currentColor = null;
  currentTurn = null;
};

socket.on('roomList', rooms => {
  roomListDiv.innerHTML = Object.keys(rooms).map(r => 
    `<div class="room-item" onclick="joinRoom('${r}')">${r} (${rooms[r]} player(s))</div>`
  ).join('');
});

function joinRoom(roomId) {
  currentRoom = roomId;
  socket.emit('joinGame', { roomId: currentRoom, name: nameInput.value });
}

socket.on('gameStart', ({ discardTop, color, firstTurn }) => {
  lobby.classList.add('hidden');
  gameDiv.classList.remove('hidden');
  updateDiscard(discardTop);
  currentColor = color || discardTop.color;
  currentTurn = firstTurn;
  updateTurnDisplay();
});

socket.on('hand', cards => {
  myHand = cards;
  renderHand();
});

socket.on('cardDrawn', cards => {
  myHand = myHand.concat(cards);
  renderHand();
});

socket.on('cardPlayed', ({ card, nextPlayer, discardTop, playerId }) => {
  updateDiscard(discardTop);
  currentColor = discardTop.color; // Update current color
  currentTurn = nextPlayer;
  updateTurnDisplay();

  if (playerId === socket.id) {
    // Remove the played card from hand
    const index = myHand.findIndex(c => c.color === card.color && c.value === card.value);
    if (index !== -1) myHand.splice(index, 1);
    renderHand();
  }

  myTurn = socket.id === nextPlayer;
  statusDiv.textContent = myTurn ? `Your turn! (Current color: ${currentColor})` : `Waiting... (Current color: ${currentColor})`;
  drawBtn.disabled = !myTurn;
});

socket.on('nextTurn', next => {
  currentTurn = next;
  updateTurnDisplay();
  myTurn = socket.id === next;
  statusDiv.textContent = myTurn ? `Your turn! (Current color: ${currentColor})` : `Waiting... (Current color: ${currentColor})`;
  drawBtn.disabled = !myTurn;
});

socket.on('illegalMove', () => alert('Illegal move!'));

socket.on('gameEnd', winner => {
  alert(winner === socket.id ? 'You win!' : (winner === 'AI' ? 'AI wins!' : 'You lose...'));
  playAgainBtn.classList.remove('hidden');
});

socket.on('updateAIHandCount', count => {
  aiHandCountDiv.textContent = `AI has ${count} card${count !== 1 ? 's' : ''}`;
});

socket.on('aiDeclaredColor', color => {
  currentColor = color;
  currentColorDisplay.textContent = `AI chose color: ${color}`;
});

socket.on('forceDraw', ({ count }) => {
  alert(`You must draw ${count} card${count !== 1 ? 's' : ''}!`);
});

socket.on('updateCurrentColor', color => {
  currentColor = color;
  updateColorDisplay();
});

function renderHand() {
  handDiv.innerHTML = '';
  myHand.forEach(addCard);
}

function addCard(card) {
  const el = document.createElement('div');
  el.className = `card ${card.color}`;
  el.textContent = card.value;
  el.onclick = () => {
    if (!myTurn) return;

    if (card.color === 'wild') {
      const chosenColor = prompt("Choose a color (red, green, blue, yellow):", "red");
      if (!chosenColor || !['red', 'green', 'blue', 'yellow'].includes(chosenColor)) {
        alert('Invalid color!');
        return;
      }
      card.chosenColor = chosenColor;
    }

    socket.emit('playCard', { roomId: currentRoom, card });
  };
  handDiv.appendChild(el);
}

function updateDiscard(card) {
  discardDiv.innerHTML = '';
  const el = document.createElement('div');
  el.className = `card ${card.color}`;
  el.textContent = card.value;
  discardDiv.appendChild(el);
}

function updateColorDisplay() {
  currentColorDisplay.textContent = `Current Color: ${currentColor}`;
}

function updateTurnDisplay() {
  currentTurnDisplay.textContent = `Current Turn: ${currentTurn === socket.id ? 'YOU' : (currentTurn === 'AI' ? 'AI' : 'Other Player')}`;
}
