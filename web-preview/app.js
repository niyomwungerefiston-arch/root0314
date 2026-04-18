// Buchat PWA — Core (auth, navigation, socket, chat)
'use strict';

const API = window.location.origin;
const S = {}; // state

// ========== HELPERS ==========
function $(id) { return document.getElementById(id); }
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  S.screen = id;
}
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), ms || 3000);
}
async function api(path, opts) {
  const o = { headers: {}, ...opts };
  if (S.token) o.headers['Authorization'] = 'Bearer ' + S.token;
  if (o.body && !(o.body instanceof FormData)) {
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(API + path, o);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Erreur serveur');
  return d;
}
function fmtTime(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}
function initial(name) { return (name || '?').charAt(0).toUpperCase(); }
function avatarHTML(user, cls) {
  cls = cls || '';
  if (user && user.avatarUrl) return `<div class="avatar ${cls}"><img src="${user.avatarUrl}"></div>`;
  return `<div class="avatar ${cls}"><span>${initial(user?.displayName || user?.fromName)}</span></div>`;
}

// ========== AUTH ==========
let isRegister = false;

function initAuth() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      isRegister = t.dataset.tab === 'register';
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      $('nameField').classList.toggle('hidden', !isRegister);
      $('inviteField').classList.toggle('hidden', !isRegister);
      $('authBtn').textContent = isRegister ? 'CRÉER MON COMPTE' : 'SE CONNECTER';
    });
  });
  $('authBtn').addEventListener('click', doAuth);
  $('passInput').addEventListener('keypress', e => { if (e.key === 'Enter') doAuth(); });

  const saved = localStorage.getItem('buchat_token');
  if (saved) {
    S.token = saved;
    api('/api/me').then(u => {
      S.user = u;
      afterLogin();
    }).catch(() => { localStorage.removeItem('buchat_token'); });
  }
}

async function doAuth() {
  const phone = $('phoneInput').value.trim();
  const pass = $('passInput').value;
  const name = $('nameField').value.trim();
  const invite = $('inviteField').value.trim();
  $('authError').classList.add('hidden');
  if (!phone || !pass) return showErr('Numéro et mot de passe requis');
  try {
    $('authBtn').disabled = true;
    const ep = isRegister ? '/api/register' : '/api/login';
    const body = isRegister ? { phone, password: pass, displayName: name || phone, inviteCode: invite || undefined } : { phone, password: pass };
    const res = await api(ep, { method: 'POST', body });
    S.token = res.token;
    S.user = res.user;
    localStorage.setItem('buchat_token', S.token);
    afterLogin();
  } catch (e) { showErr(e.message); }
  finally { $('authBtn').disabled = false; }
}

function showErr(msg) { $('authError').textContent = msg; $('authError').classList.remove('hidden'); }

function afterLogin() {
  connectSocket();
  loadContacts();
  show('chatListScreen');
  maybeShowPushPrompt();
}

// ========== SOCKET ==========
function connectSocket() {
  if (S.socket) S.socket.disconnect();
  S.socket = io(API, { auth: { token: S.token }, transports: ['websocket', 'polling'] });
  const sk = S.socket;

  sk.on('connect', () => console.log('✓ Socket connecté'));

  sk.on('new_message', msg => {
    if (S.screen === 'chatScreen' && S.chat && (msg.from === S.chat.id || msg.to === S.chat.id)) {
      appendMsg(msg);
      sk.emit('messages_read', { messageIds: [msg.id] });
    } else {
      addUnread(msg.from);
      toast(`${msg.fromName}: ${msgPreview(msg)}`);
    }
  });

  sk.on('offline_messages', msgs => {
    msgs.forEach(m => {
      if (S.screen === 'chatScreen' && S.chat && m.from === S.chat.id) appendMsg(m);
      else addUnread(m.from);
    });
    if (msgs.length) toast(`${msgs.length} messages en attente`);
  });

  sk.on('message_delivered', d => {
    const el = document.querySelector(`[data-mid="${d.messageId}"] .ticks`);
    if (el) el.textContent = '✓';
  });

  sk.on('messages_read_by', d => {
    d.messageIds.forEach(id => {
      const el = document.querySelector(`[data-mid="${id}"] .ticks`);
      if (el) { el.textContent = '✓✓'; el.classList.add('read'); }
    });
  });

  sk.on('user_typing', d => {
    if (S.chat && d.userId === S.chat.id) $('chatContactStatus').textContent = 'écrit...';
  });
  sk.on('user_stopped_typing', d => {
    if (S.chat && d.userId === S.chat.id) $('chatContactStatus').textContent = S.chat.online ? 'En ligne' : 'Hors ligne';
  });

  sk.on('user_online', d => {
    if (S.contacts) { const c = S.contacts.find(x => x.id === d.userId); if (c) c.online = true; }
    if (S.chat && S.chat.id === d.userId) $('chatContactStatus').textContent = 'En ligne';
  });
  sk.on('user_offline', d => {
    if (S.contacts) { const c = S.contacts.find(x => x.id === d.userId); if (c) c.online = false; }
    if (S.chat && S.chat.id === d.userId) $('chatContactStatus').textContent = 'Hors ligne';
  });

  sk.on('message_reaction', d => {
    const el = document.querySelector(`[data-mid="${d.messageId}"]`);
    if (!el) return;
    let row = el.querySelector('.reactions-row');
    if (d.action === 'remove') { if (row) row.remove(); return; }
    if (!row) { row = document.createElement('div'); row.className = 'reactions-row'; el.appendChild(row); }
    row.textContent = d.emoji;
  });

  sk.on('call_incoming', handleIncomingCall);
  sk.on('call_accepted', d => { S.callId = d.callId; $('callStatus').textContent = 'En cours...'; startCallTimer(); });
  sk.on('call_rejected', () => { endCallCleanup(); show('chatScreen'); toast('Appel refusé'); });
  sk.on('call_ended', () => { endCallCleanup(); show(S.chat ? 'chatScreen' : 'chatListScreen'); toast('Appel terminé'); });
  sk.on('call_ringing', d => { S.callId = d.callId; S.iceServers = d.iceServers; });

  sk.on('ice_candidate', async d => {
    if (S.pc && d.candidate) try { await S.pc.addIceCandidate(d.candidate); } catch(e) {}
  });
  sk.on('sdp_offer', async d => {
    if (!S.pc) return;
    await S.pc.setRemoteDescription(d.sdp);
    const answer = await S.pc.createAnswer();
    await S.pc.setLocalDescription(answer);
    sk.emit('sdp_answer', { callId: d.callId, sdp: answer });
  });
  sk.on('sdp_answer', async d => {
    if (S.pc) await S.pc.setRemoteDescription(d.sdp);
  });
}

// ========== CONTACTS / CHAT LIST ==========
S.contacts = [];
S.unread = {};
S.settings = {};

function addUnread(userId) {
  S.unread[userId] = (S.unread[userId] || 0) + 1;
  renderContacts();
}

async function loadContacts() {
  try {
    const [users, settings] = await Promise.all([api('/api/users'), api('/api/chats/settings')]);
    S.contacts = users.filter(u => u.id !== S.user.id);
    S.settings = {};
    settings.forEach(s => { if (s.peerId) S.settings[s.peerId] = s; });
    renderContacts();
  } catch(e) { console.warn('loadContacts:', e); }
}

function renderContacts(filter) {
  const list = $('contactList');
  let items = S.contacts;
  if (filter) items = items.filter(c => (c.displayName || c.phone || '').toLowerCase().includes(filter.toLowerCase()));

  items.sort((a, b) => {
    const pa = S.settings[a.id]?.pinnedAt ? 1 : 0;
    const pb = S.settings[b.id]?.pinnedAt ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (b.lastSeenAt || '') > (a.lastSeenAt || '') ? 1 : -1;
  });

  $('contactCount').textContent = items.length + ' contacts';
  list.innerHTML = items.map(c => {
    const pinned = S.settings[c.id]?.pinnedAt;
    const archived = S.settings[c.id]?.archivedAt;
    if (archived && !filter) return '';
    const un = S.unread[c.id] || 0;
    return `<div class="contact-item ${pinned ? 'pinned' : ''}" onclick="openChat('${c.id}')">
      ${avatarHTML(c)}
      <div class="status-dot ${c.online ? 'online' : 'offline'}"></div>
      <div class="contact-info">
        <div class="contact-name">${esc(c.displayName || c.phone)}</div>
        <div class="contact-preview">${c.online ? 'En ligne' : 'Hors ligne'}</div>
      </div>
      ${un ? `<div class="unread-badge">${un}</div>` : ''}
      ${pinned ? '<span class="pin-icon">📌</span>' : ''}
    </div>`;
  }).join('');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Search
let searchTimer;
$('searchInput')?.addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(async () => {
    if (q.length < 2) { renderContacts(); return; }
    renderContacts(q);
    try {
      const results = await api('/api/messages/search?q=' + encodeURIComponent(q));
      if (results.length) {
        const list = $('contactList');
        list.innerHTML += '<div style="padding:8px 16px;font-weight:bold;color:var(--text-sec)">Messages</div>';
        list.innerHTML += results.slice(0, 10).map(r =>
          `<div class="search-result" onclick="openChat('${r.from === S.user.id ? r.to : r.from}')">
            <div class="search-result-snippet">${r.snippet || esc(r.content || '')}</div>
            <div style="font-size:11px;color:var(--text-sec)">${fmtTime(r.createdAt)}</div>
          </div>`
        ).join('');
      }
    } catch(e) {}
  }, 400);
});

// ========== CHAT ==========
async function openChat(peerId) {
  const peer = S.contacts.find(c => c.id === peerId);
  if (!peer) return;
  S.chat = peer;
  S.replyTo = null;
  $('replyBar').classList.add('hidden');
  delete S.unread[peerId];
  $('chatContactName').textContent = peer.displayName || peer.phone;
  $('chatContactStatus').textContent = peer.online ? 'En ligne' : 'Hors ligne';
  $('chatPeerAvatar').innerHTML = peer.avatarUrl ? `<img src="${peer.avatarUrl}">` : `<span>${initial(peer.displayName)}</span>`;
  $('messagesContainer').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-sec)">Chargement...</div>';
  show('chatScreen');

  try {
    const msgs = await api(`/api/messages/direct/${peerId}?limit=50`);
    $('messagesContainer').innerHTML = '';
    msgs.reverse().forEach(m => appendMsg(m, true));
    scrollBottom();
    S.socket.emit('conversation_read', { peerId });
  } catch(e) { $('messagesContainer').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-sec)">Nouveau chat</div>'; }
}
window.openChat = openChat;

function appendMsg(m, noScroll) {
  const c = $('messagesContainer');
  const isSent = m.from === S.user.id;
  const div = document.createElement('div');
  div.className = `message ${isSent ? 'sent' : 'received'}`;
  div.dataset.mid = m.id;

  let replyHTML = '';
  if (m.replyTo) replyHTML = `<div class="reply-preview">↩</div>`;

  let contentHTML = '';
  if (m.type === 'image') contentHTML = `<img src="${esc(m.content)}" onclick="window.open(this.src)">`;
  else if (m.type === 'voice' || m.type === 'audio') contentHTML = `<div class="voice-msg">🎤 <audio src="${esc(m.content)}" controls preload="none"></audio></div>`;
  else if (m.type === 'video') contentHTML = `<video src="${esc(m.content)}" controls preload="none" style="max-width:100%;border-radius:8px"></video>`;
  else contentHTML = `<div class="text">${esc(m.content || '')}</div>`;

  const ticks = isSent ? `<span class="ticks ${m.receipts?.some(r => r.status === 'read') ? 'read' : ''}">${m.receipts?.length ? (m.receipts.some(r => r.status === 'read') ? '✓✓' : '✓') : ''}</span>` : '';
  const reacHTML = m.reactions?.length ? `<div class="reactions-row">${m.reactions.map(r => r.emoji).join('')}</div>` : '';

  div.innerHTML = `${replyHTML}${contentHTML}<div class="meta">${fmtTime(m.createdAt || Date.now())} ${ticks}</div>${reacHTML}`;

  // Long press for reactions
  let pressTimer;
  div.addEventListener('touchstart', () => { pressTimer = setTimeout(() => openMsgMenu(m), 500); });
  div.addEventListener('touchend', () => clearTimeout(pressTimer));
  div.addEventListener('contextmenu', e => { e.preventDefault(); openMsgMenu(m); });

  c.appendChild(div);
  if (!noScroll) scrollBottom();
}

function scrollBottom() {
  const c = $('messagesContainer');
  setTimeout(() => c.scrollTop = c.scrollHeight, 50);
}

function msgPreview(m) {
  if (m.type === 'text') return (m.content || '').slice(0, 40);
  if (m.type === 'image') return '📷 Photo';
  if (m.type === 'voice') return '🎤 Vocal';
  if (m.type === 'video') return '🎬 Vidéo';
  return 'Message';
}

// Send
function sendMsg() {
  const input = $('msgInput');
  const text = input.value.trim();
  if (!text || !S.chat) return;
  input.value = '';
  S.socket.emit('direct_message', {
    to: S.chat.id,
    content: text,
    type: 'text',
    replyTo: S.replyTo || undefined,
  });
  S.replyTo = null;
  $('replyBar').classList.add('hidden');

  // Typing stop
  S.socket.emit('typing_stop', { to: S.chat.id });
}

// Typing indicator
let typingTimer;
$('msgInput')?.addEventListener('input', () => {
  if (!S.chat) return;
  S.socket.emit('typing_start', { to: S.chat.id });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => S.socket.emit('typing_stop', { to: S.chat.id }), 2000);
});

// Message menu (reactions)
function openMsgMenu(m) {
  S.menuMsg = m;
  $('msgMenu').classList.remove('hidden');
}
document.querySelectorAll('#msgMenu .reac-btn').forEach(b => {
  b.addEventListener('click', () => {
    if (S.menuMsg) S.socket.emit('message_react', { messageId: S.menuMsg.id, emoji: b.dataset.emoji });
    $('msgMenu').classList.add('hidden');
  });
});
document.querySelectorAll('#msgMenu .sheet-item').forEach(b => {
  b.addEventListener('click', () => {
    if (b.dataset.act === 'reply' && S.menuMsg) {
      S.replyTo = S.menuMsg.id;
      $('replyPreview').textContent = msgPreview(S.menuMsg);
      $('replyBar').classList.remove('hidden');
      $('msgInput').focus();
    }
    if (b.dataset.act === 'copy' && S.menuMsg) {
      navigator.clipboard?.writeText(S.menuMsg.content || '');
      toast('Copié');
    }
    $('msgMenu').classList.add('hidden');
  });
});

// ========== MEDIA ==========
$('attachBtn')?.addEventListener('click', () => $('mediaInput').click());
$('mediaInput')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file || !S.chat) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    toast('Envoi...');
    const res = await api('/api/media/upload', { method: 'POST', body: fd });
    const type = file.type.startsWith('video') ? 'video' : 'image';
    S.socket.emit('direct_message', { to: S.chat.id, content: res.url, type });
    toast('Envoyé');
  } catch(e) { toast('Erreur: ' + e.message); }
  e.target.value = '';
});

// Voice recording
let mediaRec, audioChunks = [];
$('micBtn')?.addEventListener('click', async () => {
  if (mediaRec && mediaRec.state === 'recording') {
    mediaRec.stop();
    $('micBtn').classList.remove('recording');
    $('micBtn').textContent = '🎤';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRec = new MediaRecorder(stream);
    audioChunks = [];
    mediaRec.ondataavailable = e => audioChunks.push(e.data);
    mediaRec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const fd = new FormData();
      fd.append('file', blob, 'voice.webm');
      try {
        const res = await api('/api/media/voice', { method: 'POST', body: fd });
        S.socket.emit('direct_message', { to: S.chat.id, content: res.url, type: 'voice' });
      } catch(e) { toast('Erreur vocal: ' + e.message); }
    };
    mediaRec.start();
    $('micBtn').classList.add('recording');
    $('micBtn').textContent = '⏹';
  } catch(e) { toast('Micro non disponible'); }
});

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  $('sendBtn')?.addEventListener('click', sendMsg);
  $('msgInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') sendMsg(); });
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
    show(b.dataset.back);
    if (b.dataset.back === 'chatListScreen') { renderContacts(); S.chat = null; }
  }));

  // PWA install
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' })
      .then(r => console.log('SW actif', r.scope)).catch(() => {});
  }
});
