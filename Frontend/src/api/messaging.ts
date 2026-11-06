/** Typed REST/WebSocket client plus API-to-workspace view-model adapters. */

import { apiBaseUrl, apiBlob, apiRequest } from './http';
import type { Conversation, Message } from '../types';

export type UserSummary = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  name: string;
  online: boolean;
  last_seen_at: string | null;
};

export type ApiMessage = {
  id: string;
  conversation_id: string;
  sender: UserSummary;
  body: string;
  message_type: 'text' | 'image' | 'document' | 'voice';
  created_at: string;
  read: boolean;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  client_message_id?: string | null;
  attachment?: {
    file_name: string;
    content_type: string;
    size: number;
    download_url: string;
  } | null;
};

export type ApiConversation = {
  id: string;
  type: 'direct' | 'group';
  participants: UserSummary[];
  last_message: { body: string; sender: UserSummary; created_at: string } | null;
  created_at: string;
  updated_at: string;
};

function formatTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function colorForId(id: string): string {
  const colors = ['lavender', 'peach', 'mint', 'blue', 'rose'];
  const code = id.split('').reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return colors[code % colors.length];
}

export function conversationFromApi(conversation: ApiConversation, currentUserId: string): Conversation {
  const other = conversation.participants.find((person) => person.id !== currentUserId) ?? conversation.participants[0];
  const name = conversation.type === 'group' ? 'Group conversation' : other?.name ?? 'New conversation';
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'TC';
  const preview = conversation.last_message;
  return {
    id: conversation.id,
    name,
    initials,
    color: colorForId(other?.id ?? conversation.id),
    role: conversation.type === 'group' ? `${conversation.participants.length} members` : (other?.username ? `@${other.username}` : ''),
    online: other?.online ?? false,
    participantId: other?.id,
    lastSeenAt: other?.last_seen_at,
    time: preview ? formatTime(preview.created_at) : formatTime(conversation.updated_at),
    group: conversation.type === 'group',
    lastMessage: preview ? `${preview.sender.id === currentUserId ? 'You: ' : ''}${preview.body}` : 'Start the conversation',
    messages: [],
  };
}

export function messageFromApi(message: ApiMessage, currentUserId: string): Message {
  return {
    id: message.id,
    clientId: message.client_message_id ?? undefined,
    messageType: message.message_type ?? 'text',
    attachment: message.attachment ?? undefined,
    sender: message.sender.id === currentUserId ? 'You' : message.sender.name,
    text: message.body,
    time: formatTime(message.created_at),
    own: message.sender.id === currentUserId,
    read: message.read,
    sentiment: message.sentiment ?? undefined,
  };
}

export const messagingApi = {
  listConversations: (token: string) =>
    apiRequest<ApiConversation[]>('/api/v1/conversations', {}, token),
  listMessages: (token: string, conversationId: string) =>
    apiRequest<ApiMessage[]>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {}, token),
  sendMessage: (token: string, conversationId: string, body: string, clientMessageId: string) =>
    apiRequest<ApiMessage>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: JSON.stringify({ body, client_message_id: clientMessageId }) }, token),
  uploadAttachment: (token: string, conversationId: string, file: File, clientMessageId: string) => {
    const data = new FormData();
    data.append('file', file);
    data.append('client_message_id', clientMessageId);
    return apiRequest<ApiMessage>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/attachments`, { method: 'POST', body: data }, token);
  },
  downloadAttachment: (token: string, messageId: string) =>
    apiBlob(`/api/v1/messages/${encodeURIComponent(messageId)}/attachment`, token),
  markRead: (token: string, conversationId: string) =>
    apiRequest<void>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST' }, token),
  searchUsers: (token: string, query: string) =>
    apiRequest<{ users: UserSummary[] }>(`/api/v1/users/search?q=${encodeURIComponent(query)}`, {}, token),
  createDirectConversation: (token: string, username: string) =>
    apiRequest<ApiConversation>('/api/v1/conversations/direct', { method: 'POST', body: JSON.stringify({ username }) }, token),
  connectWorkspace(token: string, onEvent: (event: Record<string, unknown>) => void) {
    // A relative API base (for example VITE_API_URL=/ behind an Nginx proxy)
    // means the REST API and WebSocket share the page's origin.
    const base = new URL(apiBaseUrl || window.location.origin, window.location.origin);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${base.host}/api/v1/ws`;
    const socket = new WebSocket(url, ['teamflow', `bearer.${token}`]);
    socket.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as Record<string, unknown>;
        onEvent(incoming);
      } catch {
        // Ignore malformed frames and keep the connection available for valid events.
      }
    };
    return socket;
  },
};
