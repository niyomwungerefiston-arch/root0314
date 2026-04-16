/**
 * Buchat — Calls (Sprint 2)
 *
 * Appels audio/vidéo 1-à-1 + appels de groupe en mesh (≤4 pairs).
 * Signaling WebRTC via Socket.IO.
 *
 * Passage au multi-device : les événements utilisent `users.emitToUser`
 * qui diffuse à TOUS les sockets d'un utilisateur donné.
 *
 * Mesh : pour un appel de groupe à N participants, chaque pair établit
 * N-1 connexions peer-to-peer. Au-delà de 4, il faut un SFU (mediasoup
 * prévu pour plus tard). Protection BUCHAT_MAX_MESH_SIZE.
 */

const { v4: uuidv4 } = require('uuid');
const groups = require('./groups');

const TURN_SERVER = process.env.TURN_SERVER || 'turn:localhost:3478';
const TURN_USERNAME = process.env.TURN_USERNAME || 'buchat';
const TURN_PASSWORD = process.env.TURN_PASSWORD || 'buchat-turn-secret';
const MAX_MESH_SIZE = parseInt(process.env.BUCHAT_MAX_MESH_SIZE || '4', 10);

// callId → { id, kind:'direct'|'group', from, to?, groupId?, participants:Set, callType, startedAt }
const activeCalls = new Map();

function getIceServers() {
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: TURN_SERVER,
      username: TURN_USERNAME,
      credential: TURN_PASSWORD,
    },
  ];
}

function setupCalls(io, users, opts = {}) {
  const push = opts.push || null;

  io.on('connection', (socket) => {
    const user = socket.user;
    if (!user) return;

    // ============================================
    //  DIRECT CALL (1-to-1)
    // ============================================

    socket.on('call_initiate', (data) => {
      const { to, callType = 'audio' } = data;
      const callId = uuidv4();

      const call = {
        id: callId,
        kind: 'direct',
        from: user.id,
        fromName: user.displayName,
        to,
        callType,
        participants: new Set([user.id, to]),
        startedAt: Date.now(),
      };

      const delivered = users.emitToUser(to, 'call_incoming', {
        callId,
        from: user.id,
        fromName: user.displayName,
        callType,
        iceServers: getIceServers(),
      });

      if (!delivered) {
        if (push && push.isEnabled()) {
          push.sendToUser(to, push.buildCallNotification({
            fromName: user.displayName,
            chatId: user.id,
            isVideo: callType === 'video',
          })).catch(() => {});
        }
        socket.emit('call_error', {
          callId,
          message: 'Utilisateur hors ligne — notification envoyée',
        });
        return;
      }

      activeCalls.set(callId, call);
      socket.emit('call_ringing', {
        callId,
        to,
        iceServers: getIceServers(),
      });
    });

    socket.on('call_accept', (data) => {
      const { callId } = data;
      const call = activeCalls.get(callId);
      if (!call) return;
      users.emitToUser(call.from, 'call_accepted', { callId, by: user.id });
    });

    socket.on('call_reject', (data) => {
      const { callId } = data;
      const call = activeCalls.get(callId);
      if (!call) return;
      activeCalls.delete(callId);
      users.emitToUser(call.from, 'call_rejected', { callId, by: user.id });
    });

    socket.on('call_end', (data) => {
      const { callId } = data;
      const call = activeCalls.get(callId);
      if (!call) return;
      activeCalls.delete(callId);
      for (const pid of call.participants) {
        if (pid !== user.id) {
          users.emitToUser(pid, 'call_ended', { callId, by: user.id });
        }
      }
    });

    // ============================================
    //  WEBRTC SIGNALING (tagged by target user id)
    //  Fonctionne aussi bien pour direct que group mesh
    // ============================================

    socket.on('ice_candidate', (data) => {
      const { callId, candidate, targetUserId } = data;
      const call = activeCalls.get(callId);
      if (!call || !call.participants.has(user.id)) return;
      const target = targetUserId ||
        (call.kind === 'direct' ? (call.from === user.id ? call.to : call.from) : null);
      if (!target) return;
      users.emitToUser(target, 'ice_candidate', {
        callId, candidate, fromUserId: user.id,
      });
    });

    socket.on('sdp_offer', (data) => {
      const { callId, sdp, targetUserId } = data;
      const call = activeCalls.get(callId);
      if (!call || !call.participants.has(user.id)) return;
      const target = targetUserId ||
        (call.kind === 'direct' ? (call.from === user.id ? call.to : call.from) : null);
      if (!target) return;
      users.emitToUser(target, 'sdp_offer', {
        callId, sdp, fromUserId: user.id,
      });
    });

    socket.on('sdp_answer', (data) => {
      const { callId, sdp, targetUserId } = data;
      const call = activeCalls.get(callId);
      if (!call || !call.participants.has(user.id)) return;
      const target = targetUserId ||
        (call.kind === 'direct' ? (call.from === user.id ? call.to : call.from) : null);
      if (!target) return;
      users.emitToUser(target, 'sdp_answer', {
        callId, sdp, fromUserId: user.id,
      });
    });

    socket.on('call_toggle_video', (data) => {
      const { callId, videoEnabled } = data;
      const call = activeCalls.get(callId);
      if (!call) return;
      for (const pid of call.participants) {
        if (pid !== user.id) {
          users.emitToUser(pid, 'call_video_toggled', {
            callId, videoEnabled, userId: user.id,
          });
        }
      }
    });

    // ============================================
    //  GROUP CALL (mesh ≤ MAX_MESH_SIZE)
    // ============================================

    socket.on('group_call_initiate', async (data, ack) => {
      try {
        const { groupId, callType = 'audio' } = data;
        if (!(await groups.isMember(groupId, user.id))) {
          throw new Error('Non membre du groupe');
        }
        const memberIds = await groups.getMembers(groupId);
        if (memberIds.length > MAX_MESH_SIZE) {
          throw new Error(`Appel de groupe limité à ${MAX_MESH_SIZE} participants en mesh`);
        }

        const callId = uuidv4();
        const call = {
          id: callId,
          kind: 'group',
          from: user.id,
          fromName: user.displayName,
          groupId,
          callType,
          participants: new Set([user.id]),
          invited: new Set(memberIds),
          startedAt: Date.now(),
        };
        activeCalls.set(callId, call);

        // Ring tous les membres sauf l'initiateur
        for (const memberId of memberIds) {
          if (memberId === user.id) continue;
          const delivered = users.emitToUser(memberId, 'group_call_incoming', {
            callId, groupId, from: user.id, fromName: user.displayName,
            callType, iceServers: getIceServers(),
          });
          if (!delivered && push && push.isEnabled()) {
            push.sendToUser(memberId, push.buildCallNotification({
              fromName: `${user.displayName} (groupe)`,
              chatId: groupId,
              isVideo: callType === 'video',
            })).catch(() => {});
          }
        }

        socket.emit('group_call_started', {
          callId, groupId, iceServers: getIceServers(),
          participants: [user.id],
        });
        if (typeof ack === 'function') ack({ ok: true, callId });
      } catch (err) {
        if (typeof ack === 'function') ack({ error: err.message });
      }
    });

    socket.on('group_call_join', (data) => {
      const { callId } = data;
      const call = activeCalls.get(callId);
      if (!call || call.kind !== 'group') return;
      if (!call.invited.has(user.id)) return;

      call.participants.add(user.id);

      // Informer l'arrivant de la liste des pairs existants pour qu'il
      // initie les offres SDP.
      const peers = [...call.participants].filter((p) => p !== user.id);
      users.emitToUser(user.id, 'group_call_peers', {
        callId, peers, iceServers: getIceServers(),
      });

      // Informer les autres participants qu'un pair arrive.
      for (const pid of call.participants) {
        if (pid !== user.id) {
          users.emitToUser(pid, 'group_call_peer_joined', {
            callId, userId: user.id, displayName: user.displayName,
          });
        }
      }
    });

    socket.on('group_call_leave', (data) => {
      const { callId } = data;
      const call = activeCalls.get(callId);
      if (!call || call.kind !== 'group') return;
      if (!call.participants.has(user.id)) return;

      call.participants.delete(user.id);

      for (const pid of call.participants) {
        users.emitToUser(pid, 'group_call_peer_left', {
          callId, userId: user.id,
        });
      }

      // Si plus personne, fin de l'appel
      if (call.participants.size <= 1) {
        for (const pid of call.participants) {
          users.emitToUser(pid, 'call_ended', { callId, reason: 'empty' });
        }
        activeCalls.delete(callId);
      }
    });

    // ============================================
    //  DISCONNECT CLEANUP
    // ============================================

    socket.on('disconnect', () => {
      // Quitter seulement si c'était le DERNIER socket de l'user
      if (users.hasConnection(user.id)) return;

      for (const [callId, call] of activeCalls) {
        if (!call.participants.has(user.id)) continue;
        call.participants.delete(user.id);

        for (const pid of call.participants) {
          users.emitToUser(pid, call.kind === 'group'
            ? 'group_call_peer_left'
            : 'call_ended', {
            callId, userId: user.id, reason: 'disconnect',
          });
        }

        if (call.kind === 'direct' || call.participants.size <= 1) {
          activeCalls.delete(callId);
        }
      }
    });
  });
}

module.exports = { setupCalls };
