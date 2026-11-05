import type { Conversation } from '../../types';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { conversationSummary } from '../../data/conversations';

export function DetailsPanel({ conversation, onClose, onCall, onToast }: { conversation: Conversation; onClose: () => void; onCall: (kind: 'audio' | 'video') => void; onToast: (message: string) => void }) {
  return <aside className="details-panel">
    <div className="details-header"><div><span className="workspace-label">CONVERSATION</span><h3>Details</h3></div><button className="icon-button" aria-label="Close details" onClick={onClose}><Icon name="close" size={18} /></button></div>
    <div className="details-hero"><Avatar initials={conversation.initials} color={conversation.color} size="lg" /><h3>{conversation.name}</h3><p>{conversation.role}</p><div className="detail-quick-actions"><button onClick={() => onCall('audio')}><Icon name="phone" size={17} /><span>Call</span></button><button onClick={() => onCall('video')}><Icon name="video" size={17} /><span>Video</span></button><button onClick={() => onToast('Conversation link copied.')}><Icon name="copy" size={17} /><span>Copy link</span></button></div></div>
    <div className="detail-section"><div className="section-heading"><h4><Icon name="sparkles" size={16} /> AI summary</h4><span className="ai-tag">AI</span></div><p className="summary-copy">{conversationSummary}</p><span className="summary-updated">Updated just now · 5 messages</span></div>
    <div className="detail-section sentiment-section"><div className="section-heading"><h4>Conversation tone</h4><span className="tone-score">Mostly positive</span></div><div className="tone-bar"><span /><span /><span /></div><div className="tone-legend"><span><i className="tone-positive" /> Positive <b>3</b></span><span><i className="tone-neutral" /> Neutral <b>2</b></span></div></div>
    <div className="detail-section members-section"><div className="section-heading"><h4>People</h4><button className="text-button" onClick={() => onToast('Member management is coming soon.')}>See all</button></div><div className="member-avatars"><Avatar initials="AR" color="peach" online size="sm" /><Avatar initials="KM" color="blue" online size="sm" /><Avatar initials="RS" color="mint" size="sm" /><Avatar initials="+5" color="lavender" size="sm" /></div></div>
  </aside>;
}
