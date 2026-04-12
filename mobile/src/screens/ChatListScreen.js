import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { colors, spacing, fonts } from '../theme';
import { getSocket, apiGetUsers } from '../services/socket';

export default function ChatListScreen({ navigation, currentUser }) {
  const [contacts, setContacts] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [lastMessages, setLastMessages] = useState({});

  useEffect(() => {
    loadContacts();
    const socket = getSocket();
    if (!socket) return;

    socket.emit('get_online_users');

    socket.on('online_users', (users) => {
      setOnlineUsers(new Set(users.map((u) => u.userId)));
    });

    socket.on('user_online', (data) => {
      setOnlineUsers((prev) => new Set([...prev, data.userId]));
    });

    socket.on('user_offline', (data) => {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        next.delete(data.userId);
        return next;
      });
    });

    socket.on('new_message', (msg) => {
      setLastMessages((prev) => ({ ...prev, [msg.from]: msg }));
    });

    return () => {
      socket.off('online_users');
      socket.off('user_online');
      socket.off('user_offline');
      socket.off('new_message');
    };
  }, []);

  const loadContacts = async () => {
    try {
      const users = await apiGetUsers();
      setContacts(users.filter((u) => u.id !== currentUser.id));
    } catch (err) {
      console.error('Erreur chargement contacts:', err);
    }
  };

  const renderContact = ({ item }) => {
    const isOnline = onlineUsers.has(item.id);
    const lastMsg = lastMessages[item.id];

    return (
      <TouchableOpacity
        style={styles.contactItem}
        onPress={() => navigation.navigate('Chat', { contact: item })}
      >
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isOnline ? colors.online : colors.offline },
            ]}
          />
        </View>

        {/* Info */}
        <View style={styles.contactInfo}>
          <Text style={styles.contactName}>{item.displayName}</Text>
          <Text style={styles.contactPreview} numberOfLines={1}>
            {lastMsg
              ? lastMsg.type === 'audio'
                ? 'Message vocal'
                : lastMsg.content
              : isOnline
              ? 'En ligne'
              : 'Hors ligne'}
          </Text>
        </View>

        {/* Time */}
        {lastMsg && (
          <Text style={styles.timeText}>
            {new Date(lastMsg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Buchat</Text>
        <Text style={styles.headerSubtitle}>
          {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Contact List */}
      {contacts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Aucun contact</Text>
          <Text style={styles.emptySubtext}>
            Invitez vos amis à rejoindre Buchat !
          </Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id}
          renderItem={renderContact}
          style={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.primaryDark,
    paddingTop: 50,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  headerTitle: {
    fontSize: fonts.sizes.header,
    fontWeight: 'bold',
    color: colors.textOnPrimary,
  },
  headerSubtitle: {
    fontSize: fonts.sizes.small,
    color: colors.textOnPrimary,
    opacity: 0.7,
  },
  list: {
    flex: 1,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: spacing.md,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: fonts.sizes.title,
    fontWeight: 'bold',
    color: colors.textOnPrimary,
  },
  statusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: fonts.sizes.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  contactPreview: {
    fontSize: fonts.sizes.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  timeText: {
    fontSize: fonts.sizes.small,
    color: colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: fonts.sizes.title,
    color: colors.textSecondary,
    fontWeight: 'bold',
  },
  emptySubtext: {
    fontSize: fonts.sizes.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
});
