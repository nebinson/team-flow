/** TeamFlow logotype mark shared by auth and workspace surfaces. */

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><span className="brand-symbol"><i /><i /><i /><i /></span>{!compact && <span>teamflow</span>}</div>;
}
