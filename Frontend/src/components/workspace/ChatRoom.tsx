/** Active conversation header, message history, sentiment tags, and composer. */

import React, { FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, Message } from '../../types';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { messagingApi } from '../../api/messaging';
import { ApiRequestError } from '../../api/http';

type Props = {
  conversation: Conversation;
  messages: Message[];
  accessToken: string;
  detailsOpen: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (event?: FormEvent) => void;
  onUploadAttachment: (file: File) => Promise<void>;
  onCall: (kind: 'audio' | 'video') => void;
  onToggleDetails: () => void;
  onToast: (message: string) => void;
  onBackToList: () => void;
  onShowCalls: () => void;
  typingName?: string;
  onTyping: (typing: boolean) => void;
};

export function ChatRoom({ conversation, messages, accessToken, detailsOpen, draft, onDraftChange, onSend, onUploadAttachment, onCall, onToggleDetails, onToast, onBackToList, onShowCalls, typingName, onTyping }: Props) {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const recordingRequestRef = useRef(false);
  const mountedRef = useRef(true);
  const recordingStartedAtRef = useRef(0);
  const cursorRef = useRef({ start: 0, end: 0 });
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const cancelPendingAttachment = useCallback(() => setPendingAttachment(null), []);

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

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000);
      setRecordingSeconds(seconds);
      if (seconds >= 120 && recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => () => {
    mountedRef.current = false;
    discardRecordingRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  function sendPendingAttachment() {
    if (!pendingAttachment) return;
    const file = pendingAttachment;
    setPendingAttachment(null);
    void onUploadAttachment(file).catch((uploadError) => {
      onToast(uploadError instanceof Error ? uploadError.message : 'Could not upload that attachment.');
    });
  }

  async function toggleVoiceRecording() {
    const currentRecorder = recorderRef.current;
    if (currentRecorder && currentRecorder.state !== 'inactive') {
      currentRecorder.stop();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onToast('Voice recording is not supported by this browser.');
      return;
    }
    if (recordingRequestRef.current) return;
    recordingRequestRef.current = true;
    let stream: MediaStream | undefined;
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream = mediaStream;
      if (!mountedRef.current) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const supportedType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(mediaStream, supportedType ? { mimeType: supportedType } : undefined);
      recordingChunksRef.current = [];
      recorderRef.current = recorder;
      discardRecordingRef.current = false;
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onerror = () => {
        discardRecordingRef.current = true;
        mediaStream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        onToast('Voice recording failed. Please try again.');
      };
      recorder.onstop = () => {
        mediaStream.getTracks().forEach((track) => track.stop());
        if (discardRecordingRef.current) {
          recordingChunksRef.current = [];
          return;
        }
        setRecording(false);
        const mimeType = recorder.mimeType || recordingChunksRef.current[0]?.type || 'audio/webm';
        const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
        const voiceFile = new File(recordingChunksRef.current, `voice-message.${extension}`, { type: mimeType.split(';')[0] });
        recordingChunksRef.current = [];
        if (voiceFile.size) setPendingAttachment(voiceFile);
      };
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      recorder.start();
      setRecording(true);
    } catch (recordError) {
      stream?.getTracks().forEach((track) => track.stop());
      if (mountedRef.current) onToast(recordError instanceof Error ? recordError.message : 'Could not access the microphone.');
    } finally {
      recordingRequestRef.current = false;
    }
  }

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
      {messages.map((message, index) => <MessageRow key={message.id} message={message} previous={messages[index - 1]} token={accessToken} />)}
      {typingName && <div className="typing-indicator"><span className="typing-dots"><i /><i /><i /></span><span>{typingName} is typing</span></div>}
    </div>
    <form className="composer" onSubmit={send}>
      {recording && <div className="composer-attachment-status recording-status"><i /> Recording voice message · {formatRecordingTime(recordingSeconds)} (2 min max)</div>}
      <input ref={fileInputRef} className="file-picker-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.txt,.csv,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={(event) => { const file = event.target.files?.[0]; if (file) setPendingAttachment(file); event.currentTarget.value = ''; }} />
      <div className="composer-input-row"><textarea ref={composerRef} value={draft} onSelect={(event) => { cursorRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }} onChange={(event) => { cursorRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd }; onDraftChange(event.target.value); onTyping(Boolean(event.target.value.trim())); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`; }} onKeyDown={onKeyDown} placeholder="Write a message…" rows={1} aria-label="Write a message" /><div className="composer-tools"><button type="button" className="icon-button composer-tool" aria-label="Attach an image or document" title="Attach an image or document" disabled={recording || Boolean(pendingAttachment)} onClick={() => fileInputRef.current?.click()}><Icon name="paperclip" size={18} /></button><div className="emoji-picker-anchor" ref={emojiPickerRef}><button type="button" className={`icon-button composer-tool${emojiPickerOpen ? ' composer-tool-active' : ''}`} aria-label="Choose emoji" aria-expanded={emojiPickerOpen} aria-haspopup="dialog" onClick={() => { const textarea = composerRef.current; if (textarea) cursorRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd }; setEmojiPickerOpen((open) => !open); }}><Icon name="smile" size={18} /></button>{emojiPickerOpen && <div className="emoji-picker" role="dialog" aria-label="Choose an emoji">{emojiSections.map((section) => <section className="emoji-picker-section" key={section.label}><h3>{section.label}</h3><div className="emoji-picker-grid">{section.emojis.map((emoji) => <button type="button" key={emoji} aria-label={`Insert ${emoji}`} onMouseDown={(event) => event.preventDefault()} onClick={() => addEmoji(emoji)}>{emoji}</button>)}</div></section>)}</div>}</div><button type="button" className={`icon-button composer-tool${recording ? ' recording-control' : ''}`} aria-label={recording ? 'Stop voice recording' : 'Record a voice message'} title={recording ? 'Stop voice recording' : 'Record a voice message'} disabled={Boolean(pendingAttachment)} onClick={() => void toggleVoiceRecording()}><Icon name="mic" size={18} /></button><button type="submit" className={`send-button ${draft.trim() ? 'send-ready' : ''}`} aria-label="Send message"><Icon name="send" size={17} /></button></div></div>
    {pendingAttachment && <AttachmentSendPreview file={pendingAttachment} onCancel={cancelPendingAttachment} onSend={sendPendingAttachment} />}
    </form>
  </main>;
}

const emojiSections = [
  { label: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '🥹', '😂', '🤣', '😊', '🙂', '😉', '😍', '🥰', '😘', '😎', '🤔', '😅', '😭', '😴', '🤗', '🙃', '😇', '🤩', '😬'] },
  { label: 'Gestures', emojis: ['👋', '🤚', '✋', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👏', '🙌', '🙏', '💪', '🫶'] },
  { label: 'Hearts & symbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '💖', '💯', '✨', '🔥', '🎉', '✅', '⭐', '💡', '🚀', '🎯', '☕', '🌈', '💐', '🥳'] },
];

function MessageRow({ message, previous, token }: { message: Message; previous?: Message; token: string }) {
  const showSender = !message.own && (!previous || previous.sender !== message.sender);
  const color = 'mint';
  const isAttachmentPlaceholder = ['Sent an image', 'Sent a document', 'Voice message'].includes(message.text);
  return <div className={`message-row ${message.own ? 'message-own' : ''}`}>
    {!message.own && <div className="message-avatar-slot">{showSender && <Avatar initials={message.sender.slice(0, 2).toUpperCase()} color={color} size="sm" />}</div>}
    <div className="message-content">
      {showSender && <div className="message-meta"><strong>{message.sender}</strong><time>{message.time}</time></div>}
      <div className={`message-bubble ${message.own ? 'bubble-own' : ''}`}>{message.attachment ? <><MediaAttachment message={message} token={token} />{message.text && !isAttachmentPlaceholder && <p className="attachment-caption">{message.text}</p>}</> : <p>{message.text}</p>}{message.own && <span className={`message-read ${message.read ? 'receipt-read' : ''}`} aria-label={message.read ? 'Read' : 'Sent'}><Icon name="check" size={13} />{message.read && <Icon name="check" size={13} />}</span>}</div>
      {message.sentiment && <span className={`sentiment sentiment-${message.sentiment}`} aria-label={`Sentiment: ${message.sentiment}`}><i />{message.sentiment}</span>}
    </div>
  </div>;
}

function MediaAttachment({ message, token }: { message: Message; token: string }) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const attachment = message.attachment;

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    if (!('IntersectionObserver' in window)) {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px' });
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!attachment || !nearViewport || message.attachmentStatus) return;
    let active = true;
    let objectUrl = '';
    setUrl('');
    setError('');
    void messagingApi.downloadAttachment(token, attachment.download_url).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((downloadError: unknown) => {
      if (!active) return;
      setError(downloadError instanceof ApiRequestError ? `${downloadError.message} (HTTP ${downloadError.status})` : downloadError instanceof Error ? downloadError.message : 'Network request failed.');
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, message.attachmentStatus, message.id, nearViewport, retryCount, token]);

  useEffect(() => {
    if (!imageViewerOpen) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setImageViewerOpen(false);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [imageViewerOpen]);

  if (!attachment) return null;
  const size = formatFileSize(attachment.size);
  if (message.attachmentStatus === 'uploading') return <div className="attachment-loading">Uploading {attachment.file_name}…</div>;
  return <div ref={previewRef} className="attachment-preview">
    {error ? <div className="attachment-download-error"><span>Could not load {attachment.file_name}: {error}</span><button type="button" onClick={() => { setError(''); setRetryCount((count) => count + 1); }}>Retry</button></div> : !url ? <div className="attachment-loading">{nearViewport ? 'Loading attachment…' : `${attachment.file_name} · ${size}`}</div> : message.messageType === 'image'
      ? <><button type="button" className="image-attachment" onClick={() => setImageViewerOpen(true)} aria-label={`Preview ${attachment.file_name}`}><img src={url} alt={attachment.file_name} /><span>{attachment.file_name} · {size}</span></button>{imageViewerOpen && <div className="image-viewer-scrim" role="dialog" aria-modal="true" aria-label={`Image preview: ${attachment.file_name}`} onClick={() => setImageViewerOpen(false)}><button type="button" className="image-viewer-close icon-button" aria-label="Close image preview" onClick={() => setImageViewerOpen(false)}><Icon name="close" size={22} /></button><img src={url} alt={attachment.file_name} onClick={(event) => event.stopPropagation()} /></div>}</>
      : message.messageType === 'voice'
        ? <div className="voice-attachment"><audio controls preload="none" src={url} aria-label="Voice message" /><span>Voice message · {size}</span></div>
        : <a className="document-attachment" href={url} download={attachment.file_name}><span className="document-attachment-icon"><Icon name="paperclip" size={18} /></span><span className="document-attachment-copy"><strong>{attachment.file_name}</strong><small>{size} · Download file</small></span><Icon name="arrow" size={16} /></a>}
  </div>;
}

function AttachmentSendPreview({ file, onCancel, onSend }: { file: File; onCancel: () => void; onSend: () => void }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const isImage = file.type.startsWith('image/');
  const isVoice = file.type.startsWith('audio/');
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCancel();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);
  return <div className="dialog-scrim attachment-review-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="attachment-review-dialog" role="dialog" aria-modal="true" aria-labelledby="attachment-review-title"><header className="attachment-review-header"><div><span className="workspace-label">ATTACHMENT</span><h2 id="attachment-review-title">Review before sending</h2></div><button type="button" className="icon-button" aria-label="Close preview" onClick={onCancel}><Icon name="close" /></button></header><div className="attachment-review-content">{isImage && previewUrl ? <img className="attachment-review-image" src={previewUrl} alt={`Preview of ${file.name}`} /> : isVoice && previewUrl ? <div className="attachment-review-audio"><Icon name="mic" size={24} /><audio controls src={previewUrl} /></div> : <div className="attachment-review-document"><span className="document-attachment-icon"><Icon name="paperclip" size={20} /></span><div><strong>{file.name}</strong><small>{file.type || 'Document'} · {formatFileSize(file.size)}</small></div></div>}<p>{file.name} · {formatFileSize(file.size)}</p></div><footer className="attachment-review-actions"><button type="button" className="text-button" onClick={onCancel}>Cancel</button><button type="button" className="primary-button" onClick={onSend}><Icon name="send" size={15} /> Send</button></footer></section></div>;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRecordingTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatLastSeen(value?: string | null): string {
  if (!value) return 'recently';
  const date = new Date(value);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toDateString() === now.toDateString() ? `today at ${time}` : date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` at ${time}`;
}
