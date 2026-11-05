/** Searchable conversation list with all/unread filters. */

import type { Conversation, Message } from '../../types';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';

type Props = {
  conversations: Conversation[];
  messagesByConversation: Record<string, Message[]>;
  activeId: string;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  filter: 'all' | 'unread';
  onFilterChange: (filter: 'all' | 'unread') => void;
  onToast: (message: string) => void;
  onNewConversation: () => void;
  onShowCalls: () => void;
  aiSelected: boolean;
  onOpenAiChat: () => void;
};

export function ConversationList({ conversations, messagesByConversation, activeId, onSelect, query, onQueryChange, filter, onFilterChange, onToast, onNewConversation, onShowCalls, aiSelected, onOpenAiChat }: Props) {
  const visible = conversations.filter((item) => {
    const lastMessage = (messagesByConversation[item.id] ?? item.messages).at(-1);
    const matchesQuery = `${item.name} ${item.lastMessage ?? lastMessage?.text ?? ''}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (filter === 'all' || Boolean(item.unread));
  });

  return <aside className="conversation-sidebar">
    <div className="sidebar-heading"><div><span className="workspace-label">YOUR WORKSPACE</span><h1>Messages <span className="heading-caret"><Icon name="chevron" size={15} /></span></h1></div><div className="sidebar-heading-actions"><button className="icon-button create-button mobile-call-history" aria-label="Call history" onClick={onShowCalls}><Icon name="phoneIncoming" size={17} /></button><button className="icon-button create-button" aria-label="Start a new conversation" onClick={onNewConversation}><Icon name="plus" size={18} /></button></div></div>
    <label className="search-box"><Icon name="search" size={17} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search messages" /><kbd>⌘ K</kbd></label>
    <div className="filter-tabs"><button className={filter === 'all' ? 'filter-active' : ''} onClick={() => onFilterChange('all')}>All</button><button className={filter === 'unread' ? 'filter-active' : ''} onClick={() => onFilterChange('unread')}>Unread</button><button className="filter-more" aria-label="More filters" onClick={() => onToast('More filters will be available soon.')}><Icon name="more" size={18} /></button></div>
    <div className="conversation-list">
      <button className={`ai-conversation-row${aiSelected ? ' ai-conversation-selected' : ''}`} onClick={onOpenAiChat} aria-current={aiSelected ? 'page' : undefined}>
        <span className="ai-conversation-icon"><Icon name="sparkles" size={17} /></span><span className="conversation-copy"><strong>TeamFlow AI</strong><small>Ask your AI assistant</small></span><Icon name="chevron" size={15} />
      </button>
      {visible.map((conversation) => {
        const lastMessage = (messagesByConversation[conversation.id] ?? conversation.messages).at(-1);
        return <button key={conversation.id} className={`conversation-row ${activeId === conversation.id ? 'conversation-selected' : ''}`} onClick={() => onSelect(conversation.id)}>
          <Avatar initials={conversation.initials} color={conversation.color} online={conversation.online} />
          <span className="conversation-copy"><span className="conversation-name-row"><strong>{conversation.name}</strong><time>{conversation.time}</time></span><span className="conversation-snippet">{itemPreview(conversation.lastMessage, lastMessage?.own, lastMessage?.text)}</span></span>
          {conversation.unread && <span className="unread-count">{conversation.unread}</span>}
        </button>;
      })}
      {visible.length === 0 && <div className="empty-search"><span className="empty-search-icon"><Icon name={query ? 'search' : 'chat'} /></span><strong>{query ? 'No conversations found' : 'No conversations yet'}</strong><span>{query ? 'Try another name or keyword.' : 'Start with someone on your team.'}</span>{!query && <button className="text-button" onClick={onNewConversation}>Start a conversation</button>}</div>}
    </div>
  </aside>;
}

function itemPreview(preview: string | undefined, own: boolean | undefined, text: string | undefined) {
  if (preview) return preview;
  return <>{own && <b>You: </b>}{text ?? 'Start the conversation'}</>;
}
