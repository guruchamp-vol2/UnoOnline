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
  currentColor = color || discardTop.color;
});

socket.on('hand', cards => {
  myHand = cards;
  renderHand();
});

socket.on('cardDrawn', cards => {
  myHand = myHand.concat(cards);
  renderHand();
  canDraw = false;
});

socket.on('cardPlayed', ({ card, nextPlayer, discardTop, playerId }) => {
  updateDiscard(discardTop);
  currentColor = discardTop.color;

  if (playerId === socket.id) {
    const index = myHand.findIndex(c => c.color === card.color && c.value === card.value);
    if (index !== -1) myHand.splice(index, 1);
    renderHand();
  }

  myTurn = socket.id === nextPlayer;
  canDraw = true;

  statusDiv.textContent = myTurn ? `Your turn! (Current color: ${currentColor})` : `Waiting... (Current color: ${currentColor})`;
  drawBtn.disabled = !myTurn || !canDraw;
});

socket.on('nextTurn', next => {
  myTurn = socket.id === next;
  canDraw = true;

  statusDiv.textContent = myTurn ? `Your turn! (Current color: ${currentColor})` : `Waiting... (Current color: ${currentColor})`;
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

  let imageName = getImageName(card);

  img.src = `cards/${imageName}.png`;

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

  let imageName = getImageName(card);

  img.src = `cards/${imageName}.png`;

  el.appendChild(img);
  discardDiv.appendChild(el);
}

function getImageName(card) {
  if (card.color === 'wild') {
    if (card.value === 'wild') {
      return 'Wild_Card_Change_Colour';
    } else if (card.value === '+4') {
      return 'Wild_Card_Draw_4';
    }
  } else {
    let valueName = card.value;

    // Map special names to match your image pack
    if (valueName === 'skip') valueName = 'Skip';
    if (valueName === 'reverse') valueName = 'Reverse';
    if (valueName === '+2') valueName = 'Draw_Two';

    return `${card.color}_${valueName}`;
  }
}
