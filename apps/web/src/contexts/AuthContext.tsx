import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '../lib/api';
import { joinStudentRoom, disconnectSocket } from '../lib/socket';
import { initActivitySession, clearActivitySession } from '../lib/activity-log';
import { mediaStreamRegistry } from '../lib/biometrics/mediaStreamRegistry';
import type { UserRole } from '@ats/shared';

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

interface AuthResponse {
  accessToken: string;
  user: User;
  sessionId?: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  // Prompt 05: `identifier` may be the user's email OR their teacher-
  // assigned login ID. The backend resolves which by inspecting the
  // value (contains `@` → email lookup; otherwise loginId lookup) and
  // both columns are UNIQUE, so the resolution is deterministic.
  login: (identifier: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, role: UserRole) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  const login = useCallback(async (identifier: string, password: string) => {
    // Prompt 05: send a single canonical `identifier` field. Backend
    // (`AuthService.login`) decides email-vs-loginId by checking for
    // `@`. The old `requirePasswordChange` / `/change-password`
    // redirect path was removed — students can no longer change their
    // own password, so a temporary-password user simply logs in
    // normally and a teacher resets it via UserManagementPage.
    const response = await api.post<AuthResponse>('/auth/login', {
      identifier,
      password,
    });

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

  const register = useCallback(
    async (email: string, password: string, name: string, role: UserRole) => {
      const response = await api.post<AuthResponse>('/auth/register', {
        email,
        password,
        name,
        role,
      });

      localStorage.setItem('token', response.accessToken);
      localStorage.setItem('user', JSON.stringify(response.user));
      setUser(response.user);

      if (response.user.role === 'student') {
        joinStudentRoom(response.user.id);
      }
    },
    [],
  );

  const logout = useCallback(() => {
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
    clearActivitySession();

    // Stop all active webcam/media streams before clearing auth
    // NOTE: keep token in localStorage during cleanup so that async
    // handlers (recorder.onstop → uploadSegment → api.patch) can still
    // read it. Remove it after a short delay.
    mediaStreamRegistry.stopAll();
    // Signal biometric hooks (e.g. WebGazer) to clean up
    window.dispatchEvent(new CustomEvent('ats:logout'));

    // Delay token removal so in-flight biometric flushes can still authenticate
    setTimeout(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }, 2000);
    disconnectSocket();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
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
