export type Screen = 'login' | 'register' | 'verify' | 'workspace';
export type Theme = 'light' | 'dark';
export type Message = {
  id: string | number;
  sender: string;
  text: string;
  time: string;
  own?: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative';
  attachment?: string;
};
export type Conversation = {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: string;
  online: boolean;
  time: string;
  unread?: number;
  pinned?: boolean;
  group?: boolean;
  lastMessage?: string;
  messages: Message[];
};
