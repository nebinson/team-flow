/** AI summary requests for persisted conversations. */

import { apiRequest } from './http';

export type ConversationSummary = {
  summary: string;
  provider: 'NVIDIA NIM' | 'Gemini' | 'Ollama';
  generated_at: string;
  message_count: number;
};

export const aiApi = {
  summarizeConversation: (token: string, conversationId: string) =>
    apiRequest<ConversationSummary>(
      `/api/v1/ai/conversations/${encodeURIComponent(conversationId)}/summary`,
      { method: 'POST' },
      token,
    ),
};
