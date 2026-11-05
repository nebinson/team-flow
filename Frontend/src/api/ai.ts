/** AI summary requests for persisted conversations. */

import { apiRequest } from './http';

export type ConversationSummary = {
  summary: string;
  provider: 'NVIDIA NIM' | 'Gemini' | 'Ollama';
  generated_at: string;
  message_count: number;
};

export type AiChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  provider?: 'NVIDIA NIM' | 'Gemini' | 'Ollama' | null;
};

export type AiChat = {
  id: string;
  messages: AiChatMessage[];
};

export const aiApi = {
  summarizeConversation: (token: string, conversationId: string) =>
    apiRequest<ConversationSummary>(
      `/api/v1/ai/conversations/${encodeURIComponent(conversationId)}/summary`,
      { method: 'POST' },
      token,
    ),
  getChat: (token: string) => apiRequest<AiChat>('/api/v1/ai/chat', {}, token),
  sendChatMessage: (token: string, content: string) =>
    apiRequest<AiChatMessage[]>('/api/v1/ai/chat/messages', { method: 'POST', body: JSON.stringify({ content }) }, token),
  restartChat: (token: string) =>
    apiRequest<{ deleted_messages: number }>('/api/v1/ai/chat/restart', { method: 'POST' }, token),
};
