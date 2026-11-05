/** Active one-to-one voice/video call surface with incoming and media controls. */

import { useEffect, useRef } from 'react';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import type { ActiveCall } from '../../hooks/useWebRtcCall';

type Props = {
  call: ActiveCall;
  onAccept: () => void;
  onReject: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
};

export function CallOverlay({ call, onAccept, onReject, onHangUp, onToggleMute, onToggleCamera }: Props) {
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = call.remoteStream;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = call.remoteStream;
    if (localVideoRef.current) localVideoRef.current.srcObject = call.localStream;
  }, [call.remoteStream, call.localStream]);

  const incoming = call.status === 'incoming';
  const statusText = incoming
    ? `Incoming ${call.kind} call`
    : call.status === 'connected'
      ? 'Connected'
      : call.status === 'connecting'
        ? 'Connecting…'
        : 'Calling…';

  return <div className="call-scrim" role="dialog" aria-modal="true" aria-label={`${call.kind} call with ${call.conversation.name}`}>
    <div className={`call-card ${call.kind === 'video' ? 'call-video' : ''}`}>
      {call.kind === 'video' && <div className="call-video-stage">
        {call.remoteStream ? <video ref={remoteVideoRef} className="call-remote-video" autoPlay playsInline /> : <div className="call-video-waiting"><Avatar initials={call.conversation.initials} color={call.conversation.color} size="lg" /><span>{incoming ? 'Incoming video call' : 'Waiting for video…'}</span></div>}
        <video ref={localVideoRef} className="call-local-video" autoPlay playsInline muted />
      </div>}
      {call.kind === 'audio' && <>
        <audio ref={remoteAudioRef} autoPlay />
        <div className="call-glow" />
        <Avatar initials={call.conversation.initials} color={call.conversation.color} size="lg" online={call.conversation.online} />
      </>}
      <button className="call-close icon-button" onClick={onHangUp} aria-label="End call"><Icon name="close" /></button>
      <span className={`call-status-pulse call-pulse-${call.status}`} />
      <h2>{call.conversation.name}</h2>
      <p>{statusText}</p>
      {call.kind === 'audio' && call.status === 'connected' && <div className="call-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>}
      <div className="call-controls">
        {incoming ? <>
          <button className="call-end" aria-label="Decline call" onClick={onReject}><Icon name="phone" /></button>
          <button className="call-answer" aria-label="Answer call" onClick={onAccept}><Icon name="phone" /></button>
        </> : <>
          <button className={call.muted ? 'call-control-active' : ''} aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'} onClick={onToggleMute}><Icon name="mic" /></button>
          {call.kind === 'video' && <button className={!call.cameraEnabled ? 'call-control-active' : ''} aria-label={call.cameraEnabled ? 'Turn camera off' : 'Turn camera on'} onClick={onToggleCamera}><Icon name="video" /></button>}
          <button className="call-end" aria-label="End call" onClick={onHangUp}><Icon name="phone" /></button>
        </>}
      </div>
    </div>
  </div>;
}
