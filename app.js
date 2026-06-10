const socket = io();
const grid    = document.getElementById('grid');
const statusEl = document.getElementById('status');
const countEl  = document.getElementById('count');
const streamImg = document.getElementById('stream');

// Reload MJPEG stream on error
streamImg.onerror = () => {
  setTimeout(() => { streamImg.src = '/stream?' + Date.now(); }, 2000);
};

function buildGrid(n) {
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const btn = document.createElement('button');
    btn.className = 'led-btn';
    btn.dataset.i = i;
    btn.setAttribute('aria-label', `LED ${i + 1}`);
    btn.addEventListener('click', () => socket.emit('toggle', i));
    grid.appendChild(btn);
  }
}

function applyState(state) {
  [...grid.children].forEach((btn, i) => {
    btn.classList.toggle('on', !!state[i]);
  });
}

socket.on('connect', () => {
  statusEl.textContent = '接続済み';
  statusEl.className = 'status on';
});

socket.on('disconnect', () => {
  statusEl.textContent = '切断 — 再接続中...';
  statusEl.className = 'status off';
});

socket.on('config', ({ numLeds }) => buildGrid(numLeds));
socket.on('state',  (state)     => applyState(state));
socket.on('viewers', (n)        => { countEl.textContent = n; });
