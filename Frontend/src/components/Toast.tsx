import { Icon } from './Icon';

export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return <div className="toast" role="status"><span className="toast-check"><Icon name="check" size={13} /></span>{message}</div>;
}
