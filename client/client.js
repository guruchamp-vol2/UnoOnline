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
const aiHandCountDiv = document.getElementById('aiHandCount');

let currentRoom = '';
let myTurn = false;
let myHand = [];
let currentColor = null;
let canDraw = true;

joinBtn.onclick = () => {
  currentRoom = roomInput.value;
  socket.emit('joinGame', { roomId: currentRoom, name: nameInput.value });
};

playAIBtn.onclick = () => {
  currentRoom = 'AI-' + Date.now();
  socket.emit('joinGame', { roomId: currentRoom, name: nameInput.value, vsAI: true });
};

drawBtn.onclick = () => {
  if (!myTurn || !canDraw) return;
  socket.emit('drawCard', currentRoom);
  canDraw = false;
};

playAgainBtn.onclick = () => {
  socket.emit('restartGame', currentRoom);
  playAgainBtn.classList.add('hidden');
  aiHandCountDiv.textContent = '';
  currentColor = null;
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
  // DO NOT SET canDraw here anymore — nextTurn controls it!
});

socket.on('cardPlayed', ({ card, nextPlayer, discardTop, playerId }) => {
  updateDiscard(discardTop);

  if (discardTop.color === 'wild' && discardTop.chosenColor) {
    currentColor = discardTop.chosenColor;
  } else {
    currentColor = discardTop.color;
  }

  if (playerId === socket.id) {
    const index = myHand.findIndex(c => cardsAreEqual(c, card));
    if (index !== -1) myHand.splice(index, 1);
    renderHand();
  }

  myTurn = socket.id === nextPlayer;
  canDraw = true;
  statusDiv.textContent = myTurn
    ? `Your turn! (Current color: ${currentColor})`
    : `Waiting... (Current color: ${currentColor})`;
  drawBtn.disabled = !myTurn || !canDraw;
});

socket.on('nextTurn', next => {
  myTurn = socket.id === next;
  canDraw = true;
  statusDiv.textContent = myTurn
    ? `Your turn! (Current color: ${currentColor})`
    : `Waiting... (Current color: ${currentColor})`;
  drawBtn.disabled = !myTurn || !canDraw;
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
  statusDiv.textContent = `AI chose ${color} color!`;
});

function renderHand() {
  handDiv.innerHTML = '';
  myHand.forEach(addCard);
}

function addCard(card) {
  const el = document.createElement('div');
  el.className = 'card';

  let img = document.createElement('img');
  img.className = 'card-img';
  img.style.width = '80px';
  img.style.height = '120px';

  img.src = `cards/${getImageName(card)}.png`;
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
    canDraw = false;
  };

  handDiv.appendChild(el);
}

function updateDiscard(card) {
  discardDiv.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'card';

  let img = document.createElement('img');
  img.className = 'card-img';
  img.style.width = '80px';
  img.style.height = '120px';

  img.src = `cards/${getImageName(card)}.png`;
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

function getImageName(card) {
  const colorMap = {
    blue: 'Blue',
    green: 'Green',
    red: 'Red',
    yellow: 'Yellow'
  };

  if (card.color === 'wild') {
    return card.value === '+4'
      ? 'Wild_Card_Draw_4'
      : 'Wild_Card_Change_Colour';
  } else {
    let valueName = card.value;
    if (valueName === 'skip') valueName = 'Skip';
    if (valueName === 'reverse') valueName = 'Reverse';
    if (valueName === '+2') valueName = 'Draw_2';

    return `${colorMap[card.color]}_${valueName}`;
  }
}

// === Feedback submit ===
document.getElementById('submitFeedback').onclick = () => {
  const name = document.getElementById('fbName').value.trim();
  const email = document.getElementById('fbEmail').value.trim();
  const message = document.getElementById('fbMessage').value.trim();

  if (!name || !message) {
    document.getElementById('feedbackStatus').innerText = 'Please fill in required fields.';
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
    document.getElementById('feedbackStatus').innerText = 'Feedback submitted! Thank you.';
    document.getElementById('fbName').value = '';
    document.getElementById('fbEmail').value = '';
    document.getElementById('fbMessage').value = '';
  })
  .catch(err => {
    document.getElementById('feedbackStatus').innerText = 'Error submitting feedback.';
  });
};
