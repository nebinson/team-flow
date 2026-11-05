/** Owns top-level auth/workspace state and connects screens to the auth API. */

import { FormEvent, useEffect, useState } from 'react';
import { authApi } from './api/auth';
import { AuthScreen, VerificationScreen } from './components/auth/AuthScreens';
import { Toast } from './components/Toast';
import { Workspace } from './components/workspace/Workspace';
import { seedConversations } from './data/conversations';
import type { Message, Screen, Theme } from './types';

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('teamflow-theme') === 'dark' ? 'dark' : 'light');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpError, setOtpError] = useState('');
  const [resendSeconds, setResendSeconds] = useState(60);
  const [activeId, setActiveId] = useState('design');
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, Message[]>>(() => Object.fromEntries(seedConversations.map((item) => [item.id, item.messages])));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [draft, setDraft] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [callKind, setCallKind] = useState<'' | 'audio' | 'video'>('');
  const [toast, setToast] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Keep the bearer token in memory for future protected chat requests; never persist it.
  const [accessToken, setAccessToken] = useState('');
  const [displayName, setDisplayName] = useState('Nebinson N');

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
  function enterWorkspace() { setScreen('workspace'); }

  async function signInAndEnter() {
    const result = await authApi.login(email, password);
    setAccessToken(result.access_token);
    const profile = await authApi.currentUser(result.access_token);
    setDisplayName(profile.name);
    setPassword('');
    enterWorkspace();
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    setIsSubmitting(true);
    if (screen === 'register') {
      try {
        await authApi.register({ name, email, password });
        setOtp(['', '', '', '', '', '']);
        setOtpError('');
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
      setAuthError(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateOtpDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    setOtp((current) => current.map((currentDigit, currentIndex) => currentIndex === index ? digit : currentDigit));
    setOtpError('');
  }

  async function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otp.join('').length !== 6) {
      setOtpError('Enter the 6-digit code from your email.');
      return;
    }
    setOtpError('');
    setIsSubmitting(true);
    try {
      await authApi.verifyCode(email, otp.join(''));
      setOtp(['', '', '', '', '', '']);
      try {
        await signInAndEnter();
      } catch {
        setScreen('login');
        setAuthError('Email verified. Please sign in to continue.');
      }
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : 'Could not verify that code.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resendCode() {
    if (resendSeconds > 0) return;
    setOtpError('');
    setIsSubmitting(true);
    try {
      await authApi.resendCode(email);
      setOtp(['', '', '', '', '', '']);
      setResendSeconds(60);
      notify('If the account can receive a code, a fresh one is on its way.');
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : 'Could not request another code.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const conversation = seedConversations.find((item) => item.id === activeId) ?? seedConversations[0];
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessagesByConversation((current) => ({
      ...current,
      [conversation.id]: [...(current[conversation.id] ?? conversation.messages), { id: Date.now(), sender: 'You', text, time, own: true }],
    }));
    setDraft('');
  }

  if (screen === 'login' || screen === 'register') {
    return <>
      <AuthScreen mode={screen} onModeChange={(mode) => { setAuthError(''); setScreen(mode); }} email={email} onEmailChange={setEmail} name={name} onNameChange={setName} password={password} onPasswordChange={setPassword} onSubmit={submitAuth} onPreview={enterWorkspace} onToggleTheme={toggleTheme} onNotify={notify} theme={theme} error={authError} submitting={isSubmitting} />
      <Toast message={toast} />
    </>;
  }

  if (screen === 'verify') {
    return <>
      <VerificationScreen email={email} digits={otp} error={otpError} resendSeconds={resendSeconds} theme={theme} onToggleTheme={toggleTheme} onBack={() => { setScreen('register'); setOtpError(''); }} onDigitChange={updateOtpDigit} onSubmit={submitOtp} onResend={resendCode} submitting={isSubmitting} />
      <Toast message={toast} />
    </>;
  }

  return <Workspace theme={theme} currentUserName={displayName} onToggleTheme={toggleTheme} onSignOut={() => { setAccessToken(''); setScreen('login'); }} onToast={notify} conversations={seedConversations} messagesByConversation={messagesByConversation} activeId={activeId} onSelectConversation={setActiveId} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} draft={draft} onDraftChange={setDraft} onSend={sendMessage} detailsOpen={showDetails} onToggleDetails={() => setShowDetails((open) => !open)} callKind={callKind} onCall={setCallKind} onCloseCall={() => setCallKind('')} toast={toast} />;
}
