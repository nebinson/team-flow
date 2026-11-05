/** Username/email sign-in, profile registration, and six-digit email verification screens. */

import React, { FormEvent, KeyboardEvent, useRef } from 'react';
import { Brand } from '../Brand';
import { Icon } from '../Icon';
import type { Theme } from '../../types';

type AuthMode = 'login' | 'register';
type AuthScreenProps = {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  identifier: string;
  onIdentifierChange: (value: string) => void;
  email: string;
  onEmailChange: (value: string) => void;
  username: string;
  onUsernameChange: (value: string) => void;
  firstName: string;
  onFirstNameChange: (value: string) => void;
  lastName: string;
  onLastNameChange: (value: string) => void;
  gender: string;
  onGenderChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onVerifyNow: () => void;
  onDismissVerify: () => void;
  verifyPromptOpen: boolean;
  verificationEmailHint: string;
  onToggleTheme: () => void;
  onNotify: (message: string) => void;
  theme: Theme;
  error: string;
  submitting: boolean;
};

export function AuthScreen({ mode, onModeChange, identifier, onIdentifierChange, email, onEmailChange, username, onUsernameChange, firstName, onFirstNameChange, lastName, onLastNameChange, gender, onGenderChange, password, onPasswordChange, onSubmit, onVerifyNow, onDismissVerify, verifyPromptOpen, verificationEmailHint, onToggleTheme, onNotify, theme, error, submitting }: AuthScreenProps) {
  return <div className="auth-shell">
    <aside className="auth-story">
      <div className="auth-story-top"><Brand /><button className="theme-button story-theme" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></div>
      <div className="story-content">
        <div className="story-kicker"><span className="kicker-line" /> A calmer way to work together</div>
        <h1>Good work<br />happens <em>together.</em></h1>
        <p>Thoughtful conversations keep great teams moving. Bring your people, plans, and progress into one clear space.</p>
        <div className="auth-visual" aria-hidden="true"><span className="auth-visual-orbit" /><span className="auth-visual-orbit orbit-inner" /><span className="auth-visual-core"><Icon name="chat" size={32} /></span><span className="auth-visual-spark">✦</span></div>
      </div>
      <div className="auth-story-footer"><span>Made for teams who care about the details.</span><span className="footer-dot" /><span>TeamFlow · 2026</span></div>
    </aside>
    <main className="auth-panel">
      <div className="auth-panel-mobile-brand"><Brand /><button className="theme-button" onClick={onToggleTheme} aria-label="Toggle theme"><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></div>
      <section className="auth-card">
        <div className="auth-card-head"><span className="auth-overline">{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</span><h2>{mode === 'login' ? 'Sign in to TeamFlow' : 'Create your account'}</h2><p>{mode === 'login' ? 'Your team is right where you left it.' : 'A better workday starts with a conversation.'}</p></div>
        <form className="auth-form" onSubmit={onSubmit}>
          {mode === 'register' ? <>
            <div className="name-fields">
              <label className="field"><span>First name</span><input value={firstName} onChange={(event) => onFirstNameChange(event.target.value)} placeholder="First name" autoComplete="given-name" required /></label>
              <label className="field"><span>Last name</span><input value={lastName} onChange={(event) => onLastNameChange(event.target.value)} placeholder="Last name" autoComplete="family-name" required /></label>
            </div>
            <label className="field"><span>Username</span><span className="username-input"><b>@</b><input value={username} onChange={(event) => onUsernameChange(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="yourname" autoComplete="username" minLength={3} maxLength={24} required /></span><small>3–24 characters · letters, numbers, and underscores</small></label>
            <label className="field"><span>Work email</span><input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="you@company.com" autoComplete="email" required /></label>
            <label className="field"><span>Gender</span><select value={gender} onChange={(event) => onGenderChange(event.target.value)} required><option value="" disabled>Select an option</option><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="other">Other</option><option value="prefer_not_to_say">Rather not say</option></select></label>
          </> : <label className="field"><span>Username or email</span><input type="text" value={identifier} onChange={(event) => onIdentifierChange(event.target.value)} placeholder="@username or you@company.com" autoComplete="username" required /></label>}
          <label className="field"><span>Password</span><input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /></label>
          {mode === 'login' && <div className="form-meta"><label className="remember-check"><input type="checkbox" defaultChecked /><span className="fake-checkbox"><Icon name="check" size={11} /></span>Remember me</label><button type="button" className="text-button" onClick={() => onNotify('Ask your workspace admin to reset your password.')}>Forgot password?</button></div>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={submitting}>{submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}<Icon name="arrow" size={16} /></button>
        </form>
        <div className="auth-switch">{mode === 'login' ? 'New user?' : 'Already have an account?'} <button className="text-button" onClick={() => onModeChange(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Register now' : 'Sign in'}</button></div>
        <p className="privacy-note">By continuing, you agree to your organization’s communication policies.</p>
      </section>
      <div className="auth-panel-footer"><span>Need a hand?</span><button className="text-button" onClick={() => onNotify('Contact your workspace administrator for help.')}>Contact your workspace admin</button><span className="secure-note"><span className="secure-dot" /> Secure workspace</span></div>
    </main>
    {verifyPromptOpen && <div className="dialog-scrim" role="presentation"><section className="new-conversation-dialog verify-prompt" role="dialog" aria-modal="true" aria-labelledby="verify-prompt-title"><header className="dialog-header"><div><span className="workspace-label">EMAIL VERIFICATION</span><h2 id="verify-prompt-title">Verify your email?</h2></div><button className="icon-button" aria-label="Close" onClick={onDismissVerify}><Icon name="close" /></button></header><p className="verify-prompt-copy">This account still needs email verification. Send a sign-in code to <strong>{verificationEmailHint}</strong>?</p><footer className="dialog-footer"><button className="text-button" onClick={onDismissVerify}>Not now</button><button className="primary-button" onClick={onVerifyNow} disabled={submitting}>{submitting ? 'Sending…' : 'Send code and verify'} <Icon name="arrow" size={15} /></button></footer></section></div>}
  </div>;
}

type VerificationScreenProps = {
  email: string;
  digits: string[];
  error: string;
  resendSeconds: number;
  theme: Theme;
  onToggleTheme: () => void;
  onBack: () => void;
  onDigitChange: (index: number, value: string) => void;
  onComplete: (code: string) => void;
  status: 'idle' | 'success';
  onResend: () => void;
  submitting: boolean;
};

export function VerificationScreen({ email, digits, error, resendSeconds, theme, onToggleTheme, onBack, onDigitChange, onComplete, status, onResend, submitting }: VerificationScreenProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function updateDigit(index: number, value: string) {
    const onlyDigits = value.replace(/\D/g, '');
    if (onlyDigits.length > 1) {
      const pasted = onlyDigits.slice(0, 6).split('');
      pasted.forEach((digit, slot) => onDigitChange(slot, digit));
      inputRefs.current[Math.min(pasted.length, 6) - 1]?.focus();
      if (pasted.length === 6) onComplete(pasted.join(''));
      return;
    }
    onDigitChange(index, onlyDigits);
    if (onlyDigits && index < 5) inputRefs.current[index + 1]?.focus();
    const next = digits.slice();
    next[index] = onlyDigits;
    if (next.every(Boolean)) onComplete(next.join(''));
  }

  function moveFocus(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus();
  }

  return <div className="verify-shell">
    <header className="verify-header"><Brand /><button className="theme-button" onClick={onToggleTheme} aria-label="Toggle theme"><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></header>
    <main className="verify-main">
      <button className="back-link" onClick={onBack}><Icon name="back" size={16} /> Change details</button>
      <div className="verify-emblem"><div className="mail-icon"><span className="mail-flap" /><span className="mail-spark">✦</span></div></div>
      <span className="auth-overline">ONE LAST STEP</span>
      <h1>Check your inbox</h1>
      <p className="verify-copy">We sent a sign-in code to<br /><strong>{email || 'your work email'}</strong></p>
      <div className="otp-form">
        <div className="otp-label-row"><label htmlFor="otp-0">Enter your 6-digit code</label><span>EMAIL CODE</span></div>
        <div className="otp-inputs" role="group" aria-label="6-digit verification code">
          {digits.map((digit, index) => <input key={index} ref={(element) => { inputRefs.current[index] = element; }} id={`otp-${index}`} aria-label={`Code digit ${index + 1}`} className={error ? 'otp-invalid' : status === 'success' ? 'otp-valid' : ''} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={index === 0 ? 6 : 1} value={digit} disabled={submitting || status === 'success'} onChange={(event) => updateDigit(index, event.target.value)} onKeyDown={(event) => moveFocus(event, index)} />)}
        </div>
        {error ? <p className="otp-error">{error}</p> : status === 'success' ? <p className="otp-success">Code accepted. Opening your chats…</p> : <p className="otp-hint">{submitting ? 'Checking your code…' : 'The code expires in 10 minutes. Keep this window open.'}</p>}
      </div>
      <div className="resend-row">Didn’t receive it? {resendSeconds > 0 ? <span>Resend in <b>0:{String(resendSeconds).padStart(2, '0')}</b></span> : <button className="text-button" disabled={submitting} onClick={onResend}>Send a new code</button>}</div>
      <div className="verify-help"><span className="help-icon"><Icon name="info" size={15} /></span><p>Check your spam folder, or make sure <strong>{email || 'your email address'}</strong> is correct.</p></div>
    </main>
    <footer className="verify-footer"><span className="secure-dot" /> Your email stays private and secure</footer>
  </div>;
}
