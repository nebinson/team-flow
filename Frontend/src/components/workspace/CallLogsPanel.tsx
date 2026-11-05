/** Recent audio and video call activity for the signed-in workspace member. */

import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import type { ApiCallLog, CallKind } from '../../api/calls';

type Props = {
  logs: ApiCallLog[];
  loading: boolean;
  onCall: (conversationId: string, kind: CallKind) => void;
  onShowMessages: () => void;
};

function describeStatus(log: ApiCallLog): string {
  if (log.status === 'missed') return log.direction === 'incoming' ? 'Missed call' : 'No answer';
  if (log.status === 'declined') return 'Declined';
  if (log.status === 'busy') return 'Busy';
  if (log.status === 'cancelled') return 'Cancelled';
  if (log.status === 'ringing') return 'Ringing';
  if (log.status === 'ongoing') return 'In progress';
  return log.duration_seconds == null ? 'Completed' : formatDuration(log.duration_seconds);
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

export function CallLogsPanel({ logs, loading, onCall, onShowMessages }: Props) {
  return <main className="call-logs-view">
    <header className="call-logs-header">
      <button className="icon-button call-logs-back" aria-label="Back to messages" onClick={onShowMessages}><Icon name="chat" size={17} /></button>
      <div><span className="workspace-label">YOUR ACTIVITY</span><h1>Calls</h1><p>Recent voice and video conversations.</p></div>
    </header>
    {loading ? <div className="call-logs-empty"><span className="call-loading-pulse" /><strong>Loading call history</strong><p>Fetching your latest calls…</p></div>
      : logs.length === 0 ? <div className="call-logs-empty"><span className="call-empty-icon"><Icon name="phone" size={21} /></span><strong>No calls yet</strong><p>Voice and video calls with your teammates will appear here.</p></div>
        : <section className="call-log-list" aria-label="Call history">{logs.map((log) => {
          const initials = log.peer.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
          const missed = log.status === 'missed';
          return <article className="call-log-row" key={log.id}>
            <Avatar initials={initials || 'U'} color="blue" />
            <div className="call-log-person"><strong>{log.peer.name}</strong><span className={missed ? 'call-log-status missed' : 'call-log-status'}><Icon name={log.direction === 'incoming' ? 'phoneIncoming' : 'phoneOutgoing'} size={13} />{describeStatus(log)}</span></div>
            <div className="call-log-meta"><span>{log.call_kind === 'video' ? 'Video call' : 'Voice call'}</span><time dateTime={log.started_at}>{new Date(log.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div>
            <button className="icon-button call-back-button" aria-label={`Call ${log.peer.name} back`} title="Call back" onClick={() => onCall(log.conversation_id, log.call_kind)}><Icon name="phone" size={17} /></button>
          </article>;
        })}</section>}
  </main>;
}
