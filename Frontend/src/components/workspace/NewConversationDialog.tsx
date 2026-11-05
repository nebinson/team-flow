/** Search verified teammates and create or reopen a direct conversation. */

import { useEffect, useState } from 'react';
import { messagingApi, type UserSummary } from '../../api/messaging';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';

export function NewConversationDialog({ token, onClose, onCreate }: { token: string; onClose: () => void; onCreate: (username: string) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingUsername, setCreatingUsername] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void messagingApi.searchUsers(token, query.trim()).then(({ users }) => {
        if (current) setResults(users);
      }).catch((requestError: unknown) => {
        if (current) setError(requestError instanceof Error ? requestError.message : 'Could not search teammates.');
      }).finally(() => {
        if (current) setLoading(false);
      });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query, token]);

  async function choose(username: string) {
    setCreatingUsername(username);
    setError('');
    try {
      await onCreate(username);
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not start the conversation.');
    } finally {
      setCreatingUsername('');
    }
  }

  return <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="new-conversation-dialog" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title">
      <header className="dialog-header"><div><span className="workspace-label">TEAM DIRECTORY</span><h2 id="new-conversation-title">Start a conversation</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></header>
      <label className="dialog-search"><Icon name="search" size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or @username" /></label>
      <div className="dialog-results" aria-live="polite">
        {query.trim().length < 2 && <div className="dialog-empty"><span className="dialog-empty-icon"><Icon name="users" /></span><strong>Find someone on your team</strong><span>Type at least two characters to search.</span></div>}
        {loading && <div className="dialog-state">Searching teammates…</div>}
        {!loading && query.trim().length >= 2 && !error && results.length === 0 && <div className="dialog-empty"><span className="dialog-empty-icon"><Icon name="search" /></span><strong>No teammates found</strong><span>Try another name or username.</span></div>}
        {error && <p className="auth-error dialog-error" role="alert">{error}</p>}
        {!loading && results.map((person) => {
          const usernameInitials = person.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
          return <button key={person.id} className="directory-result" disabled={Boolean(creatingUsername)} onClick={() => void choose(person.username)}>
            <Avatar initials={usernameInitials || 'U'} color="lavender" /><span className="directory-person"><strong>{person.name}</strong><small>@{person.username}</small></span><span className="directory-action">{creatingUsername === person.username ? 'Opening…' : 'Message'} <Icon name="chevron" size={15} /></span>
          </button>;
        })}
      </div>
      <footer className="dialog-footer"><span>Only verified workspace members appear here.</span><kbd>ESC</kbd></footer>
    </section>
  </div>;
}
