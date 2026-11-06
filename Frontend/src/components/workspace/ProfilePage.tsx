/** Account profile, verified email change, profile photo, and password controls. */

import { useEffect, useState, type FormEvent } from 'react';
import { apiBlob, getRefreshToken } from '../../api/http';
import { authApi, type UserProfile } from '../../api/auth';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';

export function UserAvatar({ profile, token, size = 'sm' }: { profile: UserProfile; token: string; size?: 'sm' | 'md' | 'lg' }) {
  const [imageUrl, setImageUrl] = useState('');
  const initials = profile.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
  useEffect(() => {
    let objectUrl = '';
    let disposed = false;
    if (profile.avatar_url) {
      void apiBlob(profile.avatar_url, token).then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      }).catch(() => setImageUrl(''));
    } else setImageUrl('');
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [profile.avatar_url, profile.created_at, token]);
  return <Avatar initials={initials} color="blue" size={size} imageUrl={imageUrl || undefined} />;
}

export function ProfilePage({ profile, token, onProfileUpdated, onToast }: { profile: UserProfile; token: string; onProfileUpdated: (profile: UserProfile) => void; onToast: (message: string) => void }) {
  const [firstName, setFirstName] = useState(profile.first_name);
  const [lastName, setLastName] = useState(profile.last_name);
  const [username, setUsername] = useState(profile.username);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailStep, setEmailStep] = useState<'address' | 'code'>('address');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const updated = await authApi.updateProfile(token, { first_name: firstName, last_name: lastName, username: username.replace(/^@/, '') });
      onProfileUpdated(updated); onToast('Profile updated.');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not update your profile.'); }
    finally { setSaving(false); }
  }

  async function requestEmail(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const result = await authApi.requestEmailChange(token, email.trim());
      setEmailStep('code'); onToast(result.message);
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not send a verification code.'); }
    finally { setSaving(false); }
  }

  async function verifyEmail(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const updated = await authApi.verifyEmailChange(token, emailCode.trim());
      onProfileUpdated(updated); setEmail(''); setEmailCode(''); setEmailStep('address'); onToast('Email address updated and verified.');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not verify the new email.'); }
    finally { setSaving(false); }
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) { onToast('The new passwords do not match.'); return; }
    setPasswordBusy(true);
    try {
      const result = await authApi.changePassword(token, currentPassword, newPassword, getRefreshToken());
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); onToast(result.message);
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not change your password.'); }
    finally { setPasswordBusy(false); }
  }

  async function changePhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true);
    try { onProfileUpdated(await authApi.uploadAvatar(token, file)); onToast('Profile picture updated.'); }
    catch (error) { onToast(error instanceof Error ? error.message : 'Could not upload your profile picture.'); }
    finally { setPhotoBusy(false); }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try { onProfileUpdated(await authApi.deleteAvatar(token)); onToast('Profile picture removed.'); }
    catch (error) { onToast(error instanceof Error ? error.message : 'Could not remove your profile picture.'); }
    finally { setPhotoBusy(false); }
  }

  return <main className="profile-page">
    <header className="profile-page-header"><span className="workspace-label">ACCOUNT</span><h1>Profile & settings</h1><p>Manage your profile, sign-in email, and password.</p></header>
    <section className="profile-card profile-photo-card"><UserAvatar profile={profile} token={token} size="lg" /><div className="profile-photo-copy"><strong>{profile.name}</strong><span>@{profile.username}</span><small>JPEG, PNG, WebP, or GIF · up to 5 MB</small></div><label className="secondary-button profile-photo-button">{photoBusy ? 'Saving…' : 'Change photo'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={photoBusy} onChange={(event) => { void changePhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>{profile.avatar_url && <button className="text-button" disabled={photoBusy} onClick={() => void removePhoto()}>Remove</button>}</section>
    <section className="profile-card"><div className="profile-card-heading"><div><h2>Personal information</h2><p>Update how teammates see you.</p></div></div><form className="profile-form-grid" onSubmit={(event) => void saveProfile(event)}><label className="profile-field"><span>First name</span><input required maxLength={50} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label><label className="profile-field"><span>Last name</span><input required maxLength={50} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label><label className="profile-field profile-field-wide"><span>Username</span><input required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" value={username} onChange={(event) => setUsername(event.target.value)} /><small>3–24 letters, numbers, or underscores.</small></label><div className="profile-form-actions"><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div></form></section>
    <section className="profile-card"><div className="profile-card-heading"><div><h2>Email address</h2><p>Your email is used to sign in and recover your account.</p></div><span className="profile-verified"><Icon name="check" size={14} /> Verified</span></div><p className="profile-current-email">{profile.email}</p>{emailStep === 'address' ? <form className="profile-inline-form" onSubmit={(event) => void requestEmail(event)}><label className="profile-field"><span>New email address</span><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label><button className="secondary-button" disabled={saving || !email.trim()}>Send verification code</button></form> : <form className="profile-inline-form" onSubmit={(event) => void verifyEmail(event)}><label className="profile-field"><span>Code sent to {email}</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" /></label><button className="primary-button" disabled={saving || emailCode.length !== 6}>{saving ? 'Verifying…' : 'Verify and update'}</button><button type="button" className="text-button" onClick={() => { setEmailStep('address'); setEmailCode(''); }}>Cancel</button></form>}</section>
    <section className="profile-card"><div className="profile-card-heading"><div><h2>Password</h2><p>Use at least 8 characters. Changing it signs out your other devices.</p></div></div><form className="profile-form-grid" onSubmit={(event) => void updatePassword(event)}><label className="profile-field profile-field-wide"><span>Current password</span><input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label className="profile-field"><span>New password</span><input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label className="profile-field"><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label><div className="profile-form-actions"><button className="primary-button" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : 'Update password'}</button></div></form></section>
  </main>;
}
