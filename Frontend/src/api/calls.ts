/** Fetches short-lived WebRTC ICE credentials from the authenticated backend. */

import { apiRequest } from './http';
import type { UserSummary } from './messaging';

export type CallKind = 'audio' | 'video';
export type CallSignalType = 'call_offer' | 'call_answer' | 'call_ice' | 'call_reject' | 'call_end' | 'call_busy' | 'call_missed';

export type ApiCallLog = {
  id: string;
  conversation_id: string;
  peer: UserSummary;
  call_kind: CallKind;
  direction: 'incoming' | 'outgoing';
  status: 'ringing' | 'ongoing' | 'completed' | 'missed' | 'declined' | 'busy' | 'cancelled';
  started_at: string;
  connected_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
};

export type CallSignal = {
  type: CallSignalType;
  conversation_id: string;
  to_user_id: string;
  call_id: string;
  call_kind?: CallKind;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export const callsApi = {
  getIceServers: (token: string) =>
    apiRequest<{ ice_servers: RTCIceServer[] }>('/api/v1/calls/ice-servers', {}, token),
  listCallLogs: (token: string) =>
    apiRequest<ApiCallLog[]>('/api/v1/calls/logs', {}, token),
};
