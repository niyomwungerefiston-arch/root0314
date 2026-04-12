import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import { colors, spacing, fonts } from '../theme';
import { getSocket } from '../services/socket';
import { startRecording, stopRecording, playAudio } from '../services/audio';

export default function ChatScreen({ route, navigation, currentUser }) {
  const { contact } = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    navigation.setOptions({
      headerTitle: contact.displayName,
    });

    const handleMessage = (msg) => {
      if (msg.from === contact.id) {
        setMessages((prev) => [...prev, msg]);
      }
    };

    const handleTyping = (data) => {
      if (data.userId === contact.id) setIsTyping(true);
    };

    const handleStopTyping = (data) => {
      if (data.userId === contact.id) setIsTyping(false);
    };

    socket.on('new_message', handleMessage);
    socket.on('user_typing', handleTyping);
    socket.on('user_stopped_typing', handleStopTyping);

    return () => {
      socket.off('new_message', handleMessage);
      socket.off('user_typing', handleTyping);
      socket.off('user_stopped_typing', handleStopTyping);
    };
  }, [contact.id]);

  const sendMessage = () => {
    if (!inputText.trim()) return;
    const socket = getSocket();
    if (!socket) return;

    const msg = {
      id: Date.now().toString(),
      from: currentUser.id,
      to: contact.id,
      content: inputText.trim(),
      type: 'text',
      timestamp: Date.now(),
    };

    socket.emit('direct_message', {
      to: contact.id,
      content: inputText.trim(),
      type: 'text',
    });

    setMessages((prev) => [...prev, msg]);
    setInputText('');
    socket.emit('typing_stop', { to: contact.id });
  };

  const handleTextChange = (text) => {
    setInputText(text);
    const socket = getSocket();
    if (!socket) return;

    socket.emit('typing_start', { to: contact.id });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing_stop', { to: contact.id });
    }, 2000);
  };

  const handleVoiceRecord = async () => {
    if (isRecording) {
      const uri = await stopRecording();
      setIsRecording(false);
      if (uri) {
        const socket = getSocket();
        if (!socket) return;

        const msg = {
          id: Date.now().toString(),
          from: currentUser.id,
          to: contact.id,
          content: uri,
          type: 'audio',
          timestamp: Date.now(),
        };

        socket.emit('direct_message', {
          to: contact.id,
          content: uri,
          type: 'audio',
        });

        setMessages((prev) => [...prev, msg]);
      }
    } else {
      try {
        await startRecording();
        setIsRecording(true);
      } catch (err) {
        Alert.alert('Erreur', 'Impossible de démarrer l\'enregistrement');
      }
    }
  };

  const initiateCall = (callType) => {
    navigation.navigate('Call', { contact, callType });
  };

  const renderMessage = ({ item }) => {
    const isMine = item.from === currentUser.id;

    return (
      <View
        style={[
          styles.messageBubble,
          isMine ? styles.myMessage : styles.theirMessage,
        ]}
      >
        {item.type === 'audio' ? (
          <TouchableOpacity
            style={styles.audioButton}
            onPress={() => playAudio(item.content)}
          >
            <Text style={isMine ? styles.myMessageText : styles.theirMessageText}>
              ▶ Message vocal
            </Text>
          </TouchableOpacity>
        ) : (
          <Text
            style={isMine ? styles.myMessageText : styles.theirMessageText}
          >
            {item.content}
          </Text>
        )}
        <Text
          style={[
            styles.timeStamp,
            { color: isMine ? 'rgba(255,255,255,0.6)' : colors.textSecondary },
          ]}
        >
          {new Date(item.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{contact.displayName}</Text>
          {isTyping && (
            <Text style={styles.typingText}>écrit...</Text>
          )}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.callButton}
            onPress={() => initiateCall('audio')}
          >
            <Text style={styles.callIcon}>📞</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.callButton}
            onPress={() => initiateCall('video')}
          >
            <Text style={styles.callIcon}>📹</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: true })
        }
      />

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TouchableOpacity
          style={[
            styles.micButton,
            isRecording && styles.micButtonRecording,
          ]}
          onPress={handleVoiceRecord}
        >
          <Text style={styles.micIcon}>{isRecording ? '⏹' : '🎤'}</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.textInput}
          placeholder="Écrire un message..."
          placeholderTextColor={colors.textSecondary}
          value={inputText}
          onChangeText={handleTextChange}
          multiline
        />

        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Text style={styles.sendIcon}>➤</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.chatBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryDark,
    paddingTop: 50,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  backButton: {
    fontSize: 24,
    color: colors.textOnPrimary,
    marginRight: spacing.md,
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    fontSize: fonts.sizes.subtitle,
    fontWeight: 'bold',
    color: colors.textOnPrimary,
  },
  typingText: {
    fontSize: fonts.sizes.small,
    color: colors.accentLight,
    fontStyle: 'italic',
  },
  headerActions: {
    flexDirection: 'row',
  },
  callButton: {
    padding: spacing.sm,
    marginLeft: spacing.sm,
  },
  callIcon: {
    fontSize: 20,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: spacing.md,
  },
  messageBubble: {
    maxWidth: '75%',
    padding: spacing.md,
    borderRadius: 16,
    marginBottom: spacing.sm,
  },
  myMessage: {
    backgroundColor: colors.bubbleSent,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  theirMessage: {
    backgroundColor: colors.bubbleReceived,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  myMessageText: {
    color: colors.bubbleSentText,
    fontSize: fonts.sizes.body,
  },
  theirMessageText: {
    color: colors.bubbleReceivedText,
    fontSize: fonts.sizes.body,
  },
  timeStamp: {
    fontSize: 10,
    marginTop: 4,
    textAlign: 'right',
  },
  audioButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  micButtonRecording: {
    backgroundColor: colors.error,
  },
  micIcon: {
    fontSize: 18,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fonts.sizes.body,
    color: colors.textPrimary,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  sendIcon: {
    fontSize: 18,
    color: colors.textOnAccent,
  },
});
