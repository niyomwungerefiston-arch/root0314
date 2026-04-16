const { v4: uuidv4 } = require('uuid');
const redis = require('./redis');

// In-memory room/group storage
const rooms = new Map();

function messagePreview(type, content) {
  if (type === 'text') return String(content || '').slice(0, 80);
  if (type === 'audio' || type === 'voice') return '🎤 Message vocal';
  if (type === 'image') return '📷 Photo';
  if (type === 'video') return '🎬 Vidéo';
  if (type === 'file') return '📎 Fichier';
  return 'Nouveau message';
}

function setupChat(io, connectedUsers, opts = {}) {
  const push = opts.push || null;

  io.on('connection', (socket) => {
    const user = socket.user;
    if (!user) return;

    // --- Direct Messages ---

    socket.on('direct_message', async (data) => {
      const { to, content, type = 'text' } = data;

      const message = {
        id: uuidv4(),
        from: user.id,
        fromName: user.displayName,
        to,
        content,
        type, // 'text', 'audio', 'image', 'video', 'file'
        timestamp: Date.now(),
      };

      const recipientSocket = connectedUsers.get(to);
      if (recipientSocket) {
        // User is online — relay directly (no storage)
        recipientSocket.emit('new_message', message);
        socket.emit('message_delivered', { messageId: message.id, to });
      } else {
        // User is offline — queue in Redis (TTL 1h) + envoyer push
        await redis.queueMessage(to, message);
        socket.emit('message_queued', { messageId: message.id, to });

        if (push && push.isEnabled()) {
          push.sendToUser(to, push.buildMessageNotification({
            fromName: user.displayName,
            preview: messagePreview(type, content),
            chatId: user.id,
          })).catch(() => {});
        }
      }
    });

    // --- Typing indicators ---

    socket.on('typing_start', (data) => {
      const { to } = data;
      const recipientSocket = connectedUsers.get(to);
      if (recipientSocket) {
        recipientSocket.emit('user_typing', {
          userId: user.id,
          displayName: user.displayName,
        });
      }
    });

    socket.on('typing_stop', (data) => {
      const { to } = data;
      const recipientSocket = connectedUsers.get(to);
      if (recipientSocket) {
        recipientSocket.emit('user_stopped_typing', { userId: user.id });
      }
    });

    // --- Group Chat ---

    socket.on('create_group', (data) => {
      const { name, members } = data;
      const groupId = uuidv4();

      const group = {
        id: groupId,
        name,
        creator: user.id,
        members: [user.id, ...members],
        createdAt: Date.now(),
      };

      rooms.set(groupId, group);
      socket.join(groupId);

      // Add all online members to the room
      group.members.forEach((memberId) => {
        const memberSocket = connectedUsers.get(memberId);
        if (memberSocket) {
          memberSocket.join(groupId);
          memberSocket.emit('group_created', group);
        }
      });

      socket.emit('group_created', group);
    });

    socket.on('group_message', async (data) => {
      const { groupId, content, type = 'text' } = data;
      const group = rooms.get(groupId);
      if (!group || !group.members.includes(user.id)) return;

      const message = {
        id: uuidv4(),
        from: user.id,
        fromName: user.displayName,
        groupId,
        content,
        type,
        timestamp: Date.now(),
      };

      // Relay to all online members
      group.members.forEach(async (memberId) => {
        if (memberId === user.id) return;
        const memberSocket = connectedUsers.get(memberId);
        if (memberSocket) {
          memberSocket.emit('new_group_message', message);
        } else {
          await redis.queueMessage(memberId, { ...message, isGroup: true });
          if (push && push.isEnabled()) {
            push.sendToUser(memberId, push.buildMessageNotification({
              fromName: `${user.displayName} (${group.name})`,
              preview: messagePreview(type, content),
              chatId: groupId,
            })).catch(() => {});
          }
        }
      });
    });

    socket.on('join_group', (data) => {
      const { groupId } = data;
      const group = rooms.get(groupId);
      if (!group) return;

      if (!group.members.includes(user.id)) {
        group.members.push(user.id);
      }
      socket.join(groupId);
      socket.emit('group_joined', group);
    });

    socket.on('get_groups', () => {
      const userGroups = [];
      rooms.forEach((group) => {
        if (group.members.includes(user.id)) {
          userGroups.push(group);
        }
      });
      socket.emit('groups_list', userGroups);
    });
  });
}

module.exports = { setupChat };
