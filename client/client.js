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
  if (playAIBtn.disabled) return; // prevent multiple AI room joins
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
  playAIBtn.disabled = false; // re-enable AI button after game
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
