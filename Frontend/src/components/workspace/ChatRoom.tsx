/** Active conversation header, message history, sentiment tags, and composer. */

import React, { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
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
  onShowCalls: () => void;
  typingName?: string;
  onTyping: (typing: boolean) => void;
};

export function ChatRoom({ conversation, messages, detailsOpen, draft, onDraftChange, onSend, onCall, onToggleDetails, onToast, onBackToList, onShowCalls, typingName, onTyping }: Props) {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef({ start: 0, end: 0 });
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  useEffect(() => {
    const chatBody = chatBodyRef.current;
    if (!chatBody) return;
    const frame = window.requestAnimationFrame(() => {
      chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, typingName]);

  useEffect(() => {
    if (!emojiPickerOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!emojiPickerRef.current?.contains(event.target as Node)) setEmojiPickerOpen(false);
    }
    function onPickerKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setEmojiPickerOpen(false);
        composerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onPickerKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onPickerKeyDown);
    };
  }, [emojiPickerOpen]);

  function addEmoji(emoji: string) {
    const { start, end } = cursorRef.current;
    const nextDraft = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    const nextCursor = start + emoji.length;
    onDraftChange(nextDraft);
    onTyping(Boolean(nextDraft.trim()));
    cursorRef.current = { start: nextCursor, end: nextCursor };
    setEmojiPickerOpen(false);
    window.requestAnimationFrame(() => {
      const textarea = composerRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
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
      <div className="chat-actions"><button className="icon-button header-action mobile-call-history" aria-label="Call history" onClick={onShowCalls}><Icon name="phoneIncoming" /></button><button className="icon-button header-action" aria-label="Start voice call" onClick={() => onCall('audio')}><Icon name="phone" /></button><button className="icon-button header-action" aria-label="Start video call" onClick={() => onCall('video')}><Icon name="video" /></button><span className="action-divider" /><button className={`icon-button header-action ${detailsOpen ? 'action-active' : ''}`} aria-label="Conversation details" onClick={onToggleDetails}><Icon name="info" /></button></div>
    </header>
    <div ref={chatBodyRef} className="chat-body">
      {messages.map((message, index) => <MessageRow key={message.id} message={message} previous={messages[index - 1]} />)}
      {typingName && <div className="typing-indicator"><span className="typing-dots"><i /><i /><i /></span><span>{typingName} is typing</span></div>}
    </div>
    <form className="composer" onSubmit={send}>
      <div className="composer-input-row"><textarea ref={composerRef} value={draft} onSelect={(event) => { cursorRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }} onChange={(event) => { cursorRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd }; onDraftChange(event.target.value); onTyping(Boolean(event.target.value.trim())); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`; }} onKeyDown={onKeyDown} placeholder="Write a message…" rows={1} aria-label="Write a message" /><div className="composer-tools"><button type="button" className="icon-button composer-tool" aria-label="Attach a file" onClick={() => onToast('File sharing will be available soon.')}><Icon name="paperclip" size={18} /></button><div className="emoji-picker-anchor" ref={emojiPickerRef}><button type="button" className={`icon-button composer-tool${emojiPickerOpen ? ' composer-tool-active' : ''}`} aria-label="Choose emoji" aria-expanded={emojiPickerOpen} aria-haspopup="dialog" onClick={() => { const textarea = composerRef.current; if (textarea) cursorRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd }; setEmojiPickerOpen((open) => !open); }}><Icon name="smile" size={18} /></button>{emojiPickerOpen && <div className="emoji-picker" role="dialog" aria-label="Choose an emoji">{emojiSections.map((section) => <section className="emoji-picker-section" key={section.label}><h3>{section.label}</h3><div className="emoji-picker-grid">{section.emojis.map((emoji) => <button type="button" key={emoji} aria-label={`Insert ${emoji}`} onMouseDown={(event) => event.preventDefault()} onClick={() => addEmoji(emoji)}>{emoji}</button>)}</div></section>)}</div>}</div><button type="button" className="icon-button composer-tool" aria-label="Voice message" onClick={() => onToast('Voice messages are coming soon.')}><Icon name="mic" size={18} /></button><button type="submit" className={`send-button ${draft.trim() ? 'send-ready' : ''}`} aria-label="Send message"><Icon name="send" size={17} /></button></div></div>
    </form>
  </main>;
}

const emojiSections = [
  { label: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '🥹', '😂', '🤣', '😊', '🙂', '😉', '😍', '🥰', '😘', '😎', '🤔', '😅', '😭', '😴', '🤗', '🙃', '😇', '🤩', '😬'] },
  { label: 'Gestures', emojis: ['👋', '🤚', '✋', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👏', '🙌', '🙏', '💪', '🫶'] },
  { label: 'Hearts & symbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '💖', '💯', '✨', '🔥', '🎉', '✅', '⭐', '💡', '🚀', '🎯', '☕', '🌈', '💐', '🥳'] },
];

function MessageRow({ message, previous }: { message: Message; previous?: Message }) {
  const showSender = !message.own && (!previous || previous.sender !== message.sender);
  const color = 'mint';
  return <div className={`message-row ${message.own ? 'message-own' : ''}`}>
    {!message.own && <div className="message-avatar-slot">{showSender && <Avatar initials={message.sender.slice(0, 2).toUpperCase()} color={color} size="sm" />}</div>}
    <div className="message-content">
      {showSender && <div className="message-meta"><strong>{message.sender}</strong><time>{message.time}</time></div>}
      <div className={`message-bubble ${message.own ? 'bubble-own' : ''}`}><p>{message.text}</p>{message.own && <span className={`message-read ${message.read ? 'receipt-read' : ''}`} aria-label={message.read ? 'Read' : 'Sent'}><Icon name="check" size={13} />{message.read && <Icon name="check" size={13} />}</span>}</div>
      {message.sentiment && <span className={`sentiment sentiment-${message.sentiment}`} aria-label={`Sentiment: ${message.sentiment}`}><i />{message.sentiment}</span>}
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
