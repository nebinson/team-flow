/** Active conversation header, message history, sentiment tags, and composer. */

import React, { FormEvent, KeyboardEvent, useRef } from 'react';
import type { Conversation, Message } from '../../types';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';

type Props = {
  conversation: Conversation;
  messages: Message[];
  detailsOpen: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (event?: FormEvent) => void;
  onCall: (kind: 'audio' | 'video') => void;
  onToggleDetails: () => void;
  onToast: (message: string) => void;
  onBackToList: () => void;
  typingName?: string;
  onTyping: (typing: boolean) => void;
};

export function ChatRoom({ conversation, messages, detailsOpen, draft, onDraftChange, onSend, onCall, onToggleDetails, onToast, onBackToList, typingName, onTyping }: Props) {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onTyping(false);
      onSend();
      if (composerRef.current) composerRef.current.style.height = 'auto';
    }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    onTyping(false);
    onSend(event);
    if (composerRef.current) composerRef.current.style.height = 'auto';
  }

  return <main className="chat-main">
    <header className="chat-header">
      <div className="chat-heading"><button className="mobile-back icon-button" aria-label="Back to conversations" onClick={onBackToList}><Icon name="back" size={19} /></button><Avatar initials={conversation.initials} color={conversation.color} online={conversation.online} /><div><h2>{conversation.name}</h2><span>{conversation.online ? <><i className="tiny-presence" /> Online now</> : conversation.lastSeenAt ? `Last seen ${formatLastSeen(conversation.lastSeenAt)}` : 'Offline'}</span></div></div>
      <div className="chat-actions"><button className="icon-button header-action" aria-label="Start voice call" onClick={() => onCall('audio')}><Icon name="phone" /></button><button className="icon-button header-action" aria-label="Start video call" onClick={() => onCall('video')}><Icon name="video" /></button><span className="action-divider" /><button className={`icon-button header-action ${detailsOpen ? 'action-active' : ''}`} aria-label="Conversation details" onClick={onToggleDetails}><Icon name="info" /></button></div>
    </header>
    <div className="chat-body">
      {messages.map((message, index) => <MessageRow key={message.id} message={message} previous={messages[index - 1]} />)}
      {typingName && <div className="typing-indicator"><span className="typing-dots"><i /><i /><i /></span><span>{typingName} is typing</span></div>}
    </div>
    <form className="composer" onSubmit={send}>
      <div className="composer-topline"><span className="composer-context"><Icon name="chat" size={14} /> Message {conversation.group ? 'the team' : conversation.name.split(' ')[0]}</span><span className="composer-shortcut"><kbd>↵</kbd> to send · <kbd>⇧ ↵</kbd> for new line</span></div>
      <div className="composer-input-row"><textarea ref={composerRef} value={draft} onChange={(event) => { onDraftChange(event.target.value); onTyping(Boolean(event.target.value.trim())); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`; }} onKeyDown={onKeyDown} placeholder="Write a message…" rows={1} aria-label="Write a message" /><div className="composer-tools"><button type="button" className="icon-button composer-tool" aria-label="Attach a file" onClick={() => onToast('File sharing will be available soon.')}><Icon name="paperclip" size={18} /></button><button type="button" className="icon-button composer-tool" aria-label="Add emoji" onClick={() => onDraftChange(`${draft} ✨`)}><Icon name="smile" size={18} /></button><button type="button" className="icon-button composer-tool" aria-label="Voice message" onClick={() => onToast('Voice messages are coming soon.')}><Icon name="mic" size={18} /></button><button type="submit" className={`send-button ${draft.trim() ? 'send-ready' : ''}`} aria-label="Send message"><Icon name="send" size={17} /></button></div></div>
    </form>
  </main>;
}

function MessageRow({ message, previous }: { message: Message; previous?: Message }) {
  const showSender = !message.own && (!previous || previous.sender !== message.sender);
  const color = 'mint';
  return <div className={`message-row ${message.own ? 'message-own' : ''}`}>
    {!message.own && <div className="message-avatar-slot">{showSender && <Avatar initials={message.sender.slice(0, 2).toUpperCase()} color={color} size="sm" />}</div>}
    <div className="message-content">
      {showSender && <div className="message-meta"><strong>{message.sender}</strong><time>{message.time}</time></div>}
      <div className={`message-bubble ${message.own ? 'bubble-own' : ''}`}><p>{message.text}</p>{message.own && <span className={`message-read ${message.read ? 'receipt-read' : ''}`} aria-label={message.read ? 'Read' : 'Sent'}><Icon name="check" size={13} />{message.read && <Icon name="check" size={13} />}</span>}</div>
      {!message.own && message.sentiment && <span className={`sentiment sentiment-${message.sentiment}`}><i />{message.sentiment}</span>}
    </div>
  </div>;
}

function formatLastSeen(value?: string | null): string {
  if (!value) return 'recently';
  const date = new Date(value);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toDateString() === now.toDateString() ? `today at ${time}` : date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` at ${time}`;
}
