/** Typed client for username/email auth, OTP verification, and bearer-token endpoints. */

import { apiRequest } from './http';

export type UserProfile = {
  id: string;
  name: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  email_verified: boolean;
  created_at: string;
};

export type AccessToken = {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
};

export const authApi = {
  register: (input: { first_name: string; last_name: string; username: string; email: string; gender: string; password: string }) =>
    apiRequest<{ message: string }>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  resendCode: (identifier: string) =>
    apiRequest<{ message: string }>('/api/v1/auth/resend-verification', { method: 'POST', body: JSON.stringify({ identifier }) }),
  verifyCode: (identifier: string, code: string) =>
    apiRequest<{ message: string }>('/api/v1/auth/verify-email', { method: 'POST', body: JSON.stringify({ identifier, code }) }),
  login: (identifier: string, password: string) =>
    apiRequest<AccessToken>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) }),
  logout: (refreshToken: string) =>
    apiRequest<void>('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }),
  currentUser: (token: string) =>
    apiRequest<UserProfile>('/api/v1/auth/me', {}, token),
};
