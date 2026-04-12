const { v4: uuidv4 } = require('uuid');

const TURN_SERVER = process.env.TURN_SERVER || 'turn:localhost:3478';
const TURN_USERNAME = process.env.TURN_USERNAME || 'buchat';
const TURN_PASSWORD = process.env.TURN_PASSWORD || 'buchat-turn-secret';

// Active calls tracking
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

function setupCalls(io, connectedUsers) {
  io.on('connection', (socket) => {
    const user = socket.user;
    if (!user) return;

    // --- Initiate a call ---
    socket.on('call_initiate', (data) => {
      const { to, callType = 'audio' } = data; // callType: 'audio' or 'video'
      const callId = uuidv4();

      const recipientSocket = connectedUsers.get(to);
      if (!recipientSocket) {
        socket.emit('call_error', { message: 'Utilisateur hors ligne' });
        return;
      }

      const call = {
        id: callId,
        from: user.id,
        fromName: user.displayName,
        to,
        callType,
        status: 'ringing',
        startedAt: Date.now(),
      };

      activeCalls.set(callId, call);

      // Send ring to recipient
      recipientSocket.emit('call_incoming', {
        callId,
        from: user.id,
        fromName: user.displayName,
        callType,
        iceServers: getIceServers(),
      });

      // Confirm to caller
      socket.emit('call_ringing', {
        callId,
        to,
        iceServers: getIceServers(),
      });
    });

    // --- Accept call ---
    socket.on('call_accept', (data) => {
      const { callId } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      call.status = 'active';
      const callerSocket = connectedUsers.get(call.from);
      if (callerSocket) {
        callerSocket.emit('call_accepted', { callId });
      }
    });

    // --- Reject call ---
    socket.on('call_reject', (data) => {
      const { callId } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      call.status = 'rejected';
      activeCalls.delete(callId);

      const callerSocket = connectedUsers.get(call.from);
      if (callerSocket) {
        callerSocket.emit('call_rejected', { callId });
      }
    });

    // --- End call ---
    socket.on('call_end', (data) => {
      const { callId } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      activeCalls.delete(callId);

      const otherUserId = call.from === user.id ? call.to : call.from;
      const otherSocket = connectedUsers.get(otherUserId);
      if (otherSocket) {
        otherSocket.emit('call_ended', { callId });
      }
    });

    // --- WebRTC Signaling ---

    // Forward ICE candidates
    socket.on('ice_candidate', (data) => {
      const { callId, candidate } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      const otherUserId = call.from === user.id ? call.to : call.from;
      const otherSocket = connectedUsers.get(otherUserId);
      if (otherSocket) {
        otherSocket.emit('ice_candidate', { callId, candidate });
      }
    });

    // Forward SDP offer
    socket.on('sdp_offer', (data) => {
      const { callId, sdp } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      const otherUserId = call.from === user.id ? call.to : call.from;
      const otherSocket = connectedUsers.get(otherUserId);
      if (otherSocket) {
        otherSocket.emit('sdp_offer', { callId, sdp });
      }
    });

    // Forward SDP answer
    socket.on('sdp_answer', (data) => {
      const { callId, sdp } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      const otherUserId = call.from === user.id ? call.to : call.from;
      const otherSocket = connectedUsers.get(otherUserId);
      if (otherSocket) {
        otherSocket.emit('sdp_answer', { callId, sdp });
      }
    });

    // --- Toggle video during call ---
    socket.on('call_toggle_video', (data) => {
      const { callId, videoEnabled } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      const otherUserId = call.from === user.id ? call.to : call.from;
      const otherSocket = connectedUsers.get(otherUserId);
      if (otherSocket) {
        otherSocket.emit('call_video_toggled', { callId, videoEnabled, userId: user.id });
      }
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      activeCalls.forEach((call, callId) => {
        if (call.from === user.id || call.to === user.id) {
          const otherUserId = call.from === user.id ? call.to : call.from;
          const otherSocket = connectedUsers.get(otherUserId);
          if (otherSocket) {
            otherSocket.emit('call_ended', { callId, reason: 'disconnect' });
          }
          activeCalls.delete(callId);
        }
      });
    });
  });
}

module.exports = { setupCalls };
