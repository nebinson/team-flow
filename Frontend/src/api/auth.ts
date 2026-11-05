/** Typed client for the backend's email auth and bearer-token endpoints. */

const apiRoot = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const authRoot = `${apiRoot}/api/v1/auth`;

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  created_at: string;
};

export type AccessToken = {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
};

async function request<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${authRoot}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

export const authApi = {
  register: (input: { name: string; email: string; password: string }) =>
    request<{ message: string }>('/register', input),
  resendCode: (email: string) =>
    request<{ message: string }>('/resend-verification', { email }),
  verifyCode: (email: string, code: string) =>
    request<{ message: string }>('/verify-email', { email, code }),
  login: (email: string, password: string) =>
    request<AccessToken>('/login', { email, password }),
  currentUser: (token: string) =>
    request<UserProfile>('/me', undefined, token),
};
