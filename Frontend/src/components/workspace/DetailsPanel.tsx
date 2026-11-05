/** Current conversation profile and available actions. */

import { useState } from 'react';
import type { Conversation } from '../../types';
import { Icon } from '../Icon';
import { Avatar } from '../Avatar';
import { aiApi, type ConversationSummary } from '../../api/ai';

export function DetailsPanel({ conversation, token, onClose, onCall, onToast }: { conversation: Conversation; token: string; onClose: () => void; onCall: (kind: 'audio' | 'video') => void; onToast: (message: string) => void }) {
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  async function generateSummary() {
    if (summaryLoading) return;
    setSummaryLoading(true);
    try {
      setSummary(await aiApi.summarizeConversation(token, conversation.id));
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not generate a conversation summary.');
    } finally {
      setSummaryLoading(false);
    }
  }
  return <aside className="details-panel">
    <div className="details-header"><div><span className="workspace-label">CONVERSATION</span><h3>Details</h3></div><button className="icon-button" aria-label="Close details" onClick={onClose}><Icon name="close" size={18} /></button></div>
    <div className="details-hero"><Avatar initials={conversation.initials} color={conversation.color} size="lg" /><h3>{conversation.name}</h3><p>{conversation.role}</p><div className="detail-quick-actions"><button onClick={() => onCall('audio')}><Icon name="phone" size={17} /><span>Call</span></button><button onClick={() => onCall('video')}><Icon name="video" size={17} /><span>Video</span></button><button onClick={() => onToast('Conversation link copied.')}><Icon name="copy" size={17} /><span>Copy link</span></button></div></div>
    <div className="detail-section"><div className="section-heading"><h4>AI summary</h4><span className="ai-tag">AI</span></div>{summary ? <><p className="summary-copy generated-summary">{summary.summary}</p><small className="summary-provider">{summary.provider} · {summary.message_count} messages</small></> : <p className="summary-copy">Create a concise overview of this conversation’s topics and decisions.</p>}<button className="summary-generate" onClick={() => void generateSummary()} disabled={summaryLoading}>{summaryLoading ? 'Summarizing…' : summary ? 'Refresh summary' : 'Generate summary'}<Icon name="sparkles" size={14} /></button></div>
  </aside>;
}
