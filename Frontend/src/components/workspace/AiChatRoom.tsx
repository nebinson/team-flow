/** Private, persisted AI conversation with a deliberate history reset action. */

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { aiApi, type AiChatMessage } from '../../api/ai';
import { Icon } from '../Icon';

export function AiChatRoom({ token, onToast }: { token: string; onToast: (message: string) => void }) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void aiApi.getChat(token).then((chat) => {
      if (active) setMessages(chat.messages);
    }).catch((requestError: unknown) => {
      if (!active) return;
      const message = requestError instanceof Error ? requestError.message : 'Could not load AI chat.';
      setError(message);
      onToastRef.current(message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || sending || loading || error) return;
    setSending(true);
    try {
      const turn = await aiApi.sendChatMessage(token, content);
      setMessages((current) => [...current, ...turn]);
      setDraft('');
      if (composerRef.current) composerRef.current.style.height = 'auto';
    } catch (requestError) {
      onToastRef.current(requestError instanceof Error ? requestError.message : 'AI could not answer right now.');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  async function restart() {
    if (!window.confirm('Restart this AI conversation? This permanently erases its saved messages and context.')) return;
    try {
      await aiApi.restartChat(token);
      setMessages([]);
      setDraft('');
      setError('');
      if (composerRef.current) composerRef.current.style.height = 'auto';
      onToastRef.current('AI conversation restarted. Its previous context has been erased.');
    } catch (requestError) {
      onToastRef.current(requestError instanceof Error ? requestError.message : 'Could not restart AI chat.');
    }
  }

  return <main className="chat-main ai-chat-main">
    <header className="chat-header ai-chat-header">
      <div className="chat-heading"><span className="ai-chat-avatar"><Icon name="sparkles" size={20} /></span><div><h2>TeamFlow AI</h2><span>Your personal AI assistant</span></div></div>
      <button className="ai-restart-button" type="button" aria-label="Restart conversation and erase saved context" onClick={() => void restart()} disabled={loading || sending} title="Erase saved messages and restart with a clean context"><Icon name="refresh" size={16} /><span>Restart conversation</span></button>
    </header>
    <div className="chat-body ai-chat-body" role="log" aria-live="polite" aria-label="AI conversation">
      {loading && <div className="ai-chat-state">Loading your AI conversation…</div>}
      {!loading && error && <div className="ai-chat-state"><strong>Couldn’t load AI chat</strong><span>{error}</span><button className="text-button" onClick={() => window.location.reload()}>Reload TeamFlow</button></div>}
      {!loading && !error && messages.length === 0 && <div className="ai-chat-welcome"><span className="ai-welcome-mark"><Icon name="sparkles" size={24} /></span><h3>What can I help you with?</h3><p>Ask for help drafting a message, planning a task, or thinking through a work question.</p><small>Messages are saved to your account and sent to the configured AI provider for replies. Restart erases your saved TeamFlow history and context.</small></div>}
      {!loading && !error && messages.map((message) => <article key={message.id} className={`ai-chat-message${message.role === 'user' ? ' ai-chat-message-user' : ''}`}>
        <div className="ai-message-meta"><strong>{message.role === 'user' ? 'You' : 'TeamFlow AI'}</strong><time>{new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>
        <div className="ai-message-bubble">{message.role === 'assistant'
          ? <div className="ai-message-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{message.content}</ReactMarkdown></div>
          : <p>{message.content}</p>}
        </div>
        {message.provider && <small className="ai-message-provider">Answered with {message.provider}</small>}
      </article>)}
      {sending && <div className="ai-chat-thinking"><span className="typing-dots"><i /><i /><i /></span><span>TeamFlow AI is thinking…</span></div>}
      <div ref={bottomRef} />
    </div>
    <form className="composer ai-composer" onSubmit={(event) => void send(event)}>
      <div className="ai-composer-row"><textarea ref={composerRef} value={draft} maxLength={4000} disabled={loading || Boolean(error)} onChange={(event) => { setDraft(event.target.value); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`; }} onKeyDown={onKeyDown} placeholder={error ? 'AI chat is unavailable' : 'Message TeamFlow AI…'} rows={1} aria-label="Message TeamFlow AI" /><button type="submit" className={`send-button ${draft.trim() && !sending ? 'send-ready' : ''}`} disabled={!draft.trim() || sending || loading || Boolean(error)} aria-label="Send to TeamFlow AI"><Icon name="send" size={17} /></button></div>
    </form>
  </main>;
}
