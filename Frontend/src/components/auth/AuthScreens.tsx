import React, { FormEvent, KeyboardEvent, useRef } from 'react';
import { Avatar } from '../Avatar';
import { Brand } from '../Brand';
import { Icon } from '../Icon';
import type { Theme } from '../../types';

type AuthMode = 'login' | 'register';
type AuthScreenProps = {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  email: string;
  onEmailChange: (value: string) => void;
  name: string;
  onNameChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPreview: () => void;
  onToggleTheme: () => void;
  onNotify: (message: string) => void;
  theme: Theme;
};

export function AuthScreen({ mode, onModeChange, email, onEmailChange, name, onNameChange, password, onPasswordChange, onSubmit, onPreview, onToggleTheme, onNotify, theme }: AuthScreenProps) {
  return <div className="auth-shell">
    <aside className="auth-story">
      <div className="auth-story-top"><Brand /><button className="theme-button story-theme" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></div>
      <div className="story-content">
        <div className="story-kicker"><span className="kicker-line" /> A calmer way to work together</div>
        <h1>Good work<br />happens <em>together.</em></h1>
        <p>Thoughtful conversations keep great teams moving. Bring your people, plans, and progress into one clear space.</p>
        <div className="preview-stack" aria-hidden="true">
          <div className="preview-chat preview-chat-main"><Avatar initials="AR" color="peach" size="sm" /><div><strong>Ananya Rao</strong><span>The revised layout is ready ✨</span></div><i className="preview-check"><Icon name="check" size={12} /></i></div>
          <div className="preview-chat preview-chat-back"><span className="preview-mini-avatars"><b>A</b><b>K</b><b>R</b></span><div><strong>Design & site team</strong><span>8 people · 3 online</span></div><span className="preview-unread">3</span></div>
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="sparkle sparkle-one">✳</span><span className="sparkle sparkle-two">✦</span>
        </div>
      </div>
      <div className="auth-story-footer"><span>Made for teams who care about the details.</span><span className="footer-dot" /><span>TeamFlow · 2026</span></div>
    </aside>
    <main className="auth-panel">
      <div className="auth-panel-mobile-brand"><Brand /><button className="theme-button" onClick={onToggleTheme} aria-label="Toggle theme"><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></div>
      <section className="auth-card">
        <div className="auth-card-head"><span className="auth-overline">{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</span><h2>{mode === 'login' ? 'Sign in to TeamFlow' : 'Create your account'}</h2><p>{mode === 'login' ? 'Your team is right where you left it.' : 'A better workday starts with a conversation.'}</p></div>
        <form className="auth-form" onSubmit={onSubmit}>
          {mode === 'register' && <label className="field"><span>Your name</span><input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="e.g. Ananya Rao" autoComplete="name" required /></label>}
          <label className="field"><span>Work email</span><input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="you@company.com" autoComplete="email" required /></label>
          <label className="field"><span>Password</span><input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /></label>
          {mode === 'login' && <div className="form-meta"><label className="remember-check"><input type="checkbox" defaultChecked /><span className="fake-checkbox"><Icon name="check" size={11} /></span>Remember me</label><button type="button" className="text-button" onClick={() => onNotify('Ask your workspace admin to reset your password.')}>Forgot password?</button></div>}
          <button className="primary-button auth-submit" type="submit">{mode === 'login' ? 'Sign in' : 'Create account'}<Icon name="arrow" size={16} /></button>
        </form>
        <div className="auth-switch">{mode === 'login' ? 'New to TeamFlow?' : 'Already have an account?'} <button className="text-button" onClick={() => onModeChange(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></div>
        <div className="auth-divider"><span /> or <span /></div>
        <button className="demo-button" onClick={onPreview}><span className="demo-glyph">✦</span>Explore the workspace preview</button>
        <p className="privacy-note">By continuing, you agree to your organization’s communication policies.</p>
      </section>
      <div className="auth-panel-footer"><span>Need a hand?</span><button className="text-button" onClick={() => onNotify('Contact your workspace administrator for help.')}>Contact your workspace admin</button><span className="secure-note"><span className="secure-dot" /> Secure workspace</span></div>
    </main>
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onResend: () => void;
};

export function VerificationScreen({ email, digits, error, resendSeconds, theme, onToggleTheme, onBack, onDigitChange, onSubmit, onResend }: VerificationScreenProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function updateDigit(index: number, value: string) {
    const onlyDigits = value.replace(/\D/g, '');
    if (onlyDigits.length > 1) {
      onlyDigits.slice(0, 6).split('').forEach((digit, slot) => onDigitChange(slot, digit));
      inputRefs.current[Math.min(onlyDigits.length, 6) - 1]?.focus();
      return;
    }
    onDigitChange(index, onlyDigits);
    if (onlyDigits && index < 5) inputRefs.current[index + 1]?.focus();
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
      <form onSubmit={onSubmit} className="otp-form">
        <div className="otp-label-row"><label htmlFor="otp-0">Enter your 6-digit code</label><span>EMAIL CODE</span></div>
        <div className="otp-inputs" role="group" aria-label="6-digit verification code">
          {digits.map((digit, index) => <input key={index} ref={(element) => { inputRefs.current[index] = element; }} id={`otp-${index}`} aria-label={`Code digit ${index + 1}`} className={error ? 'otp-invalid' : ''} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={index === 0 ? 6 : 1} value={digit} onChange={(event) => updateDigit(index, event.target.value)} onKeyDown={(event) => moveFocus(event, index)} />)}
        </div>
        {error ? <p className="otp-error">{error}</p> : <p className="otp-hint">The code expires in 10 minutes. Keep this window open.</p>}
        <button className="primary-button verify-submit" type="submit">Verify email <Icon name="arrow" size={16} /></button>
      </form>
      <div className="resend-row">Didn’t receive it? {resendSeconds > 0 ? <span>Resend in <b>0:{String(resendSeconds).padStart(2, '0')}</b></span> : <button className="text-button" onClick={onResend}>Send a new code</button>}</div>
      <div className="verify-help"><span className="help-icon"><Icon name="info" size={15} /></span><p>Check your spam folder, or make sure <strong>{email || 'your email address'}</strong> is correct.</p></div>
    </main>
    <footer className="verify-footer"><span className="secure-dot" /> Your email stays private and secure</footer>
  </div>;
}
