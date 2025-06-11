const socket = io();
const joinBtn = document.getElementById('join');
const nameInput = document.getElementById('name');
const avatarInput = document.getElementById('avatar');
const roomInput = document.getElementById('room');
const lobby = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const handDiv = document.getElementById('hand');
const discardDiv = document.getElementById('discard');
const statusDiv = document.getElementById('status');
const drawBtn = document.getElementById('draw');
const playersDiv = document.getElementById('players');
const chatInput = document.getElementById('chatInput');
const sendChat = document.getElementById('sendChat');
const messagesDiv = document.getElementById('messages');

let myTurn = false;

joinBtn.onclick = () => {
  socket.emit('joinGame', {
    roomId: roomInput.value,
    name: nameInput.value,
    avatar: avatarInput.value
  });
};

socket.on('lobbyUpdate', players => {
  playersDiv.innerHTML = players
    .map(p => `<img class="avatar" src="${p.avatar}"> ${p.name}`)
    .join('<br>');
});

socket.on('gameStart', ({ discardTop }) => {
  lobby.classList.add('hidden');
  gameDiv.classList.remove('hidden');
  updateDiscard(discardTop);
  statusDiv.textContent = 'Game started!';
});

socket.on('chatMessage', ({ from, msg, timestamp }) => {
  const el = document.createElement('div');
  el.className = 'message';
  el.textContent = `[${new Date(timestamp).toLocaleTimeString()}] ${msg}`;
  messagesDiv.appendChild(el);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

sendChat.onclick = () => {
  socket.emit('chatMessage', {
    roomId: roomInput.value,
    msg: chatInput.value
  });
  chatInput.value = '';
};

socket.on('hand', cards => renderHand(cards));
socket.on('cardDrawn', cards => cards.forEach(c=>addCard(c)));
socket.on('cardPlayed', ({ card, nextPlayer, discardTop }) => {
  updateDiscard(discardTop);
  myTurn = socket.id === nextPlayer;
  statusDiv.textContent = myTurn ? 'Your turn!' : 'Waiting…';
  drawBtn.disabled = !myTurn;
});
socket.on('nextTurn', next => {
  myTurn = socket.id === next;
  statusDiv.textContent = myTurn ? 'Your turn!' : 'Waiting…';
  drawBtn.disabled = !myTurn;
});
socket.on('illegalMove', () => alert('Illegal move!'));
socket.on('mustCallUno', id => {
  if (id !== socket.id) return;
  alert('Call UNO now or draw 2 penalty!');
});
socket.on('gameEnd', winner => {
  alert(winner === socket.id ? 'You win!' : 'You lose…');
});

drawBtn.onclick = () => socket.emit('drawCard', roomInput.value);

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
    el.classList.add('play');
    setTimeout(() => {
      socket.emit('playCard', { roomId: roomInput.value, card });
      el.remove();
    }, 300);
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
