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
const drawBtn = document.getElementById('draw');
const playAgainBtn = document.getElementById('playAgain');

let currentRoom = '';
let myTurn = false;

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

socket.on('gameStart', ({ discardTop }) => {
  lobby.classList.add('hidden');
  gameDiv.classList.remove('hidden');
  updateDiscard(discardTop);
});

socket.on('hand', cards => renderHand(cards));

socket.on('cardDrawn', cards => cards.forEach(c => addCard(c)));

socket.on('cardPlayed', ({ card, nextPlayer, discardTop }) => {
  updateDiscard(discardTop);
  myTurn = socket.id === nextPlayer;
  statusDiv.textContent = myTurn ? 'Your turn!' : 'Waiting...';
  drawBtn.disabled = !myTurn;
});

socket.on('nextTurn', next => {
  myTurn = socket.id === next;
  statusDiv.textContent = myTurn ? 'Your turn!' : 'Waiting...';
  drawBtn.disabled = !myTurn;
});

socket.on('illegalMove', () => alert('Illegal move!'));

socket.on('gameEnd', winner => {
  alert(winner === socket.id ? 'You win!' : (winner === 'AI' ? 'AI wins!' : 'You lose...'));
  playAgainBtn.classList.remove('hidden');
});

function renderHand(cards) {
  handDiv.innerHTML = '';
  cards.forEach(addCard);
}

function addCard(card) {
  const el = document.createElement('div');
  el.className = `card ${card.color}`;
  el.textContent = card.value;
  el.onclick = () => {
    if (!myTurn) return;
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
  app.use(express.static('../client'));

}
