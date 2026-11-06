/** Coworker directory, friend requests, and accepted connections. */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { messagingApi, type FriendRequests, type PersonEntry, type UserSummary } from '../../api/messaging';
import { Avatar } from '../Avatar';
import { Icon, type IconName } from '../Icon';

type PeopleTab = 'friends' | 'discover' | 'requests';

export function PeopleDirectory({ token, onToast, onMessage, onBack }: {
  token: string;
  onToast: (message: string) => void;
  onMessage: (username: string) => Promise<void>;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<PeopleTab>('friends');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<PersonEntry[]>([]);
  const [requests, setRequests] = useState<FriendRequests>({ incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [directory, pending] = await Promise.all([
        messagingApi.listPeople(token, query.trim()),
        messagingApi.listFriendRequests(token),
      ]);
      setPeople(directory.people);
      setRequests(pending);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load people.');
    } finally {
      setLoading(false);
    }
  }, [query, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, query ? 220 : 0);
    function onPeopleChanged() { void reload(); }
    function onPresenceChanged(event: Event) {
      const presence = (event as CustomEvent<{ userId: string; online: boolean; lastSeenAt: string | null }>).detail;
      if (!presence?.userId) return;
      const update = (person: UserSummary) => person.id === presence.userId
        ? { ...person, online: presence.online, last_seen_at: presence.lastSeenAt }
        : person;
      setPeople((current) => current.map((entry) => ({ ...entry, user: update(entry.user) })));
      setRequests((current) => ({
        incoming: current.incoming.map(update),
        outgoing: current.outgoing.map(update),
      }));
    }
    window.addEventListener('teamflow:people-changed', onPeopleChanged);
    window.addEventListener('teamflow:presence-changed', onPresenceChanged);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('teamflow:people-changed', onPeopleChanged);
      window.removeEventListener('teamflow:presence-changed', onPresenceChanged);
    };
  }, [reload, query]);

  async function act(userId: string, action: 'send' | 'accept' | 'remove') {
    setBusyId(userId);
    try {
      if (action === 'send') await messagingApi.sendFriendRequest(token, userId);
      else if (action === 'accept') await messagingApi.acceptFriendRequest(token, userId);
      else await messagingApi.removeFriendRequest(token, userId);
      await reload();
      onToast(action === 'accept' ? 'Friend request accepted.' : action === 'remove' ? 'Friend request removed.' : 'Friend request sent.');
    } catch (requestError) {
      onToast(requestError instanceof Error ? requestError.message : 'Could not update friend request.');
      await reload();
    } finally {
      setBusyId('');
    }
  }

  async function message(person: UserSummary) {
    try {
      await onMessage(person.username);
    } catch (requestError) {
      onToast(requestError instanceof Error ? requestError.message : 'Could not open the conversation.');
    }
  }

  const incomingIds = new Set(requests.incoming.map((person) => person.id));
  const outgoingIds = new Set(requests.outgoing.map((person) => person.id));
  const friends = people.filter((person) => person.relationship === 'friends');
  const discover = people.filter((person) => person.relationship !== 'friends');

  return <main className="people-directory">
    <header className="people-header">
      <button className="people-back-button" type="button" onClick={onBack}><Icon name="back" size={17} /><span>Messages</span></button>
      <span className="workspace-label">YOUR WORKSPACE</span>
      <h1>People</h1>
      <p>Connect with coworkers to start a private conversation.</p>
      <label className="people-search"><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'friends' ? 'Search your friends' : 'Find a coworker by name or username'} aria-label="Search people" /></label>
      <nav className="people-tabs" aria-label="People views">
        <button type="button" className={tab === 'friends' ? 'people-tab-active' : ''} onClick={() => setTab('friends')}>Friends <span>{friends.length}</span></button>
        <button type="button" className={tab === 'discover' ? 'people-tab-active' : ''} onClick={() => setTab('discover')}>Find people</button>
        <button type="button" className={tab === 'requests' ? 'people-tab-active' : ''} onClick={() => setTab('requests')}>Requests{requests.incoming.length > 0 && <span className="people-request-count">{requests.incoming.length}</span>}</button>
      </nav>
    </header>

    <section className="people-results" aria-live="polite">
      {loading && <div className="people-state">Loading people…</div>}
      {!loading && error && <div className="people-state people-error"><strong>Couldn’t load people</strong><span>{error}</span><button type="button" className="text-button" onClick={() => void reload()}>Try again</button></div>}
      {!loading && !error && tab === 'friends' && (friends.length ? <div className="people-grid">{friends.map(({ user }) => <PersonCard key={user.id} user={user} busy={busyId === user.id} action={<button className="people-primary-action" onClick={() => void message(user)}><Icon name="chat" size={15} /> Message</button>} />)}</div> : <EmptyPeople icon="users" title={query ? 'No friends match that search' : 'Your friend list is empty'} copy="Find coworkers and send a request. Once they accept, they’ll appear here." />)}
      {!loading && !error && tab === 'discover' && (discover.length ? <div className="people-grid">{discover.map((person) => <PersonCard key={person.user.id} user={person.user} busy={busyId === person.user.id} action={person.relationship === 'incoming'
        ? <button className="people-primary-action" onClick={() => setTab('requests')}>Review request</button>
        : person.relationship === 'outgoing' || outgoingIds.has(person.user.id)
          ? <button className="people-secondary-action" onClick={() => void act(person.user.id, 'remove')}>Request sent · Cancel</button>
          : incomingIds.has(person.user.id)
            ? <button className="people-primary-action" onClick={() => void act(person.user.id, 'accept')}>Accept request</button>
            : <button className="people-primary-action" onClick={() => void act(person.user.id, 'send')}><Icon name="plus" size={15} /> Add friend</button>} />)}</div> : <EmptyPeople icon="search" title="No coworkers found" copy="Try another name or username." />)}
      {!loading && !error && tab === 'requests' && <div className="people-request-groups">
        <section><div className="people-section-heading"><h2>Received</h2><span>{requests.incoming.length}</span></div>{requests.incoming.length ? <div className="people-grid">{requests.incoming.map((user) => <PersonCard key={user.id} user={user} busy={busyId === user.id} action={<><button className="people-primary-action" onClick={() => void act(user.id, 'accept')}>Accept</button><button className="people-secondary-action" onClick={() => void act(user.id, 'remove')}>Decline</button></>} />)}</div> : <p className="people-empty-inline">No incoming requests.</p>}</section>
        <section><div className="people-section-heading"><h2>Sent</h2><span>{requests.outgoing.length}</span></div>{requests.outgoing.length ? <div className="people-grid">{requests.outgoing.map((user) => <PersonCard key={user.id} user={user} busy={busyId === user.id} action={<button className="people-secondary-action" onClick={() => void act(user.id, 'remove')}>Cancel request</button>} />)}</div> : <p className="people-empty-inline">No pending sent requests.</p>}</section>
      </div>}
    </section>
  </main>;
}

function PersonCard({ user, action, busy }: { user: UserSummary; action: ReactNode; busy: boolean }) {
  const initials = user.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
  return <article className="people-card"><Avatar initials={initials} online={user.online} color="blue" /><div className="people-card-copy"><strong>{user.name}</strong><span>@{user.username}</span><small>{user.online ? 'Online now' : 'Offline'}</small></div><div className="people-card-actions">{busy ? <span className="people-busy">Updating…</span> : action}</div></article>;
}

function EmptyPeople({ icon, title, copy }: { icon: IconName; title: string; copy: string }) {
  return <div className="people-empty"><span><Icon name={icon} size={20} /></span><strong>{title}</strong><p>{copy}</p></div>;
}
