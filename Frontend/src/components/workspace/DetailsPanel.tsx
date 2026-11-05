/** Current conversation profile and available actions. */

import type { Conversation } from '../../types';
import { Icon } from '../Icon';
import { Avatar } from '../Avatar';

export function DetailsPanel({ conversation, onClose, onCall, onToast }: { conversation: Conversation; onClose: () => void; onCall: (kind: 'audio' | 'video') => void; onToast: (message: string) => void }) {
  return <aside className="details-panel">
    <div className="details-header"><div><span className="workspace-label">CONVERSATION</span><h3>Details</h3></div><button className="icon-button" aria-label="Close details" onClick={onClose}><Icon name="close" size={18} /></button></div>
    <div className="details-hero"><Avatar initials={conversation.initials} color={conversation.color} size="lg" /><h3>{conversation.name}</h3><p>{conversation.role}</p><div className="detail-quick-actions"><button onClick={() => onCall('audio')}><Icon name="phone" size={17} /><span>Call</span></button><button onClick={() => onCall('video')}><Icon name="video" size={17} /><span>Video</span></button><button onClick={() => onToast('Conversation link copied.')}><Icon name="copy" size={17} /><span>Copy link</span></button></div></div>
    <div className="detail-section"><div className="section-heading"><h4>Direct conversation</h4><span className="ai-tag">PRIVATE</span></div><p className="summary-copy">Messages in this conversation are visible to its participants.</p></div>
  </aside>;
}
