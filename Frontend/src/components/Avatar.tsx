/** Shared initials avatar with optional presence indicator and size variants. */

export function Avatar({ initials, color = 'blue', online = false, size = 'md', imageUrl }: { initials: string; color?: string; online?: boolean; size?: 'sm' | 'md' | 'lg'; imageUrl?: string }) {
  return <span className={`avatar avatar-${color} avatar-${size}${imageUrl ? ' avatar-with-image' : ''}`}>{imageUrl ? <img src={imageUrl} alt="" /> : initials}{online && <i className="presence-dot" />}</span>;
}
