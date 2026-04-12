import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
} from 'react-native-webrtc';
import { getSocket } from './socket';

let peerConnection = null;
let localStream = null;
let remoteStream = null;

const defaultConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export async function getLocalStream(video = false) {
  const stream = await mediaDevices.getUserMedia({
    audio: true,
    video: video ? { facingMode: 'user', width: 640, height: 480 } : false,
  });
  localStream = stream;
  return stream;
}

export function createPeerConnection(iceServers, onRemoteStream, onIceCandidate) {
  const config = iceServers ? { iceServers } : defaultConfig;
  peerConnection = new RTCPeerConnection(config);

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  // Handle remote stream
  peerConnection.ontrack = (event) => {
    remoteStream = event.streams[0];
    if (onRemoteStream) onRemoteStream(remoteStream);
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && onIceCandidate) {
      onIceCandidate(event.candidate);
    }
  };

  return peerConnection;
}

export async function createOffer() {
  if (!peerConnection) return null;
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  return offer;
}

export async function createAnswer() {
  if (!peerConnection) return null;
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  return answer;
}

export async function setRemoteDescription(sdp) {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
}

export async function addIceCandidate(candidate) {
  if (!peerConnection) return;
  await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
}

export function toggleVideo(enabled) {
  if (!localStream) return;
  localStream.getVideoTracks().forEach((track) => {
    track.enabled = enabled;
  });
}

export function toggleAudio(enabled) {
  if (!localStream) return;
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = enabled;
  });
}

export function switchCamera() {
  if (!localStream) return;
  localStream.getVideoTracks().forEach((track) => {
    track._switchCamera();
  });
}

export function cleanup() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteStream = null;
}

export function getLocalStreamRef() {
  return localStream;
}

export function getRemoteStreamRef() {
  return remoteStream;
}
