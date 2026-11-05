/** Shared initials avatar with optional presence indicator and size variants. */

export function Avatar({ initials, color = 'blue', online = false, size = 'md' }: { initials: string; color?: string; online?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar-${color} avatar-${size}`}>{initials}{online && <i className="presence-dot" />}</span>;
}
