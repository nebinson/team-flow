/** Composes the modular workspace panels and their shared selection state. */

import { useState, type FormEvent } from 'react';
import type { Conversation, Message, Theme } from '../../types';
import { Toast } from '../Toast';
import { CallOverlay } from './CallOverlay';
import { ChatRoom } from './ChatRoom';
import { ConversationList } from './ConversationList';
import { DetailsPanel } from './DetailsPanel';
import { NewConversationDialog } from './NewConversationDialog';
import { SidebarRail } from './SidebarRail';
import { Icon } from '../Icon';

type Props = {
  theme: Theme;
  currentUserName: string;
  accessToken: string;
  isDemo: boolean;
  onCreateConversation: (username: string) => Promise<void>;
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

export function Workspace({ theme, currentUserName, accessToken, isDemo, onCreateConversation, onToggleTheme, onSignOut, onToast, conversations, messagesByConversation, activeId, onSelectConversation, query, onQueryChange, filter, onFilterChange, draft, onDraftChange, onSend, detailsOpen, onToggleDetails, callKind, onCall, onCloseCall, toast }: Props) {
  const [mobilePanel, setMobilePanel] = useState<'list' | 'chat'>('chat');
  const conversation = conversations.find((item) => item.id === activeId) ?? conversations[0];
  const messages = conversation ? messagesByConversation[conversation.id] ?? conversation.messages : [];
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  function selectConversation(id: string) {
    onSelectConversation(id);
    setMobilePanel('chat');
  }
  function startConversation() {
    if (isDemo || !accessToken) {
      onToast('Sign in to start a conversation with a teammate.');
      return;
    }
    setNewConversationOpen(true);
  }
  async function createConversation(username: string) {
    await onCreateConversation(username);
    setMobilePanel('chat');
  }

  return <div className={`app-shell mobile-${mobilePanel}-active`}>
    <SidebarRail theme={theme} currentUserName={currentUserName} onToggleTheme={onToggleTheme} onToast={onToast} onSignOut={onSignOut} />
    <ConversationList conversations={conversations} messagesByConversation={messagesByConversation} activeId={activeId} onSelect={selectConversation} query={query} onQueryChange={onQueryChange} filter={filter} onFilterChange={onFilterChange} onToast={onToast} onNewConversation={startConversation} />
    {conversation ? <ChatRoom conversation={conversation} messages={messages} detailsOpen={detailsOpen} draft={draft} onDraftChange={onDraftChange} onSend={onSend} onCall={onCall} onToggleDetails={onToggleDetails} onToast={onToast} onBackToList={() => setMobilePanel('list')} /> : <EmptyConversation onNewConversation={startConversation} />}
    {detailsOpen && conversation && <DetailsPanel conversation={conversation} onClose={onToggleDetails} onCall={onCall} onToast={onToast} />}
    {callKind && conversation && <CallOverlay kind={callKind} conversation={conversation} onClose={onCloseCall} onToast={onToast} />}
    {newConversationOpen && accessToken && <NewConversationDialog token={accessToken} onClose={() => setNewConversationOpen(false)} onCreate={createConversation} />}
    <Toast message={toast} />
  </div>;
}

function EmptyConversation({ onNewConversation }: { onNewConversation: () => void }) {
  return <main className="chat-main empty-chat-main"><div className="empty-chat-card"><div className="empty-chat-mark"><Icon name="chat" size={24} /></div><span className="workspace-label">A LITTLE MORE CONNECTED</span><h2>Your conversations start here.</h2><p>Find a teammate by name or username and send your first message.</p><button className="primary-button" onClick={onNewConversation}><Icon name="plus" size={16} /> Start a conversation</button></div></main>;
}
