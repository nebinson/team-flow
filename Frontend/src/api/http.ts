/** Shared JSON transport and error decoding for the TeamFlow API modules. */

export const apiBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

export async function apiRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const bodyIsPresent = init.body !== undefined;
  const headers = new Headers(init.headers);
  if (bodyIsPresent && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail;
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(' ')
        : 'TeamFlow could not complete that request. Please try again.';
    throw new Error(message);
  }
  return payload as T;
}
