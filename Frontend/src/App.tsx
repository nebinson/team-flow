/** Owns top-level auth/workspace state and connects screens to the auth API. */

import { FormEvent, useEffect, useRef, useState } from 'react';
import { authApi } from './api/auth';
import type { UserProfile } from './api/auth';
import { ApiRequestError, clearRefreshToken, getRefreshToken, setRefreshToken } from './api/http';
import { conversationFromApi, messageFromApi, messagingApi, type ApiMessage } from './api/messaging';
import { callsApi, type ApiCallLog, type CallSignal } from './api/calls';
import { AuthScreen, VerificationScreen } from './components/auth/AuthScreens';
import { Toast } from './components/Toast';
import { Workspace } from './components/workspace/Workspace';
import { useWebRtcCall } from './hooks/useWebRtcCall';
import { createClientId } from './utils/clientId';
import type { Conversation, Message, Screen, Theme } from './types';

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('teamflow-theme') === 'dark' ? 'dark' : 'light');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [verificationIdentifier, setVerificationIdentifier] = useState('');
  const [verifyPromptOpen, setVerifyPromptOpen] = useState(false);
  const [verificationEmailHint, setVerificationEmailHint] = useState('');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpError, setOtpError] = useState('');
  const [otpStatus, setOtpStatus] = useState<'idle' | 'success'>('idle');
  const [resendSeconds, setResendSeconds] = useState(60);
  const [activeId, setActiveId] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, Message[]>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [draft, setDraft] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [callLogs, setCallLogs] = useState<ApiCallLog[]>([]);
  const [callLogsLoading, setCallLogsLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Keep the bearer token in memory for future protected chat requests; never persist it.
  const [accessToken, setAccessToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [typingByConversation, setTypingByConversation] = useState<Record<string, string>>({});
  const socketRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<number | undefined>(undefined);
  const receivedTypingTimeouts = useRef<Record<string, number>>({});
  const sendingConversationsRef = useRef(new Set<string>());
  const conversationsRef = useRef<Conversation[]>(conversations);
  const activeIdRef = useRef(activeId);
  const callSignalHandlerRef = useRef<(event: Record<string, unknown>) => Promise<void>>(async () => undefined);
  conversationsRef.current = conversations;
  activeIdRef.current = activeId;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('teamflow-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (screen !== 'verify' || resendSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendSeconds((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [screen, resendSeconds]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function notify(message: string) { setToast(message); }
  function toggleTheme() { setTheme((current) => current === 'light' ? 'dark' : 'light'); }

  async function loadCallLogs() {
    if (!accessToken) return;
    setCallLogsLoading(true);
    try {
      setCallLogs(await callsApi.listCallLogs(accessToken));
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : 'Could not load call history.');
    } finally {
      setCallLogsLoading(false);
    }
  }

  function sendCallSignal(signal: CallSignal): boolean {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(signal));
    return true;
  }

  const callController = useWebRtcCall({
    accessToken,
    findConversation: (id) => conversationsRef.current.find((item) => item.id === id),
    sendSignal: sendCallSignal,
    onToast: notify,
  });
  callSignalHandlerRef.current = callController.handleSignal;

  useEffect(() => {
    function onTokenRefreshed(event: Event) {
      const refreshed = (event as CustomEvent<{ accessToken?: string }>).detail?.accessToken;
      if (refreshed) setAccessToken(refreshed);
    }
    function onSessionExpired() {
      callController.hangUp();
      clearRefreshToken();
      setAccessToken('');
      setCurrentUserId('');
      setConversations([]);
      setMessagesByConversation({});
      setActiveId('');
      setScreen('login');
      setAuthError('Your session expired. Please sign in again.');
    }
    window.addEventListener('teamflow:token-refreshed', onTokenRefreshed);
    window.addEventListener('teamflow:auth-expired', onSessionExpired);
    return () => {
      window.removeEventListener('teamflow:token-refreshed', onTokenRefreshed);
      window.removeEventListener('teamflow:auth-expired', onSessionExpired);
    };
  }, []);

function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(520, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.17);
    oscillator.onended = () => void context.close();
  } catch {
    // Browsers may block sound until the user interacts with the page.
  }
}
  async function signInAndEnter(loginIdentifier = identifier) {
    const result = await authApi.login(loginIdentifier, password);
    setRefreshToken(result.refresh_token);
    setAccessToken(result.access_token);
    const profile = await authApi.currentUser(result.access_token);
    setDisplayName(profile.name);
    setUserProfile(profile);
    setCurrentUserId(profile.id);
    const apiConversations = await messagingApi.listConversations(result.access_token);
    const mappedConversations = apiConversations.map((item) => conversationFromApi(item, profile.id));
    setConversations(mappedConversations);
    setMessagesByConversation({});
    setActiveId('');
    setPassword('');
    setScreen('workspace');
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    setIsSubmitting(true);
    if (screen === 'register') {
      try {
        await authApi.register({ first_name: firstName, last_name: lastName, username, email, gender, password });
        setVerificationIdentifier(email);
        setVerificationEmailHint(email);
        setOtp(['', '', '', '', '', '']);
        setOtpError('');
        setOtpStatus('idle');
        setResendSeconds(60);
        setScreen('verify');
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Could not create your account.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    try {
      await signInAndEnter();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'email_unverified') {
        setVerificationIdentifier(identifier);
        setVerificationEmailHint(error.emailHint ?? 'your account email');
        setVerifyPromptOpen(true);
      } else {
        setAuthError(error instanceof Error ? error.message : 'Could not sign in.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateOtpDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    setOtp((current) => current.map((currentDigit, currentIndex) => currentIndex === index ? digit : currentDigit));
    setOtpError('');
    setOtpStatus('idle');
  }

  async function verifyOtp(code: string) {
    if (isSubmitting) return;
    setOtpError('');
    setIsSubmitting(true);
    try {
      await authApi.verifyCode(verificationIdentifier || email, code);
      setOtpStatus('success');
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      try {
        await signInAndEnter(verificationIdentifier || email);
      } catch {
        setScreen('login');
        setAuthError('Email verified. Please sign in to continue.');
      }
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : 'Could not verify that code.');
      setOtpStatus('idle');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resendCode() {
    if (resendSeconds > 0) return;
    setOtpError('');
    setIsSubmitting(true);
    try {
      await authApi.resendCode(verificationIdentifier || email);
      setOtp(['', '', '', '', '', '']);
      setOtpStatus('idle');
      setResendSeconds(60);
      notify('If the account can receive a code, a fresh one is on its way.');
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : 'Could not request another code.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function startLoginVerification() {
    setIsSubmitting(true);
    setAuthError('');
    try {
      await authApi.resendCode(verificationIdentifier || identifier);
      setEmail(verificationEmailHint);
      setOtp(['', '', '', '', '', '']);
      setOtpError('');
      setOtpStatus('idle');
      setResendSeconds(60);
      setVerifyPromptOpen(false);
      setScreen('verify');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not send a verification code.');
      setVerifyPromptOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const conversation = conversations.find((item) => item.id === activeId);
    if (!conversation) return;
    if (!accessToken || sendingConversationsRef.current.has(conversation.id)) return;
    const clientMessageId = createClientId();
    const optimistic: Message = {
      id: `pending:${clientMessageId}`,
      clientId: clientMessageId,
      sender: 'You',
      text,
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      own: true,
      read: false,
    };
    sendingConversationsRef.current.add(conversation.id);
    updateTyping(false, conversation.id);
    setDraft('');
    setMessagesByConversation((current) => ({ ...current, [conversation.id]: [...(current[conversation.id] ?? []), optimistic] }));
    setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, lastMessage: `You: ${text}`, time: optimistic.time } : item));
    void messagingApi.sendMessage(accessToken, conversation.id, text, clientMessageId).then((saved) => {
      const message = messageFromApi(saved, currentUserId);
      setMessagesByConversation((current) => {
        const existing = current[conversation.id] ?? [];
        const optimisticIndex = existing.findIndex((item) => item.clientId === clientMessageId);
        if (optimisticIndex < 0 && existing.some((item) => item.id === message.id)) return current;
        const updated = [...existing];
        if (optimisticIndex >= 0) updated[optimisticIndex] = message;
        else updated.push(message);
        return { ...current, [conversation.id]: updated };
      });
      setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, lastMessage: text, time: message.time } : item));
    }).catch((error: unknown) => {
      setMessagesByConversation((current) => ({ ...current, [conversation.id]: (current[conversation.id] ?? []).filter((item) => item.clientId !== clientMessageId) }));
      setDraft((current) => current || text);
      notify(error instanceof Error ? error.message : 'Message could not be sent.');
    }).finally(() => sendingConversationsRef.current.delete(conversation.id));
  }

  async function uploadAttachment(file: File, conversationId: string) {
    if (!accessToken) throw new Error('Sign in to send an attachment.');
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error('Choose a conversation before uploading an attachment.');
    updateTyping(false, conversation.id);
    const saved = await messagingApi.uploadAttachment(accessToken, conversation.id, file, createClientId());
    const message = messageFromApi(saved, currentUserId);
    setMessagesByConversation((current) => {
      const existing = current[conversation.id] ?? [];
      const optimisticIndex = message.clientId ? existing.findIndex((item) => item.clientId === message.clientId) : -1;
      if (optimisticIndex < 0 && existing.some((item) => item.id === message.id)) return current;
      const updated = [...existing];
      if (optimisticIndex >= 0) updated[optimisticIndex] = message;
      else updated.push(message);
      return { ...current, [conversation.id]: updated };
    });
    setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, lastMessage: `You: ${message.text}`, time: message.time } : item));
  }

  async function createConversation(targetUsername: string) {
    if (!accessToken) throw new Error('Sign in to start a conversation.');
    const response = await messagingApi.createDirectConversation(accessToken, targetUsername);
    const conversation = conversationFromApi(response, currentUserId);
    setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
    setMessagesByConversation((current) => ({ ...current, [conversation.id]: current[conversation.id] ?? [] }));
    setActiveId(conversation.id);
  }

  useEffect(() => {
    if (screen !== 'workspace' || !accessToken || !currentUserId || !activeId) return;
    let active = true;
    void messagingApi.listMessages(accessToken, activeId).then((records) => {
      if (!active) return;
      const fetched = records.map((item) => messageFromApi(item, currentUserId));
      setMessagesByConversation((current) => {
        const combined = new Map<string, Message>();
        [...(current[activeId] ?? []), ...fetched].forEach((item) => {
          const key = item.clientId ? `client:${item.clientId}` : `id:${item.id}`;
          combined.set(key, item);
        });
        return { ...current, [activeId]: [...combined.values()] };
      });
      void messagingApi.markRead(accessToken, activeId).catch(() => undefined);
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Message history could not be loaded.'));
    return () => { active = false; };
  }, [accessToken, activeId, currentUserId, screen]);

  useEffect(() => {
    if (screen !== 'workspace' || !accessToken || !currentUserId) return;
    const socket = messagingApi.connectWorkspace(accessToken, (event) => {
      const type = event.type;
      if (typeof type === 'string' && type.startsWith('call_')) {
        void callSignalHandlerRef.current(event).catch((error: unknown) => {
          callController.hangUp();
          notify(error instanceof Error ? error.message : 'Call signaling failed.');
        });
      } else if (type === 'conversation_changed') {
        void refreshConversations();
      } else if (type === 'friend_request_changed') {
        window.dispatchEvent(new Event('teamflow:people-changed'));
      } else if (type === 'presence') {
        const userId = String(event.user_id ?? '');
        const presence = { userId, online: Boolean(event.online), lastSeenAt: typeof event.last_seen_at === 'string' ? event.last_seen_at : null };
        setConversations((current) => current.map((item) => item.participantId === userId ? { ...item, online: presence.online, lastSeenAt: presence.lastSeenAt } : item));
        window.dispatchEvent(new CustomEvent('teamflow:presence-changed', { detail: presence }));
      } else if (type === 'message') {
        const incoming = event.message as ApiMessage;
        if (!incoming?.id || !incoming.conversation_id) return;
        const message = messageFromApi(incoming, currentUserId);
        setMessagesByConversation((current) => {
          const existing = current[incoming.conversation_id] ?? [];
          const clientMessageId = typeof incoming.client_message_id === 'string' ? incoming.client_message_id : undefined;
          const optimisticIndex = clientMessageId ? existing.findIndex((item) => item.clientId === clientMessageId) : -1;
          if (optimisticIndex < 0 && existing.some((item) => item.id === message.id)) return current;
          const updated = [...existing];
          if (optimisticIndex >= 0) updated[optimisticIndex] = message;
          else updated.push(message);
          return { ...current, [incoming.conversation_id]: updated };
        });
        setConversations((current) => {
          const exists = current.some((item) => item.id === incoming.conversation_id);
          if (!exists) void refreshConversations();
          return current.map((item) => item.id === incoming.conversation_id ? { ...item, lastMessage: `${message.own ? 'You: ' : ''}${incoming.body}`, time: message.time, unread: message.own || item.id === activeIdRef.current ? 0 : (item.unread ?? 0) + 1 } : item);
        });
        if (!message.own) playNotificationSound();
        if (incoming.conversation_id === activeIdRef.current && !message.own) void messagingApi.markRead(accessToken, incoming.conversation_id).catch(() => undefined);
      } else if (type === 'read' && String(event.user_id ?? '') === conversationsRef.current.find((item) => item.id === String(event.conversation_id))?.participantId) {
        const conversationId = String(event.conversation_id);
        setMessagesByConversation((current) => ({ ...current, [conversationId]: (current[conversationId] ?? []).map((item) => item.own ? { ...item, read: true } : item) }));
      } else if (type === 'typing' || type === 'stop_typing') {
        const conversationId = String(event.conversation_id ?? '');
        const userId = String(event.user_id ?? '');
        const person = conversationsRef.current.find((item) => item.id === conversationId && item.participantId === userId);
        if (type === 'typing' && person) {
          setTypingByConversation((current) => ({ ...current, [conversationId]: person.name }));
          window.clearTimeout(receivedTypingTimeouts.current[conversationId]);
          receivedTypingTimeouts.current[conversationId] = window.setTimeout(() => setTypingByConversation((current) => { const next = { ...current }; delete next[conversationId]; return next; }), 3000);
        }
        if (type === 'stop_typing') {
          window.clearTimeout(receivedTypingTimeouts.current[conversationId]);
          setTypingByConversation((current) => { const next = { ...current }; delete next[conversationId]; return next; });
        }
      }
    });
    socketRef.current = socket;
    const sendFocusState = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'ui_focus', focused: document.visibilityState === 'visible' && document.hasFocus() }));
    };
    socket.addEventListener('open', sendFocusState);
    window.addEventListener('focus', sendFocusState);
    window.addEventListener('blur', sendFocusState);
    document.addEventListener('visibilitychange', sendFocusState);
    return () => {
      socket.removeEventListener('open', sendFocusState);
      window.removeEventListener('focus', sendFocusState);
      window.removeEventListener('blur', sendFocusState);
      document.removeEventListener('visibilitychange', sendFocusState);
      socket.close();
      socketRef.current = null;
    };
  }, [screen, accessToken, currentUserId]);

  async function refreshConversations() {
    if (!accessToken || !currentUserId) return;
    const results = await messagingApi.listConversations(accessToken);
    setConversations(results.map((item) => conversationFromApi(item, currentUserId)));
  }

  function updateTyping(typing: boolean, conversationId = activeId) {
    if (!conversationId || socketRef.current?.readyState !== WebSocket.OPEN) return;
    if (typing) {
      socketRef.current.send(JSON.stringify({ type: 'typing', conversation_id: conversationId }));
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = window.setTimeout(() => updateTyping(false, conversationId), 1400);
    } else {
      window.clearTimeout(typingTimeoutRef.current);
      socketRef.current.send(JSON.stringify({ type: 'stop_typing', conversation_id: conversationId }));
    }
  }

  if (screen === 'login' || screen === 'register') {
    return <>
      <AuthScreen mode={screen} onModeChange={(mode) => { setAuthError(''); setVerifyPromptOpen(false); setScreen(mode); }} identifier={identifier} onIdentifierChange={setIdentifier} email={email} onEmailChange={setEmail} username={username} onUsernameChange={setUsername} firstName={firstName} onFirstNameChange={setFirstName} lastName={lastName} onLastNameChange={setLastName} gender={gender} onGenderChange={setGender} password={password} onPasswordChange={setPassword} onSubmit={submitAuth} onVerifyNow={() => void startLoginVerification()} onDismissVerify={() => setVerifyPromptOpen(false)} verifyPromptOpen={verifyPromptOpen} verificationEmailHint={verificationEmailHint} onToggleTheme={toggleTheme} onNotify={notify} theme={theme} error={authError} submitting={isSubmitting} />
      <Toast message={toast} />
    </>;
  }

  if (screen === 'verify') {
    return <>
      <VerificationScreen email={email} digits={otp} error={otpError} resendSeconds={resendSeconds} theme={theme} onToggleTheme={toggleTheme} onBack={() => { setScreen('register'); setOtpError(''); setOtpStatus('idle'); }} onDigitChange={updateOtpDigit} onComplete={(code) => void verifyOtp(code)} status={otpStatus} onResend={resendCode} submitting={isSubmitting} />
      <Toast message={toast} />
    </>;
  }

  return <Workspace theme={theme} currentUserName={displayName} userProfile={userProfile} accessToken={accessToken} onProfileUpdated={(profile) => { setUserProfile(profile); setDisplayName(profile.name); }} onCreateConversation={createConversation} onUploadAttachment={uploadAttachment} onToggleTheme={toggleTheme} onSignOut={() => { callController.hangUp(); const refreshToken = getRefreshToken(); if (refreshToken) void authApi.logout(refreshToken).catch(() => undefined); clearRefreshToken(); setAccessToken(''); setCurrentUserId(''); setUserProfile(null); setConversations([]); setMessagesByConversation({}); setCallLogs([]); setActiveId(''); setScreen('login'); }} onToast={notify} conversations={conversations} messagesByConversation={messagesByConversation} activeId={activeId} onSelectConversation={(id) => { setActiveId(id); setConversations((current) => current.map((item) => item.id === id ? { ...item, unread: 0 } : item)); }} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} draft={draft} onDraftChange={setDraft} onTyping={(typing) => updateTyping(typing)} typingName={typingByConversation[activeId]} onSend={sendMessage} detailsOpen={showDetails} onToggleDetails={() => setShowDetails((open) => !open)} call={callController.call} onCall={(conversationId, kind) => void callController.startCall(conversationId, kind)} onAcceptCall={() => void callController.acceptCall()} onRejectCall={callController.rejectCall} onHangUp={callController.hangUp} onToggleMute={callController.toggleMute} onToggleCamera={callController.toggleCamera} toast={toast} callLogs={callLogs} callLogsLoading={callLogsLoading} onLoadCallLogs={() => void loadCallLogs()} />;
}
