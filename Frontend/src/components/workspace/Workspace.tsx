import { useState, type FormEvent } from 'react';
import type { Conversation, Message, Theme } from '../../types';
import { Toast } from '../Toast';
import { CallOverlay } from './CallOverlay';
import { ChatRoom } from './ChatRoom';
import { ConversationList } from './ConversationList';
import { DetailsPanel } from './DetailsPanel';
import { SidebarRail } from './SidebarRail';

type Props = {
  theme: Theme;
  onToggleTheme: () => void;
  onSignOut: () => void;
  onToast: (message: string) => void;
  conversations: Conversation[];
  messagesByConversation: Record<string, Message[]>;
  activeId: string;
  onSelectConversation: (id: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  filter: 'all' | 'unread';
  onFilterChange: (value: 'all' | 'unread') => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (event?: FormEvent) => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  callKind: '' | 'audio' | 'video';
  onCall: (kind: 'audio' | 'video') => void;
  onCloseCall: () => void;
  toast: string;
};

export function Workspace({ theme, onToggleTheme, onSignOut, onToast, conversations, messagesByConversation, activeId, onSelectConversation, query, onQueryChange, filter, onFilterChange, draft, onDraftChange, onSend, detailsOpen, onToggleDetails, callKind, onCall, onCloseCall, toast }: Props) {
  const [mobilePanel, setMobilePanel] = useState<'list' | 'chat'>('chat');
  const conversation = conversations.find((item) => item.id === activeId) ?? conversations[0];
  const messages = messagesByConversation[conversation.id] ?? conversation.messages;
  function selectConversation(id: string) {
    onSelectConversation(id);
    setMobilePanel('chat');
  }

  return <div className={`app-shell mobile-${mobilePanel}-active`}>
    <SidebarRail theme={theme} onToggleTheme={onToggleTheme} onToast={onToast} onSignOut={onSignOut} />
    <ConversationList conversations={conversations} messagesByConversation={messagesByConversation} activeId={activeId} onSelect={selectConversation} query={query} onQueryChange={onQueryChange} filter={filter} onFilterChange={onFilterChange} onToast={onToast} />
    <ChatRoom conversation={conversation} messages={messages} detailsOpen={detailsOpen} draft={draft} onDraftChange={onDraftChange} onSend={onSend} onCall={onCall} onToggleDetails={onToggleDetails} onToast={onToast} onBackToList={() => setMobilePanel('list')} />
    {detailsOpen && <DetailsPanel conversation={conversation} onClose={onToggleDetails} onCall={onCall} onToast={onToast} />}
    {callKind && <CallOverlay kind={callKind} conversation={conversation} onClose={onCloseCall} onToast={onToast} />}
    <Toast message={toast} />
  </div>;
}
