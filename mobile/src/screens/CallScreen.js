import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { colors, spacing, fonts } from '../theme';
import { getSocket } from '../services/socket';
import {
  getLocalStream,
  createPeerConnection,
  createOffer,
  createAnswer,
  setRemoteDescription,
  addIceCandidate,
  toggleAudio,
  toggleVideo,
  switchCamera,
  cleanup,
  getLocalStreamRef,
  getRemoteStreamRef,
} from '../services/webrtc';

export default function CallScreen({ route, navigation, currentUser }) {
  const { contact, callType, incoming, callId: incomingCallId, iceServers } = route.params;
  const [callStatus, setCallStatus] = useState(incoming ? 'incoming' : 'connecting');
  const [callDuration, setCallDuration] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(callType === 'video');
  const [localStreamURL, setLocalStreamURL] = useState(null);
  const [remoteStreamURL, setRemoteStreamURL] = useState(null);
  const callIdRef = useRef(incomingCallId || null);
  const timerRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    setupCall();

    socket.on('call_ringing', handleRinging);
    socket.on('call_accepted', handleAccepted);
    socket.on('call_rejected', handleRejected);
    socket.on('call_ended', handleEnded);
    socket.on('sdp_offer', handleSdpOffer);
    socket.on('sdp_answer', handleSdpAnswer);
    socket.on('ice_candidate', handleIceCandidate);

    return () => {
      socket.off('call_ringing', handleRinging);
      socket.off('call_accepted', handleAccepted);
      socket.off('call_rejected', handleRejected);
      socket.off('call_ended', handleEnded);
      socket.off('sdp_offer', handleSdpOffer);
      socket.off('sdp_answer', handleSdpAnswer);
      socket.off('ice_candidate', handleIceCandidate);
      if (timerRef.current) clearInterval(timerRef.current);
      cleanup();
    };
  }, []);

  const setupCall = async () => {
    const stream = await getLocalStream(callType === 'video');
    setLocalStreamURL(stream.toURL());

    if (!incoming) {
      // Outgoing call
      const socket = getSocket();
      socket.emit('call_initiate', { to: contact.id, callType });
    }
  };

  const handleRinging = async (data) => {
    callIdRef.current = data.callId;
    setCallStatus('ringing');

    // Create peer connection and offer
    const pc = createPeerConnection(
      data.iceServers,
      (remoteStream) => setRemoteStreamURL(remoteStream.toURL()),
      (candidate) => {
        const socket = getSocket();
        socket.emit('ice_candidate', { callId: callIdRef.current, candidate });
      }
    );

    const offer = await createOffer();
    const socket = getSocket();
    socket.emit('sdp_offer', { callId: callIdRef.current, sdp: offer });
  };

  const handleAccepted = () => {
    setCallStatus('active');
    startTimer();
  };

  const handleRejected = () => {
    setCallStatus('rejected');
    setTimeout(() => navigation.goBack(), 2000);
  };

  const handleEnded = () => {
    setCallStatus('ended');
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeout(() => navigation.goBack(), 1500);
  };

  const handleSdpOffer = async (data) => {
    if (data.callId !== callIdRef.current) return;

    const pc = createPeerConnection(
      iceServers,
      (remoteStream) => setRemoteStreamURL(remoteStream.toURL()),
      (candidate) => {
        const socket = getSocket();
        socket.emit('ice_candidate', { callId: callIdRef.current, candidate });
      }
    );

    await setRemoteDescription(data.sdp);
    const answer = await createAnswer();
    const socket = getSocket();
    socket.emit('sdp_answer', { callId: callIdRef.current, sdp: answer });
  };

  const handleSdpAnswer = async (data) => {
    if (data.callId !== callIdRef.current) return;
    await setRemoteDescription(data.sdp);
  };

  const handleIceCandidate = async (data) => {
    if (data.callId !== callIdRef.current) return;
    await addIceCandidate(data.candidate);
  };

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const acceptCall = () => {
    const socket = getSocket();
    socket.emit('call_accept', { callId: callIdRef.current });
    setCallStatus('active');
    startTimer();
  };

  const rejectCall = () => {
    const socket = getSocket();
    socket.emit('call_reject', { callId: callIdRef.current });
    cleanup();
    navigation.goBack();
  };

  const endCall = () => {
    const socket = getSocket();
    socket.emit('call_end', { callId: callIdRef.current });
    if (timerRef.current) clearInterval(timerRef.current);
    cleanup();
    navigation.goBack();
  };

  const handleToggleAudio = () => {
    setAudioEnabled(!audioEnabled);
    toggleAudio(!audioEnabled);
  };

  const handleToggleVideo = () => {
    setVideoEnabled(!videoEnabled);
    toggleVideo(!videoEnabled);
    const socket = getSocket();
    socket.emit('call_toggle_video', {
      callId: callIdRef.current,
      videoEnabled: !videoEnabled,
    });
  };

  return (
    <View style={styles.container}>
      {/* Video views */}
      {callType === 'video' && remoteStreamURL && (
        <RTCView
          streamURL={remoteStreamURL}
          style={styles.remoteVideo}
          objectFit="cover"
        />
      )}

      {callType === 'video' && localStreamURL && (
        <RTCView
          streamURL={localStreamURL}
          style={styles.localVideo}
          objectFit="cover"
          mirror
        />
      )}

      {/* Overlay info */}
      <View style={styles.overlay}>
        <View style={styles.topInfo}>
          <Text style={styles.contactName}>{contact.displayName}</Text>
          <Text style={styles.statusText}>
            {callStatus === 'connecting' && 'Connexion...'}
            {callStatus === 'ringing' && 'Sonnerie...'}
            {callStatus === 'incoming' && 'Appel entrant...'}
            {callStatus === 'active' && formatDuration(callDuration)}
            {callStatus === 'rejected' && 'Appel rejeté'}
            {callStatus === 'ended' && 'Appel terminé'}
          </Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          {callStatus === 'incoming' ? (
            /* Incoming call buttons */
            <View style={styles.incomingControls}>
              <TouchableOpacity
                style={[styles.controlButton, styles.rejectButton]}
                onPress={rejectCall}
              >
                <Text style={styles.controlIcon}>✕</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.controlButton, styles.acceptButton]}
                onPress={acceptCall}
              >
                <Text style={styles.controlIcon}>✓</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Active/ringing call buttons */
            <View style={styles.activeControls}>
              <TouchableOpacity
                style={[
                  styles.controlButton,
                  !audioEnabled && styles.controlButtonOff,
                ]}
                onPress={handleToggleAudio}
              >
                <Text style={styles.controlIcon}>
                  {audioEnabled ? '🔊' : '🔇'}
                </Text>
              </TouchableOpacity>

              {callType === 'video' && (
                <>
                  <TouchableOpacity
                    style={[
                      styles.controlButton,
                      !videoEnabled && styles.controlButtonOff,
                    ]}
                    onPress={handleToggleVideo}
                  >
                    <Text style={styles.controlIcon}>
                      {videoEnabled ? '📹' : '📷'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.controlButton}
                    onPress={switchCamera}
                  >
                    <Text style={styles.controlIcon}>🔄</Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                style={[styles.controlButton, styles.endButton]}
                onPress={endCall}
              >
                <Text style={styles.controlIcon}>📞</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryDark,
  },
  remoteVideo: {
    flex: 1,
  },
  localVideo: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 120,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    zIndex: 10,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  topInfo: {
    alignItems: 'center',
    paddingTop: 80,
  },
  contactName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textOnPrimary,
  },
  statusText: {
    fontSize: fonts.sizes.subtitle,
    color: colors.accentLight,
    marginTop: spacing.sm,
  },
  controls: {
    paddingBottom: 40,
  },
  incomingControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  activeControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  controlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonOff: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  acceptButton: {
    backgroundColor: colors.online,
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  rejectButton: {
    backgroundColor: colors.error,
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  endButton: {
    backgroundColor: colors.error,
  },
  controlIcon: {
    fontSize: 24,
    color: colors.textOnPrimary,
  },
});
