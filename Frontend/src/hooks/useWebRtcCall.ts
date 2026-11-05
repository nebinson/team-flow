/** Owns one-to-one WebRTC media, call signaling, and local call controls. */

import { useEffect, useRef, useState } from 'react';
import { callsApi, type CallKind, type CallSignal } from '../api/calls';
import type { Conversation } from '../types';

export type CallStatus = 'incoming' | 'outgoing' | 'connecting' | 'connected';

export type ActiveCall = {
  id: string;
  conversation: Conversation;
  peerUserId: string;
  kind: CallKind;
  status: CallStatus;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraEnabled: boolean;
  incomingOffer?: RTCSessionDescriptionInit;
};

type Props = {
  accessToken: string;
  findConversation: (id: string) => Conversation | undefined;
  sendSignal: (signal: CallSignal) => boolean;
  onToast: (message: string) => void;
};

export function useWebRtcCall({ accessToken, findConversation, sendSignal, onToast }: Props) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const callRef = useRef<ActiveCall | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingLocalCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const signalingReadyRef = useRef(false);
  const timeoutRef = useRef<number | undefined>(undefined);
  const accessTokenRef = useRef(accessToken);
  const findConversationRef = useRef(findConversation);
  const sendSignalRef = useRef(sendSignal);
  const onToastRef = useRef(onToast);
  accessTokenRef.current = accessToken;
  findConversationRef.current = findConversation;
  sendSignalRef.current = sendSignal;
  onToastRef.current = onToast;

  function updateCall(next: ActiveCall | null) {
    callRef.current = next;
    setCall(next);
  }

  function signal(session: ActiveCall, type: CallSignal['type'], values: Partial<CallSignal> = {}): boolean {
    return sendSignalRef.current({
      type,
      conversation_id: session.conversation.id,
      to_user_id: session.peerUserId,
      call_id: session.id,
      ...values,
    });
  }

  function closePeer() {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
    const peer = peerRef.current;
    peerRef.current = null;
    if (peer) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    const session = callRef.current;
    session?.localStream?.getTracks().forEach((track) => track.stop());
    pendingCandidatesRef.current = [];
    pendingLocalCandidatesRef.current = [];
    signalingReadyRef.current = false;
    updateCall(null);
  }

  async function getLocalMedia(kind: CallKind): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Calls need microphone access in a secure context. Open TeamFlow over HTTPS to call from another computer.');
    }
    return navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
  }

  async function createPeer(session: ActiveCall, stream: MediaStream): Promise<RTCPeerConnection> {
    const response = await callsApi.getIceServers(accessTokenRef.current);
    const peer = new RTCPeerConnection({ iceServers: response.ice_servers });
    peerRef.current = peer;
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON();
      if (signalingReadyRef.current) signal(session, 'call_ice', { candidate });
      else pendingLocalCandidatesRef.current.push(candidate);
    };
    peer.ontrack = (event) => {
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      if (callRef.current?.id === session.id) updateCall({ ...callRef.current, remoteStream });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected' && callRef.current?.id === session.id) {
        window.clearTimeout(timeoutRef.current);
        updateCall({ ...callRef.current, status: 'connected' });
      } else if (peer.connectionState === 'failed' && callRef.current?.id === session.id) {
        signal(session, 'call_end');
        closePeer();
        onToastRef.current('The call could not connect. Check the network and try again.');
      }
    };
    return peer;
  }

  async function startCall(conversationId: string, kind: CallKind) {
    if (callRef.current) {
      onToastRef.current('Finish the current call before starting another.');
      return;
    }
    const conversation = findConversationRef.current(conversationId);
    if (!conversation?.participantId) {
      onToastRef.current('This conversation does not have a call recipient.');
      return;
    }
    const session: ActiveCall = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      conversation,
      peerUserId: conversation.participantId,
      kind,
      status: 'outgoing',
      localStream: null,
      remoteStream: null,
      muted: false,
      cameraEnabled: kind === 'video',
    };
    updateCall(session);
    try {
      const stream = await getLocalMedia(kind);
      const withMedia = { ...session, localStream: stream };
      updateCall(withMedia);
      const peer = await createPeer(withMedia, stream);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!signal(withMedia, 'call_offer', { call_kind: kind, sdp: peer.localDescription?.toJSON() })) {
        throw new Error('The call connection is not ready. Please try again.');
      }
      signalingReadyRef.current = true;
      for (const candidate of pendingLocalCandidatesRef.current) signal(withMedia, 'call_ice', { candidate });
      pendingLocalCandidatesRef.current = [];
      timeoutRef.current = window.setTimeout(() => {
        if (callRef.current?.id === session.id && callRef.current.status !== 'connected') {
          signal(session, 'call_end');
          closePeer();
          onToastRef.current('No answer. The call has ended.');
        }
      }, 45000);
    } catch (error) {
      closePeer();
      onToastRef.current(error instanceof Error ? error.message : 'Could not start the call.');
    }
  }

  async function acceptCall() {
    const session = callRef.current;
    if (!session || session.status !== 'incoming' || !session.incomingOffer) return;
    window.clearTimeout(timeoutRef.current);
    try {
      const stream = await getLocalMedia(session.kind);
      const withMedia = { ...session, localStream: stream, status: 'connecting' as const };
      updateCall(withMedia);
      const peer = await createPeer(withMedia, stream);
      await peer.setRemoteDescription(new RTCSessionDescription(session.incomingOffer));
      for (const candidate of pendingCandidatesRef.current) await peer.addIceCandidate(new RTCIceCandidate(candidate));
      pendingCandidatesRef.current = [];
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (!signal(withMedia, 'call_answer', { sdp: peer.localDescription?.toJSON() })) {
        throw new Error('The call connection is not ready. Please try again.');
      }
      signalingReadyRef.current = true;
      for (const candidate of pendingLocalCandidatesRef.current) signal(withMedia, 'call_ice', { candidate });
      pendingLocalCandidatesRef.current = [];
    } catch (error) {
      signal(session, 'call_reject');
      closePeer();
      onToastRef.current(error instanceof Error ? error.message : 'Could not answer the call.');
    }
  }

  function rejectCall() {
    const session = callRef.current;
    if (session?.status === 'incoming') signal(session, 'call_reject');
    closePeer();
  }

  function hangUp() {
    const session = callRef.current;
    if (session) signal(session, session.status === 'incoming' ? 'call_reject' : 'call_end');
    closePeer();
  }

  function toggleMute() {
    const session = callRef.current;
    if (!session) return;
    const muted = !session.muted;
    session.localStream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    updateCall({ ...session, muted });
  }

  function toggleCamera() {
    const session = callRef.current;
    if (!session || session.kind !== 'video') return;
    const cameraEnabled = !session.cameraEnabled;
    session.localStream?.getVideoTracks().forEach((track) => { track.enabled = cameraEnabled; });
    updateCall({ ...session, cameraEnabled });
  }

  async function handleSignal(event: Record<string, unknown>) {
    const type = event.type;
    if (type === 'call_offer') {
      const conversation = findConversationRef.current(String(event.conversation_id ?? ''));
      const fromUserId = String(event.from_user_id ?? '');
      const callId = String(event.call_id ?? '');
      const kind = event.call_kind === 'video' ? 'video' : 'audio';
      if (!conversation || !fromUserId || !callId || !event.sdp || callRef.current) {
        if (conversation && fromUserId && callId) {
          sendSignalRef.current({ type: 'call_busy', conversation_id: conversation.id, to_user_id: fromUserId, call_id: callId });
        }
        return;
      }
      updateCall({
        id: callId,
        conversation,
        peerUserId: fromUserId,
        kind,
        status: 'incoming',
        localStream: null,
        remoteStream: null,
        muted: false,
        cameraEnabled: kind === 'video',
        incomingOffer: event.sdp as RTCSessionDescriptionInit,
      });
      timeoutRef.current = window.setTimeout(() => {
        if (callRef.current?.id === callId && callRef.current.status === 'incoming') {
          signal(callRef.current, 'call_missed');
          closePeer();
        }
      }, 38000);
      return;
    }

    const session = callRef.current;
    if (!session || event.call_id !== session.id) return;
    if (type === 'call_answer' && event.sdp && peerRef.current) {
      await peerRef.current.setRemoteDescription(new RTCSessionDescription(event.sdp as RTCSessionDescriptionInit));
      for (const candidate of pendingCandidatesRef.current) await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      pendingCandidatesRef.current = [];
      updateCall({ ...session, status: 'connecting' });
    } else if (type === 'call_ice' && event.candidate) {
      const candidate = event.candidate as RTCIceCandidateInit;
      if (peerRef.current?.remoteDescription) await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      else pendingCandidatesRef.current.push(candidate);
    } else if (type === 'call_unavailable' || type === 'call_reject' || type === 'call_busy' || type === 'call_end') {
      closePeer();
      const message = type === 'call_unavailable' ? 'This person is offline.' : type === 'call_busy' ? 'This person is already on a call.' : type === 'call_reject' ? 'The call was declined.' : 'The other person ended the call.';
      onToastRef.current(message);
    }
  }

  useEffect(() => () => closePeer(), []);

  return { call, startCall, acceptCall, rejectCall, hangUp, toggleMute, toggleCamera, handleSignal };
}
