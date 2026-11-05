/** Call preview shell; media and WebRTC signaling will be wired later. */

import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import type { Conversation } from '../../types';

export function CallOverlay({ kind, conversation, onClose, onToast }: { kind: 'audio' | 'video'; conversation: Conversation; onClose: () => void; onToast: (message: string) => void }) {
  return <div className="call-scrim" role="dialog" aria-modal="true" aria-label={`${kind === 'video' ? 'Video' : 'Voice'} call`}><div className={`call-card ${kind === 'video' ? 'call-video' : ''}`}><button className="call-close icon-button" onClick={onClose} aria-label="Close call"><Icon name="close" /></button><div className="call-glow" /><Avatar initials={conversation.initials} color={conversation.color} size="lg" online /><span className="call-status-pulse" /><h2>{conversation.name}</h2><p>{kind === 'video' ? 'Starting video call…' : 'Calling…'}</p><div className="call-wave"><i /><i /><i /><i /><i /><i /><i /></div><div className="call-controls"><button aria-label="Mute microphone" onClick={() => onToast('Microphone controls will be available when calling is connected.')}><Icon name="mic" /></button>{kind === 'video' && <button aria-label="Toggle camera" onClick={() => onToast('Camera controls will be available when calling is connected.')}><Icon name="video" /></button>}<button className="call-end" aria-label="End call" onClick={onClose}><Icon name="phone" /></button></div><span className="call-demo-label">CALL PREVIEW</span></div></div>;
}
