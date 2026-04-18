// Buchat PWA — Features (profil, invites, groups, calls, push, chat menu)
'use strict';

// ========== CALLS ==========
function handleIncomingCall(data) {
  S.incomingCall = data;
  $('incomingName').textContent = data.fromName;
  $('incomingAvatar').textContent = initial(data.fromName);
  $('incomingType').textContent = data.callType === 'video' ? '📹 Vidéo' : '📞 Audio';
  S.iceServers = data.iceServers;
  $('incomingCall').classList.remove('hidden');
}

$('btnAcceptCall')?.addEventListener('click', async () => {
  $('incomingCall').classList.add('hidden');
  if (!S.incomingCall) return;
  const d = S.incomingCall;
  S.callId = d.callId;
  $('callContactName').textContent = d.fromName;
  $('callAvatar').textContent = initial(d.fromName);
  $('callStatus').textContent = 'Connexion...';
  $('callTimer').textContent = '00:00';
  show('callScreen');

  await setupPeerConnection(false);
  S.socket.emit('call_accept', { callId: d.callId });
});

$('btnRejectCall')?.addEventListener('click', () => {
  $('incomingCall').classList.add('hidden');
  if (S.incomingCall) S.socket.emit('call_reject', { callId: S.incomingCall.callId });
  S.incomingCall = null;
});

$('btnAudioCall')?.addEventListener('click', () => startCall('audio'));
$('btnVideoCall')?.addEventListener('click', () => startCall('video'));

async function startCall(type) {
  if (!S.chat) return;
  $('callContactName').textContent = S.chat.displayName;
  $('callAvatar').textContent = initial(S.chat.displayName);
  $('callStatus').textContent = 'Sonnerie...';
  $('callTimer').textContent = '00:00';
  show('callScreen');
  await setupPeerConnection(true);
  S.socket.emit('call_initiate', { to: S.chat.id, callType: type });
}

async function setupPeerConnection(isInitiator) {
  const cfg = { iceServers: S.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }] };
  S.pc = new RTCPeerConnection(cfg);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    S.localStream = stream;
    stream.getTracks().forEach(t => S.pc.addTrack(t, stream));
  } catch(e) { toast('Micro non disponible'); }

  S.pc.onicecandidate = e => {
    if (e.candidate) S.socket.emit('ice_candidate', { callId: S.callId, candidate: e.candidate });
  };

  S.pc.ontrack = e => {
    const audio = new Audio();
    audio.srcObject = e.streams[0];
    audio.play().catch(() => {});
    S.remoteAudio = audio;
  };

  if (isInitiator) {
    S.pc.onnegotiationneeded = async () => {
      const offer = await S.pc.createOffer();
      await S.pc.setLocalDescription(offer);
      S.socket.emit('sdp_offer', { callId: S.callId, sdp: offer });
    };
  }
}

let callTimerInterval, callSecs = 0;
function startCallTimer() {
  callSecs = 0;
  clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    callSecs++;
    const m = Math.floor(callSecs / 60).toString().padStart(2, '0');
    const s = (callSecs % 60).toString().padStart(2, '0');
    $('callTimer').textContent = m + ':' + s;
  }, 1000);
}

function endCallCleanup() {
  clearInterval(callTimerInterval);
  if (S.pc) { S.pc.close(); S.pc = null; }
  if (S.localStream) { S.localStream.getTracks().forEach(t => t.stop()); S.localStream = null; }
  if (S.remoteAudio) { S.remoteAudio.pause(); S.remoteAudio = null; }
  S.callId = null;
}

$('btnHangup')?.addEventListener('click', () => {
  if (S.callId) S.socket.emit('call_end', { callId: S.callId });
  endCallCleanup();
  show(S.chat ? 'chatScreen' : 'chatListScreen');
});

$('btnMute')?.addEventListener('click', () => {
  if (!S.localStream) return;
  const t = S.localStream.getAudioTracks()[0];
  if (t) { t.enabled = !t.enabled; $('btnMute').textContent = t.enabled ? '🎙️' : '🔇'; }
});

// ========== PROFILE ==========
$('btnProfile')?.addEventListener('click', async () => {
  show('profileScreen');
  try {
    const me = await api('/api/me');
    S.user = me;
    $('profileName').value = me.displayName || '';
    $('profileAbout').value = me.about || '';
    $('profilePhone').value = me.phone || '';
    $('profileAvatar').innerHTML = me.avatarUrl ? `<img src="${me.avatarUrl}">` : `<span>${initial(me.displayName)}</span>`;
  } catch(e) { toast(e.message); }
});

$('saveProfileBtn')?.addEventListener('click', async () => {
  try {
    const res = await api('/api/me', {
      method: 'PATCH',
      body: { displayName: $('profileName').value, about: $('profileAbout').value }
    });
    S.user = res;
    toast('Profil mis à jour');
  } catch(e) { toast(e.message); }
});

$('changeAvatarBtn')?.addEventListener('click', () => $('avatarInput').click());
$('avatarInput')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await api('/api/media/avatar', { method: 'POST', body: fd });
    S.user.avatarUrl = res.avatarUrl;
    $('profileAvatar').innerHTML = `<img src="${res.avatarUrl}">`;
    toast('Avatar mis à jour');
  } catch(e) { toast(e.message); }
});

$('btnLogout')?.addEventListener('click', () => {
  if (S.socket) S.socket.disconnect();
  localStorage.removeItem('buchat_token');
  S.token = null; S.user = null; S.contacts = [];
  show('loginScreen');
});

// ========== BLOCKED ==========
$('btnOpenBlocked')?.addEventListener('click', async () => {
  show('blockedScreen');
  try {
    const list = await api('/api/chats/blocked');
    $('blockedList').innerHTML = list.length ? list.map(b =>
      `<div class="invite-item">
        <div><div class="invite-code">${esc(b.displayName)}</div><div class="invite-meta">${b.phone}</div></div>
        <button class="mini-btn" onclick="doUnblock('${b.userId}')">Débloquer</button>
      </div>`
    ).join('') : '<p class="hint">Aucun utilisateur bloqué</p>';
  } catch(e) { toast(e.message); }
});

window.doUnblock = async (uid) => {
  await api(`/api/chats/unblock/${uid}`, { method: 'POST' });
  toast('Débloqué');
  $('btnOpenBlocked').click();
};

// ========== INVITATIONS ==========
$('btnInvites')?.addEventListener('click', async () => {
  show('invitesScreen');
  await loadInvites();
});

async function loadInvites() {
  try {
    const list = await api('/api/invites');
    $('invitesList').innerHTML = list.length ? list.map(inv =>
      `<div class="invite-item">
        <div>
          <div class="invite-code">${inv.code}</div>
          <div class="invite-meta">${inv.uses}/${inv.maxUses} utilisé(s) — expire ${inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : 'jamais'}</div>
        </div>
        <div class="invite-actions">
          <button class="mini-btn" onclick="shareInvite('${inv.code}','${inv.shareUrl || ''}')">Partager</button>
          <button class="mini-btn danger" onclick="revokeInvite('${inv.code}')">×</button>
        </div>
      </div>`
    ).join('') : '<p class="hint">Aucune invitation. Créez-en une!</p>';
  } catch(e) { toast(e.message); }
}

$('createInviteBtn')?.addEventListener('click', async () => {
  try {
    await api('/api/invites', { method: 'POST', body: { maxUses: 5, expiryDays: 7 } });
    toast('Code créé');
    await loadInvites();
  } catch(e) { toast(e.message); }
});

window.shareInvite = async (code, url) => {
  const text = `Rejoins-moi sur Buchat! Code: ${code}${url ? '\n' + url : ''}`;
  if (navigator.share) { try { await navigator.share({ text }); } catch(e) {} }
  else { navigator.clipboard?.writeText(text); toast('Code copié'); }
};

window.revokeInvite = async (code) => {
  await api(`/api/invites/${code}`, { method: 'DELETE' });
  toast('Invitation révoquée');
  await loadInvites();
};

// ========== NEW GROUP ==========
$('btnNewGroup')?.addEventListener('click', async () => {
  show('newGroupScreen');
  $('newGroupName').value = '';
  const list = $('newGroupMembers');
  list.innerHTML = S.contacts.map(c =>
    `<label class="member-item" data-uid="${c.id}">
      <input type="checkbox" value="${c.id}"> ${esc(c.displayName || c.phone)}
    </label>`
  ).join('');
});

$('createGroupBtn')?.addEventListener('click', async () => {
  const name = $('newGroupName').value.trim();
  if (!name) return toast('Nom requis');
  const members = [...document.querySelectorAll('#newGroupMembers input:checked')].map(i => i.value);
  if (!members.length) return toast('Sélectionnez au moins 1 membre');
  try {
    await api('/api/groups', { method: 'POST', body: { name, members } });
    toast('Groupe créé');
    show('chatListScreen');
  } catch(e) { toast(e.message); }
});

// ========== CHAT MENU (pin/archive/mute/block) ==========
$('btnChatMenu')?.addEventListener('click', () => {
  if (!S.chat) return;
  const s = S.settings[S.chat.id] || {};
  $('pinLabel').textContent = s.pinnedAt ? 'Désépingler' : 'Épingler';
  $('archiveLabel').textContent = s.archivedAt ? 'Désarchiver' : 'Archiver';
  $('chatMenu').classList.remove('hidden');
});

document.querySelectorAll('#chatMenu .sheet-item').forEach(b => {
  b.addEventListener('click', async () => {
    $('chatMenu').classList.add('hidden');
    if (!S.chat) return;
    const pid = S.chat.id;
    const act = b.dataset.act;
    try {
      if (act === 'pin') {
        const is = S.settings[pid]?.pinnedAt;
        await api(`/api/chats/peer/${pid}/${is ? 'unpin' : 'pin'}`, { method: 'POST' });
        toast(is ? 'Désépinglé' : 'Épinglé');
      }
      if (act === 'archive') {
        const is = S.settings[pid]?.archivedAt;
        await api(`/api/chats/peer/${pid}/${is ? 'unarchive' : 'archive'}`, { method: 'POST' });
        toast(is ? 'Désarchivé' : 'Archivé');
        show('chatListScreen');
      }
      if (act === 'mute') {
        await api(`/api/chats/peer/${pid}/mute`, { method: 'POST', body: { hours: 8 } });
        toast('En sourdine 8h');
      }
      if (act === 'block') {
        await api(`/api/chats/block/${pid}`, { method: 'POST' });
        toast('Utilisateur bloqué');
        show('chatListScreen');
      }
      await loadContacts();
    } catch(e) { toast(e.message); }
  });
});

// ========== PUSH NOTIFICATIONS ==========
async function maybeShowPushPrompt() {
  if (!('PushManager' in window) || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub && !localStorage.getItem('buchat_push_dismissed')) {
    $('pushPrompt')?.classList.remove('hidden');
  }
}

$('enablePushBtn')?.addEventListener('click', async () => {
  $('pushPrompt').classList.add('hidden');
  try {
    const cfg = await api('/api/config');
    if (!cfg.vapidPublicKey) { toast('Push non configuré sur le serveur'); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userApplicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey),
      applicationServerURL: undefined,
    });
    await api('/api/push/subscribe', {
      method: 'POST',
      body: { subscription: sub.toJSON(), platform: 'web' }
    });
    toast('Notifications activées');
  } catch(e) { toast('Erreur push: ' + e.message); }
});

$('dismissPushBtn')?.addEventListener('click', () => {
  $('pushPrompt').classList.add('hidden');
  localStorage.setItem('buchat_push_dismissed', '1');
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => {
    if (e.target === o) o.classList.add('hidden');
  });
});
