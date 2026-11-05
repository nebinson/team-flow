/** Workspace switcher, primary navigation, theme control, and profile menu. */

import { useState } from 'react';
import { Avatar } from '../Avatar';
import { Brand } from '../Brand';
import { Icon } from '../Icon';
import type { Theme } from '../../types';

export function SidebarRail({ theme, currentUserName, onToggleTheme, onToast, onSignOut }: { theme: Theme; currentUserName: string; onToggleTheme: () => void; onToast: (message: string) => void; onSignOut: () => void }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const initials = currentUserName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
  return <aside className="side-rail">
    <div className="rail-brand"><Brand compact /></div>
    <button className="workspace-switch" aria-label="TeamFlow workspace" onClick={() => onToast('Workspace switching will be available soon.')}><span className="workspace-monogram">T</span><span className="workspace-chevron"><Icon name="chevron" size={14} /></span></button>
    <nav className="rail-nav" aria-label="Main navigation">
      <button className="rail-nav-item active" aria-label="Messages"><Icon name="chat" size={20} /><span className="rail-tooltip">Messages</span><i className="rail-active-mark" /></button>
      <button className="rail-nav-item" aria-label="Saved messages" onClick={() => onToast('Saved messages will appear here.')}><Icon name="bookmark" size={20} /><span className="rail-tooltip">Saved</span></button>
      <button className="rail-nav-item" aria-label="People" onClick={() => onToast('Your workspace directory is coming together.')}><Icon name="users" size={20} /><span className="rail-tooltip">People</span></button>
    </nav>
    <div className="rail-bottom">
      <button className="rail-nav-item" aria-label="Toggle theme" onClick={onToggleTheme}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={19} /><span className="rail-tooltip">{theme === 'light' ? 'Dark theme' : 'Light theme'}</span></button>
      <button className="profile-trigger" aria-label="Open profile menu" onClick={() => setProfileOpen((open) => !open)}><Avatar initials={initials} color="blue" size="sm" /><i className="profile-online" /></button>
    </div>
    {profileOpen && <div className="profile-menu"><div className="profile-menu-user"><Avatar initials={initials} color="blue" /><div><strong>{currentUserName}</strong><span>Available</span></div></div><button onClick={() => onToast('Profile settings are coming soon.')}><Icon name="info" size={16} /> Profile & preferences</button><button onClick={() => { setProfileOpen(false); onSignOut(); }}><Icon name="logout" size={16} /> Sign out</button></div>}
  </aside>;
}
