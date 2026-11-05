/** Fetches short-lived WebRTC ICE credentials from the authenticated backend. */

import { apiRequest } from './http';

export type CallKind = 'audio' | 'video';
export type CallSignalType = 'call_offer' | 'call_answer' | 'call_ice' | 'call_reject' | 'call_end' | 'call_busy';

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
};
