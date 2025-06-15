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
const currentColorDisplay = document.getElementById('currentColorDisplay');
const currentTurnDisplay = document.getElementById('currentTurnDisplay');
const feedbackStatus = document.getElementById('feedbackStatus');
const fbNameInput = document.getElementById('fbName');
const fbEmailInput = document.getElementById('fbEmail');
const fbMessageInput = document.getElementById('fbMessage');

let currentRoom = '';
let myTurn = false;
let myHand = [];
let currentColor = null;
let isHost = false;
let isVsAI = false;

// Color Picker Modal - now returns a Promise to resolve chosen color
function showColorPicker() {
  return new Promise(resolve => {
    const colors = ['red', 'green', 'blue', 'yellow'];
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '50%';
    modal.style.left = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.backgroundColor = 'white';
    modal.style.padding = '20px';
    modal.style.borderRadius = '10px';
    modal.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
    modal.style.zIndex = '1000';

    const title = document.createElement('h3');
    title.textContent = 'Choose a color';
    modal.appendChild(title);

    const colorContainer = document.createElement('div');
    colorContainer.style.display = 'flex';
    colorContainer.style.gap = '10px';
    colorContainer.style.marginTop = '15px';

    colors.forEach(color => {
      const colorBtn = document.createElement('button');
      colorBtn.style.width = '50px';
      colorBtn.style.height = '50px';
      colorBtn.style.borderRadius = '50%';
      colorBtn.style.border = 'none';
      colorBtn.style.cursor = 'pointer';
      colorBtn.style.backgroundColor = color;
      colorBtn.onclick = () => {
        document.body.removeChild(modal);
        resolve(color);
      };
      colorContainer.appendChild(colorBtn);
    });

    modal.appendChild(colorContainer);
    document.body.appendChild(modal);
  });
}
joinBtn.onclick = () => {
  if (!nameInput.value.trim()) {
    alert('Please enter your name');
    return;
  }
  currentRoom = roomInput.value || 'room-' + Date.now();
  isVsAI = false;
  socket.emit('joinGame', { roomId: currentRoom, name: nameInput.value });
};

playAIBtn.onclick = () => {
  if (!nameInput.value.trim()) {
    alert('Please enter your name');
    return;
  }
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
  updateColorDisplay();
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
  updateStatus();
});
socket.on('cardPlayed', ({ card, nextPlayer, discardTop, playerId }) => {
  updateDiscard(discardTop);
  currentColor = discardTop.chosenColor || discardTop.color;
  updateColorDisplay();

  if (playerId === socket.id) {
    const index = myHand.findIndex(c => cardsAreEqual(c, card));
    if (index !== -1) myHand.splice(index, 1);
    renderHand();
  }

  myTurn = socket.id === nextPlayer;
  drawBtn.disabled = !myTurn;
  updateStatus();
});

socket.on('nextTurn', next => {
  myTurn = socket.id === next;
  drawBtn.disabled = !myTurn;
  updateStatus();
});

socket.on('illegalMove', () => {
  alert('Illegal move! The card must match the current color or value.');
});

socket.on('updateAIHandCount', count => {
  aiHandCountDiv.textContent = `AI has ${count} card${count !== 1 ? 's' : ''}`;
});

socket.on('aiDeclaredColor', color => {
  currentColor = color;
  updateColorDisplay();
  statusDiv.textContent = `AI chose ${color} color!`;
});

socket.on('gameEnd', winner => {
  const message = winner === socket.id
    ? 'You win!' : winner === 'AI'
    ? 'AI wins!' : 'You lose...';
  alert(message);
  playAgainBtn.classList.remove('hidden');
  playAIBtn.disabled = false;
});
function updateStatus() {
  statusDiv.textContent = myTurn
    ? `Your turn! (Current color: ${currentColor})`
    : `Waiting... (Current color: ${currentColor})`;
  currentTurnDisplay.textContent = myTurn ? "It's your turn!" : "Waiting for other player...";
}

function updateColorDisplay() {
  currentColorDisplay.textContent = `Current color: ${currentColor}`;
  currentColorDisplay.style.color = currentColor;
}

function renderHand() {
  handDiv.innerHTML = '';
  myHand.forEach(addCard);
}

function addCard(card) {
  const el = document.createElement('div');
  el.className = 'card';

  const img = document.createElement('img');
  img.className = 'card-img';
  img.src = getCardImage(card);
  img.alt = `${card.color} ${card.value}`;
  el.appendChild(img);

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
  el.className = 'card';

  const img = document.createElement('img');
  img.className = 'card-img';
  img.src = getCardImage(card);
  img.alt = `${card.color} ${card.value}`;
  el.appendChild(img);
  discardDiv.appendChild(el);
}
function cardsAreEqual(a, b) {
  return (
    a.color === b.color &&
    a.value === b.value &&
    (a.chosenColor === b.chosenColor || !a.chosenColor || !b.chosenColor)
  );
}

function getCardImage(card) {
  const color = card.color === 'wild' ? 'black' : card.color;
  return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='120'><rect width='80' height='120' fill='${color}' rx='10' ry='10'/><text x='40' y='65' font-family='Arial' font-size='24' fill='white' text-anchor='middle'>${card.value}</text></svg>`;
}

// === Feedback Form ===
document.getElementById('submitFeedback').onclick = () => {
  const name = fbNameInput.value.trim();
  const email = fbEmailInput.value.trim();
  const message = fbMessageInput.value.trim();

  if (!name || !message) {
    feedbackStatus.innerText = 'Please fill in required fields.';
    return;
  }

  fetch('/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, message })
  })
    .then(res => res.json())
    .then(data => {
      feedbackStatus.innerText = '✅ Feedback submitted successfully!';
      fbNameInput.value = '';
      fbEmailInput.value = '';
      fbMessageInput.value = '';
    })
    .catch(err => {
      feedbackStatus.innerText = '❌ Error submitting feedback.';
      console.error('Feedback error:', err);
    });
};
