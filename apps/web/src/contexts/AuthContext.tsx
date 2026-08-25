import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '../lib/api';
import { joinStudentRoom, disconnectSocket } from '../lib/socket';
import { initActivitySession, clearActivitySession } from '../lib/activity-log';
import { mediaStreamRegistry } from '../lib/biometrics/mediaStreamRegistry';
import type { UserRole, TwoFactorMethod } from '@ats/shared';
import {
  PERMISSION_SESSION_KEY,
  clearPermittedScreenStream,
} from '../lib/biometrics/permittedStreams';

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  twoFactorMethod: TwoFactorMethod | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthResponse {
  accessToken: string;
  user: User;
  sessionId?: string;
}

interface TwoFactorPendingResponse {
  twoFactorRequired: true;
  challengeId: string;
  method: TwoFactorMethod;
}

function isTwoFactorPending(
  response: AuthResponse | TwoFactorPendingResponse,
): response is TwoFactorPendingResponse {
  return 'twoFactorRequired' in response;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  // Prompt 05: `identifier` may be the user's email OR their teacher-
  // assigned login ID. The backend resolves which by inspecting the
  // value (contains `@` → email lookup; otherwise loginId lookup) and
  // both columns are UNIQUE, so the resolution is deterministic.
  //
  // When the account has 2FA enabled (email or TOTP), a correct password
  // does not finish the login — the backend returns { twoFactorRequired,
  // challengeId, method } instead of a token. `login()` stores the id and
  // method in `pendingChallengeId`/`pendingMethod` and returns without
  // touching localStorage/`user`, so the caller (Login.tsx) should watch
  // `pendingChallengeId` and render a code-entry step (copy branching on
  // `pendingMethod` — no "resend" for TOTP) that calls `verifyTwoFactor`.
  login: (identifier: string, password: string) => Promise<void>;
  pendingChallengeId: string | null;
  pendingMethod: TwoFactorMethod | null;
  verifyTwoFactor: (code: string) => Promise<void>;
  resendTwoFactorCode: () => Promise<void>;
  cancelTwoFactor: () => void;
  register: (email: string, password: string, name: string, role: UserRole) => Promise<void>;
  // Re-fetches the current user from /auth/me and updates context +
  // localStorage. Used after enabling/disabling 2FA (or any other
  // account-setting change) so the rest of the app reflects it without
  // requiring a full reload.
  refreshUser: () => Promise<void>;
  // TOTP enrollment: startTotpSetup mints a secret + QR code (not yet
  // active); confirmTotpSetup proves the user's authenticator app has it,
  // persists it as the active method, and refreshes `user`.
  startTotpSetup: () => Promise<{ secret: string; qrCodeDataUrl: string }>;
  confirmTotpSetup: (code: string) => Promise<void>;
  logout: () => void;
  // Split out of `logout` so a caller that needs to gate the auth
  // transition behind something else (e.g. an exit survey) can stop the
  // webcam/session immediately instead of leaving them running until the
  // gate clears. `logout` itself just calls both back to back.
  stopBiometrics: () => void;
  finishLogout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingChallengeId, setPendingChallengeId] = useState<string | null>(null);
  const [pendingMethod, setPendingMethod] = useState<TwoFactorMethod | null>(null);

  // Load user from token on mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (token && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser) as User;
        setUser(parsedUser);

        // Join socket room for students and ensure activity session exists
        if (parsedUser.role === 'student') {
          joinStudentRoom(parsedUser.id);

          // If no activity session exists in sessionStorage, open a new one
          if (!sessionStorage.getItem('ats_session_id')) {
            api
              .post<{ sessionId: string }>('/activity-log/session/open')
              .then((res) => {
                if (res.sessionId) {
                  initActivitySession(res.sessionId);
                }
              })
              .catch(() => {
                // Non-critical — activity logging will be skipped
              });
          }
        }

        // Validate token by fetching current user
        api
          .get<User>('/auth/me')
          .then((freshUser) => {
            setUser(freshUser);
            localStorage.setItem('user', JSON.stringify(freshUser));
          })
          .catch(() => {
            // Token invalid or server unreachable — clear storage and unblock UI
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setUser(null);
          })
          .finally(() => {
            setIsLoading(false);
          });
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  }, []);

  const applyAuthResponse = useCallback((response: AuthResponse) => {
    localStorage.setItem('token', response.accessToken);
    localStorage.setItem('user', JSON.stringify(response.user));
    setUser(response.user);

    if (response.user.role === 'student') {
      if (response.sessionId) {
        initActivitySession(response.sessionId);
      }
      joinStudentRoom(response.user.id);
    } else {
      // Clear any stale activity session for non-student roles
      clearActivitySession();
    }
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      // Prompt 05: send a single canonical `identifier` field. Backend
      // (`AuthService.login`) decides email-vs-loginId by checking for
      // `@`. The old `requirePasswordChange` / `/change-password`
      // redirect path was removed — students can no longer change their
      // own password, so a temporary-password user simply logs in
      // normally and a teacher resets it via UserManagementPage.
      const response = await api.post<AuthResponse | TwoFactorPendingResponse>('/auth/login', {
        identifier,
        password,
      });

      if (isTwoFactorPending(response)) {
        setPendingChallengeId(response.challengeId);
        setPendingMethod(response.method);
        return;
      }

      applyAuthResponse(response);
    },
    [applyAuthResponse],
  );

  const verifyTwoFactor = useCallback(
    async (code: string) => {
      if (!pendingChallengeId) {
        throw new Error('No pending 2FA challenge');
      }
      const response = await api.post<AuthResponse>('/auth/2fa/verify', {
        challengeId: pendingChallengeId,
        code,
      });
      setPendingChallengeId(null);
      setPendingMethod(null);
      applyAuthResponse(response);
    },
    [pendingChallengeId, applyAuthResponse],
  );

  const resendTwoFactorCode = useCallback(async () => {
    if (!pendingChallengeId) {
      throw new Error('No pending 2FA challenge');
    }
    if (pendingMethod === 'totp') {
      throw new Error('Authenticator app codes cannot be resent');
    }
    await api.post('/auth/2fa/resend', { challengeId: pendingChallengeId });
  }, [pendingChallengeId, pendingMethod]);

  const cancelTwoFactor = useCallback(() => {
    setPendingChallengeId(null);
    setPendingMethod(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const freshUser = await api.get<User>('/auth/me');
    setUser(freshUser);
    localStorage.setItem('user', JSON.stringify(freshUser));
  }, []);

  const startTotpSetup = useCallback(async () => {
    return api.post<{ secret: string; qrCodeDataUrl: string }>('/auth/2fa/totp/setup');
  }, []);

  const confirmTotpSetup = useCallback(
    async (code: string) => {
      await api.post('/auth/2fa/totp/setup/confirm', { code });
      await refreshUser();
    },
    [refreshUser],
  );

  const register = useCallback(
    async (email: string, password: string, name: string, role: UserRole) => {
      await api.post<AuthResponse>('/auth/register', {
        email,
        password,
        name,
        role,
      });
      // Account created — do NOT auto-login; caller navigates to /login
    },
    [],
  );

  // Stop the webcam/session immediately. Callable independently of
  // finishLogout so a UI gate (e.g. the student exit survey in Layout.tsx)
  // can't leave recording running while it waits on the user.
  //
  // Deliberately does NOT call clearActivitySession(): that flips
  // ActivityLogContext's `sessionId` to null, which App.tsx's
  // AuthenticatedLoggingWrapper uses to decide whether to wrap Layout in
  // <LoggingProvider>. Flipping it while Layout must stay mounted (to show
  // the survey) changes the tree shape React sees in that slot, so React
  // unmounts and remounts Layout from scratch — wiping the very
  // `setShowSurvey(true)` this function is called to enable. Session-id
  // cleanup is harmless to defer a few seconds (see finishLogout), so it
  // stays there instead.
  const stopBiometrics = useCallback(() => {
    // Close activity session on the backend (fire-and-forget)
    const sid = sessionStorage.getItem('ats_session_id');
    const token = localStorage.getItem('token');
    if (sid && token) {
      fetch('/api/activity-log/session/close', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Session-Id': sid,
        },
        keepalive: true,
      }).catch(() => {});
    }
    sessionStorage.removeItem(PERMISSION_SESSION_KEY);
    clearPermittedScreenStream();

    // Stop all active webcam/media streams before clearing auth
    // NOTE: keep token in localStorage during cleanup so that async
    // handlers (recorder.onstop → uploadSegment → api.patch) can still
    // read it. Remove it after a short delay (see finishLogout).
    mediaStreamRegistry.stopAll();
    // Signal biometric hooks (e.g. WebGazer) to clean up
    window.dispatchEvent(new CustomEvent('ats:logout'));
  }, []);

  // Complete the auth transition. Assumes stopBiometrics() has already run
  // (either just below, in logout(), or earlier by the caller).
  const finishLogout = useCallback(() => {
    clearActivitySession();
    // Delay token removal so in-flight biometric flushes can still authenticate
    setTimeout(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }, 2000);
    disconnectSocket();
    setUser(null);
  }, []);

  const logout = useCallback(() => {
    stopBiometrics();
    finishLogout();
  }, [stopBiometrics, finishLogout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        pendingChallengeId,
        pendingMethod,
        verifyTwoFactor,
        resendTwoFactorCode,
        cancelTwoFactor,
        register,
        refreshUser,
        startTotpSetup,
        confirmTotpSetup,
        logout,
        stopBiometrics,
        finishLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
