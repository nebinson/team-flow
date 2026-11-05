/** Typed REST/WebSocket client plus API-to-workspace view-model adapters. */

import { apiBaseUrl, apiRequest } from './http';
import type { Conversation, Message } from '../types';

export type UserSummary = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  name: string;
};

export type ApiMessage = {
  id: string;
  conversation_id: string;
  sender: UserSummary;
  body: string;
  message_type: 'text';
  created_at: string;
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
    role: conversation.type === 'group' ? `${conversation.participants.length} members` : `@${other?.username ?? ''}`,
    online: false,
    time: preview ? formatTime(preview.created_at) : formatTime(conversation.updated_at),
    group: conversation.type === 'group',
    lastMessage: preview ? `${preview.sender.id === currentUserId ? 'You: ' : ''}${preview.body}` : 'Start the conversation',
    messages: [],
  };
}

export function messageFromApi(message: ApiMessage, currentUserId: string): Message {
  return {
    id: message.id,
    sender: message.sender.id === currentUserId ? 'You' : message.sender.name,
    text: message.body,
    time: formatTime(message.created_at),
    own: message.sender.id === currentUserId,
  };
}

export const messagingApi = {
  listConversations: (token: string) =>
    apiRequest<ApiConversation[]>('/api/v1/conversations', {}, token),
  listMessages: (token: string, conversationId: string) =>
    apiRequest<ApiMessage[]>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {}, token),
  sendMessage: (token: string, conversationId: string, body: string) =>
    apiRequest<ApiMessage>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: JSON.stringify({ body }) }, token),
  searchUsers: (token: string, query: string) =>
    apiRequest<{ users: UserSummary[] }>(`/api/v1/users/search?q=${encodeURIComponent(query)}`, {}, token),
  createDirectConversation: (token: string, username: string) =>
    apiRequest<ApiConversation>('/api/v1/conversations/direct', { method: 'POST', body: JSON.stringify({ username }) }, token),
  connectConversation(token: string, conversationId: string, onMessage: (message: ApiMessage) => void) {
    const base = new URL(apiBaseUrl);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${base.host}/api/v1/ws/conversations/${encodeURIComponent(conversationId)}`;
    const socket = new WebSocket(url, ['teamflow', `bearer.${token}`]);
    socket.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as { type?: string; message?: ApiMessage };
        if (incoming.type === 'message' && incoming.message) onMessage(incoming.message);
      } catch {
        // Ignore malformed frames and keep the connection available for valid events.
      }
    };
    return socket;
  },
};
