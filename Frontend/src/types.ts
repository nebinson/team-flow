export type Screen = 'login' | 'register' | 'verify' | 'workspace';
export type Theme = 'light' | 'dark';
export type Message = {
  id: string | number;
  clientId?: string;
  sender: string;
  text: string;
  time: string;
  own?: boolean;
  read?: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative';
  messageType?: 'text' | 'image' | 'document' | 'voice';
  attachment?: {
    file_name: string;
    content_type: string;
    size: number;
    download_url: string;
  };
};
export type Conversation = {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: string;
  online: boolean;
  lastSeenAt?: string | null;
  participantId?: string;
  time: string;
  unread?: number;
  pinned?: boolean;
  group?: boolean;
  lastMessage?: string;
  messages: Message[];
};
