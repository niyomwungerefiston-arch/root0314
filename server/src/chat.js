/**
 * Buchat — Chat Socket.IO handlers (Sprint 2)
 *
 * Fonctionnalités :
 *   • Messages directs + groupes (persistés 30j par défaut)
 *   • Accusés de réception ✓ et lecture ✓✓
 *   • Réactions emoji
 *   • Multi-appareils : émission à TOUS les sockets d'un user
 *   • Indicateurs de frappe
 *   • Groupes PostgreSQL (plus d'in-memory)
 *   • Blocage (un user bloqué ne peut pas envoyer)
 */

const redis = require('./redis');
const messages = require('./messages');
const groups = require('./groups');
const chats = require('./chats');

function setupChat(io, users, opts = {}) {
  const push = opts.push || null;

  io.on('connection', (socket) => {
    const user = socket.user;
    if (!user) return;

    // ==================================================
    //  DIRECT MESSAGES (1-to-1)
    // ==================================================

    socket.on('direct_message', async (data, ack) => {
      try {
        const { to, content, type = 'text', mediaBucket, mediaObject, replyTo } = data;
        if (!to) throw new Error('Destinataire manquant');

        // Blocage ?
        if (await chats.isBlockedEither(user.id, to)) {
          if (typeof ack === 'function') ack({ error: 'Utilisateur bloqué' });
          return;
        }

        // Persister
        const msg = await messages.save({
          fromUserId: user.id,
          toUserId: to,
          content,
          type,
          mediaBucket,
          mediaObject,
          replyTo,
        });

        const payload = {
          ...msg,
          fromName: user.displayName,
        };

        // 1) Echo à TOUS les devices de l'expéditeur (multi-device sync)
        users.emitToUser(user.id, 'new_message', payload);

        // 2) Livrer au destinataire s'il est en ligne
        const delivered = users.emitToUser(to, 'new_message', payload);

        if (delivered) {
          await messages.markDelivered(msg.id, to);
          users.emitToUser(user.id, 'message_delivered', {
            messageId: msg.id,
            to,
            at: Date.now(),
          });
        } else {
          // Queue Redis (relais rapide à la reconnexion) + push
          await redis.queueMessage(to, payload);

          if (push && push.isEnabled()) {
            push.sendToUser(to, push.buildMessageNotification({
              fromName: user.displayName,
              preview: messages.messagePreview(type, content),
              chatId: user.id,
            })).catch(() => {});
          }
        }

        if (typeof ack === 'function') ack({ ok: true, message: payload });
      } catch (err) {
        console.warn('direct_message error:', err.message);
        if (typeof ack === 'function') ack({ error: err.message });
      }
    });

    // ==================================================
    //  TYPING INDICATORS
    // ==================================================

    socket.on('typing_start', (data) => {
      if (!data || !data.to) return;
      users.emitToUser(data.to, 'user_typing', {
        userId: user.id,
        displayName: user.displayName,
        chatId: data.chatId || user.id,
      });
    });

    socket.on('typing_stop', (data) => {
      if (!data || !data.to) return;
      users.emitToUser(data.to, 'user_stopped_typing', {
        userId: user.id,
        chatId: data.chatId || user.id,
      });
    });

    // ==================================================
    //  READ RECEIPTS
    // ==================================================

    // Le client envoie la liste des ids lus
    socket.on('messages_read', async (data) => {
      try {
        const { messageIds = [] } = data || {};
        const updated = await messages.markReadBulk(messageIds, user.id);

        // Regrouper par expéditeur pour notifier chaque device
        const bySender = new Map();
        for (const r of updated) {
          if (!bySender.has(r.fromUserId)) bySender.set(r.fromUserId, []);
          bySender.get(r.fromUserId).push(r.messageId);
        }
        for (const [senderId, ids] of bySender) {
          users.emitToUser(senderId, 'messages_read_by', {
            reader: user.id,
            messageIds: ids,
            at: Date.now(),
          });
        }

        // Echo aux autres devices du même user
        users.emitToUser(user.id, 'my_read_marker', {
          messageIds,
          at: Date.now(),
        }, socket.id);
      } catch (err) {
        console.warn('messages_read error:', err.message);
      }
    });

    // Le client a ouvert toute une conversation — marquer tout lu
    socket.on('conversation_read', async (data) => {
      try {
        const { peerId } = data || {};
        if (!peerId) return;
        const ids = await messages.markConversationRead(user.id, peerId);
        if (ids.length === 0) return;

        users.emitToUser(peerId, 'messages_read_by', {
          reader: user.id,
          messageIds: ids,
          at: Date.now(),
        });
        users.emitToUser(user.id, 'my_read_marker', {
          messageIds: ids,
          at: Date.now(),
        }, socket.id);
      } catch (err) {
        console.warn('conversation_read error:', err.message);
      }
    });

    // ==================================================
    //  REACTIONS
    // ==================================================

    socket.on('message_react', async (data, ack) => {
      try {
        const { messageId, emoji } = data;
        const target = await messages.react(messageId, user.id, emoji);
        broadcastReaction(target, { emoji, userId: user.id }, 'add');
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ error: err.message });
      }
    });

    socket.on('message_unreact', async (data, ack) => {
      try {
        const { messageId } = data;
        const target = await messages.unreact(messageId, user.id);
        broadcastReaction(target, { userId: user.id }, 'remove');
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ error: err.message });
      }
    });

    function broadcastReaction(target, payload, action) {
      const evt = {
        messageId: target.messageId,
        action, // 'add' | 'remove'
        ...payload,
      };
      if (target.groupId) {
        for (const memberId of target.members) {
          users.emitToUser(memberId, 'message_reaction', evt);
        }
      } else {
        users.emitToUser(target.from, 'message_reaction', evt);
        if (target.to) users.emitToUser(target.to, 'message_reaction', evt);
      }
    }

    // ==================================================
    //  GROUP CHAT (PostgreSQL)
    // ==================================================

    socket.on('create_group', async (data, ack) => {
      try {
        const group = await groups.create(user.id, {
          name: data.name,
          members: data.members || [],
          about: data.about,
        });
        // Notifier tous les membres
        for (const memberId of group.members) {
          users.emitToUser(memberId, 'group_created', group);
        }
        if (typeof ack === 'function') ack({ ok: true, group });
      } catch (err) {
        if (typeof ack === 'function') ack({ error: err.message });
      }
    });

    socket.on('get_groups', async () => {
      const list = await groups.listForUser(user.id);
      socket.emit('groups_list', list);
    });

    socket.on('group_message', async (data, ack) => {
      try {
        const { groupId, content, type = 'text', mediaBucket, mediaObject, replyTo } = data;
        if (!(await groups.isMember(groupId, user.id))) {
          throw new Error('Non membre du groupe');
        }

        const msg = await messages.save({
          fromUserId: user.id,
          groupId,
          content,
          type,
          mediaBucket,
          mediaObject,
          replyTo,
        });

        const payload = { ...msg, fromName: user.displayName };

        const memberIds = await groups.getMembers(groupId);
        for (const memberId of memberIds) {
          const delivered = users.emitToUser(memberId, 'new_group_message', payload);
          if (memberId !== user.id) {
            if (delivered) {
              await messages.markDelivered(msg.id, memberId);
            } else {
              await redis.queueMessage(memberId, { ...payload, isGroup: true });
              if (push && push.isEnabled()) {
                push.sendToUser(memberId, push.buildMessageNotification({
                  fromName: `${user.displayName}`,
                  preview: messages.messagePreview(type, content),
                  chatId: groupId,
                })).catch(() => {});
              }
            }
          }
        }

        if (typeof ack === 'function') ack({ ok: true, message: payload });
      } catch (err) {
        console.warn('group_message error:', err.message);
        if (typeof ack === 'function') ack({ error: err.message });
      }
    });
  });
}

module.exports = { setupChat };
