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
};

export function ConversationList({ conversations, messagesByConversation, activeId, onSelect, query, onQueryChange, filter, onFilterChange, onToast }: Props) {
  const visible = conversations.filter((item) => {
    const lastMessage = (messagesByConversation[item.id] ?? item.messages).at(-1);
    const matchesQuery = `${item.name} ${lastMessage?.text ?? ''}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (filter === 'all' || Boolean(item.unread));
  });

  return <aside className="conversation-sidebar">
    <div className="sidebar-heading"><div><span className="workspace-label">YOUR WORKSPACE</span><h1>Messages <span className="heading-caret"><Icon name="chevron" size={15} /></span></h1></div><button className="icon-button create-button" aria-label="Start a new conversation" onClick={() => onToast('Choose a teammate to start a conversation.')}><Icon name="plus" size={18} /></button></div>
    <label className="search-box"><Icon name="search" size={17} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search messages" /><kbd>⌘ K</kbd></label>
    <div className="filter-tabs"><button className={filter === 'all' ? 'filter-active' : ''} onClick={() => onFilterChange('all')}>All <span>12</span></button><button className={filter === 'unread' ? 'filter-active' : ''} onClick={() => onFilterChange('unread')}>Unread</button><button className="filter-more" aria-label="More filters" onClick={() => onToast('More filters will be available soon.')}><Icon name="more" size={18} /></button></div>
    <div className="conversation-list">
      {visible.map((conversation) => {
        const lastMessage = (messagesByConversation[conversation.id] ?? conversation.messages).at(-1);
        return <button key={conversation.id} className={`conversation-row ${activeId === conversation.id ? 'conversation-selected' : ''}`} onClick={() => onSelect(conversation.id)}>
          <Avatar initials={conversation.initials} color={conversation.color} online={conversation.online} />
          <span className="conversation-copy"><span className="conversation-name-row"><strong>{conversation.name}</strong><time>{conversation.time}</time></span><span className="conversation-snippet">{lastMessage?.own && <b>You: </b>}{lastMessage?.text}</span></span>
          {conversation.unread && <span className="unread-count">{conversation.unread}</span>}
        </button>;
      })}
      {visible.length === 0 && <div className="empty-search"><span className="empty-search-icon"><Icon name="search" /></span><strong>No conversations found</strong><span>Try another name or keyword.</span></div>}
    </div>
    <div className="sidebar-bottom"><div className="online-indicator"><span /> 12 teammates online</div><button className="sidebar-invite" onClick={() => onToast('Invite links will be available soon.')}><span className="invite-plus"><Icon name="plus" size={14} /></span> Invite teammates</button></div>
  </aside>;
}
