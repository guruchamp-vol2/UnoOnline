const socket = io(window.location.origin, { transports: ['websocket'] });

const joinBtn = document.getElementById('join');
const playAIBtn = document.getElementById('playAI');
const startGameBtn = document.getElementById('startGame');
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
const aiHandCountDiv = document.getElementById('aiHandCount');
const feedbackStatus = document.getElementById('feedbackStatus');

let currentRoom = '';
let myTurn = false;
let myHand = [];
let currentColor = null;
let isHost = false;
let isVsAI = false;
joinBtn.onclick = () => {
  currentRoom = roomInput.value;
  isVsAI = false;
  socket.emit('joinGame', { roomId: currentRoom, name: nameInput.value });
};

playAIBtn.onclick = () => {
  playAIBtn.disabled = true;
  currentRoom = 'AI-' + Date.now();
  isVsAI = true;
  socket.emit('joinGame', { roomId: currentRoom, name: nameInput.value, vsAI: true });
};

startGameBtn.onclick = () => {
  socket.emit('startGame', currentRoom);
  startGameBtn.classList.add('hidden');
};

drawBtn.onclick = () => {
  if (!myTurn) return;
  socket.emit('drawCard', currentRoom);
};

playAgainBtn.onclick = () => {
  socket.emit('restartGame', currentRoom);
  playAgainBtn.classList.add('hidden');
  aiHandCountDiv.textContent = '';
  currentColor = null;
};
socket.on('hostInfo', hostId => {
  isHost = (socket.id === hostId);
  startGameBtn.classList.toggle('hidden', !isHost);
});

socket.on('gameStart', ({ discardTop, color }) => {
  lobby.classList.add('hidden');
  gameDiv.classList.remove('hidden');
  updateDiscard(discardTop);
  currentColor = color || discardTop.chosenColor || discardTop.color;
});

socket.on('hand', cards => {
  myHand = cards;
  renderHand();
});

socket.on('cardDrawn', cards => {
  myHand = myHand.concat(cards);
  renderHand();
  myTurn = false;
  drawBtn.disabled = true;
  statusDiv.textContent = `Waiting... (Current color: ${currentColor})`;
});
socket.on('cardPlayed', ({ card, nextPlayer, discardTop, playerId }) => {
  updateDiscard(discardTop);
  currentColor = discardTop.chosenColor || discardTop.color;

  if (playerId === socket.id) {
    const index = myHand.findIndex(c => cardsAreEqual(c, card));
    if (index !== -1) myHand.splice(index, 1);
    renderHand();
  }

  myTurn = socket.id === nextPlayer;
  drawBtn.disabled = !myTurn;
  statusDiv.textContent = myTurn
    ? `Your turn! (Current color: ${currentColor})`
    : `Waiting... (Current color: ${currentColor})`;
});

socket.on('nextTurn', next => {
  myTurn = socket.id === next;
  drawBtn.disabled = !myTurn;
  statusDiv.textContent = myTurn
    ? `Your turn! (Current color: ${currentColor})`
    : `Waiting... (Current color: ${currentColor})`;
});
socket.on('illegalMove', () => alert('Illegal move!'));

socket.on('updateAIHandCount', count => {
  aiHandCountDiv.textContent = `AI has ${count} card${count !== 1 ? 's' : ''}`;
});

socket.on('aiDeclaredColor', color => {
  currentColor = color;
  statusDiv.textContent = `AI chose ${color} color!`;
});

socket.on('gameEnd', winner => {
  alert(winner === socket.id ? 'You win!' : winner === 'AI' ? 'AI wins!' : 'You lose...');
  playAgainBtn.classList.remove('hidden');
  playAIBtn.disabled = false; // Allow retrying AI game
});
// === Feedback submission ===
document.getElementById('submitFeedback').onclick = () => {
  const name = document.getElementById('fbName').value.trim();
  const email = document.getElementById('fbEmail').value.trim();
  const message = document.getElementById('fbMessage').value.trim();

  if (!name || !message) {
    feedbackStatus.innerText = 'Please fill in required fields.';
    return;
  }

  fetch('/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, email, message })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      feedbackStatus.innerText = '✅ Feedback submitted successfully!';
      document.getElementById('fbName').value = '';
      document.getElementById('fbEmail').value = '';
      document.getElementById('fbMessage').value = '';
    } else {
      feedbackStatus.innerText = '❌ Error submitting feedback.';
    }
  })
  .catch(err => {
    console.error(err);
    feedbackStatus.innerText = '❌ Server error during submission.';
  });
};
