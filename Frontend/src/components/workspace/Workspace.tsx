/** Composes the modular workspace panels and their shared selection state. */

import { useEffect, useState, type FormEvent } from 'react';
import type { Conversation, Message, Theme } from '../../types';
import { Toast } from '../Toast';
import { CallOverlay } from './CallOverlay';
import { ChatRoom } from './ChatRoom';
import { AiChatRoom } from './AiChatRoom';
import { CallLogsPanel } from './CallLogsPanel';
import { ConversationList } from './ConversationList';
import { DetailsPanel } from './DetailsPanel';
import { NewConversationDialog } from './NewConversationDialog';
import { SidebarRail } from './SidebarRail';
import { Icon } from '../Icon';
import type { ApiCallLog, CallKind } from '../../api/calls';
import type { ActiveCall } from '../../hooks/useWebRtcCall';

type Props = {
  theme: Theme;
  currentUserName: string;
  accessToken: string;
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
  onTyping: (typing: boolean) => void;
  typingName?: string;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  call: ActiveCall | null;
  onCall: (conversationId: string, kind: CallKind) => void;
  onAcceptCall: () => void;
  onRejectCall: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  toast: string;
  callLogs: ApiCallLog[];
  callLogsLoading: boolean;
  onLoadCallLogs: () => void;
};

export function Workspace({ theme, currentUserName, accessToken, onCreateConversation, onToggleTheme, onSignOut, onToast, conversations, messagesByConversation, activeId, onSelectConversation, query, onQueryChange, filter, onFilterChange, draft, onDraftChange, onSend, onTyping, typingName, detailsOpen, onToggleDetails, call, onCall, onAcceptCall, onRejectCall, onHangUp, onToggleMute, onToggleCamera, toast, callLogs, callLogsLoading, onLoadCallLogs }: Props) {
  const [mobilePanel, setMobilePanel] = useState<'list' | 'chat'>('list');
  const [activeView, setActiveView] = useState<'messages' | 'calls' | 'ai'>('messages');
  const conversation = conversations.find((item) => item.id === activeId);
  const messages = conversation ? messagesByConversation[conversation.id] ?? conversation.messages : [];
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  function selectConversation(id: string) {
    setActiveView('messages');
    onSelectConversation(id);
    setMobilePanel('chat');
  }
  function startConversation() {
    if (!accessToken) {
      onToast('Sign in to start a conversation with a teammate.');
      return;
    }
    setNewConversationOpen(true);
  }
  async function createConversation(username: string) {
    await onCreateConversation(username);
    setMobilePanel('chat');
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || activeView !== 'messages' || !activeId || newConversationOpen || call) return;
      event.preventDefault();
      onTyping(false);
      onDraftChange('');
      if (detailsOpen) onToggleDetails();
      onSelectConversation('');
      setMobilePanel('list');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeId, activeView, call, detailsOpen, newConversationOpen, onDraftChange, onSelectConversation, onToggleDetails, onTyping]);

  return <div className={`app-shell mobile-${mobilePanel}-active${activeView === 'calls' ? ' calls-view-active' : ''}`}>
    <SidebarRail theme={theme} currentUserName={currentUserName} activeView={activeView === 'calls' ? 'calls' : 'messages'} onViewChange={(view) => { setActiveView(view); if (view === 'calls') onLoadCallLogs(); }} onToggleTheme={onToggleTheme} onToast={onToast} onSignOut={onSignOut} />
    {activeView === 'calls' ? <CallLogsPanel logs={callLogs} loading={callLogsLoading} onCall={onCall} onShowMessages={() => setActiveView('messages')} /> : <>
      <ConversationList conversations={conversations} messagesByConversation={messagesByConversation} activeId={activeId} onSelect={selectConversation} query={query} onQueryChange={onQueryChange} filter={filter} onFilterChange={onFilterChange} onToast={onToast} onNewConversation={startConversation} onShowCalls={() => { setActiveView('calls'); onLoadCallLogs(); }} aiSelected={activeView === 'ai'} onOpenAiChat={() => { setActiveView('ai'); setMobilePanel('chat'); }} />
      {activeView === 'ai' ? <AiChatRoom token={accessToken} onToast={onToast} /> : conversation ? <ChatRoom conversation={conversation} messages={messages} detailsOpen={detailsOpen} draft={draft} onDraftChange={onDraftChange} onTyping={onTyping} typingName={typingName} onSend={onSend} onCall={(kind) => onCall(conversation.id, kind)} onToggleDetails={onToggleDetails} onToast={onToast} onBackToList={() => setMobilePanel('list')} onShowCalls={() => { setActiveView('calls'); onLoadCallLogs(); }} /> : <EmptyConversation onNewConversation={startConversation} />}
      {activeView === 'messages' && detailsOpen && conversation && <DetailsPanel key={conversation.id} conversation={conversation} token={accessToken} onClose={onToggleDetails} onCall={(kind) => onCall(conversation.id, kind)} onToast={onToast} />}
    </>}
    {call && <CallOverlay call={call} onAccept={onAcceptCall} onReject={onRejectCall} onHangUp={onHangUp} onToggleMute={onToggleMute} onToggleCamera={onToggleCamera} />}
    {newConversationOpen && accessToken && <NewConversationDialog token={accessToken} onClose={() => setNewConversationOpen(false)} onCreate={createConversation} />}
    <Toast message={toast} />
  </div>;
}

function EmptyConversation({ onNewConversation }: { onNewConversation: () => void }) {
  return <main className="chat-main empty-chat-main"><div className="empty-chat-card"><div className="empty-chat-mark"><Icon name="chat" size={24} /></div><span className="workspace-label">MESSAGES</span><h2>No chat selected.</h2><p>Choose a conversation from the list, or start a new one with a teammate.</p><button className="primary-button" onClick={onNewConversation}><Icon name="plus" size={16} /> Start a conversation</button></div></main>;
}
