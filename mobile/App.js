import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';

import LoginScreen from './src/screens/LoginScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatScreen from './src/screens/ChatScreen';
import CallScreen from './src/screens/CallScreen';
import { connectSocket, getCurrentUser, getSocket } from './src/services/socket';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const savedUser = await getCurrentUser();
      if (savedUser) {
        await connectSocket();
        setUser(savedUser);
        setupIncomingCallHandler();
      }
    } catch (err) {
      console.log('Pas de session sauvegardée');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (loggedUser) => {
    setUser(loggedUser);
    await connectSocket();
    setupIncomingCallHandler();
  };

  const setupIncomingCallHandler = () => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('call_incoming', (data) => {
      // Navigate to call screen for incoming calls
      if (navigationRef.current) {
        navigationRef.current.navigate('Call', {
          contact: { id: data.from, displayName: data.fromName },
          callType: data.callType,
          incoming: true,
          callId: data.callId,
          iceServers: data.iceServers,
        });
      }
    });
  };

  const navigationRef = React.useRef();

  if (loading) {
    return null;
  }

  if (!user) {
    return (
      <>
        <StatusBar style="light" />
        <LoginScreen onLogin={handleLogin} />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="ChatList">
            {(props) => <ChatListScreen {...props} currentUser={user} />}
          </Stack.Screen>
          <Stack.Screen name="Chat">
            {(props) => <ChatScreen {...props} currentUser={user} />}
          </Stack.Screen>
          <Stack.Screen
            name="Call"
            options={{ presentation: 'fullScreenModal' }}
          >
            {(props) => <CallScreen {...props} currentUser={user} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}
