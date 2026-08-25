import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../lib/api';
import { PERMISSION_SESSION_KEY } from '../lib/biometrics/permittedStreams';

export function Login() {
  // Prompt 05: a single identifier input that accepts either the
  // user's email OR their teacher-assigned login ID. Backend
  // (`AuthService.login`) routes the value to the right `users.*`
  // unique index based on whether it contains an `@`.
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [resendMessage, setResendMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const {
    login,
    user,
    pendingChallengeId,
    pendingMethod,
    verifyTwoFactor,
    resendTwoFactorCode,
    cancelTwoFactor,
  } = useAuth();
  const navigate = useNavigate();

  // Clear the permission gate flag on every visit to the login page so a
  // fresh login always shows the gate, even if a previous session set it.
  useEffect(() => {
    sessionStorage.removeItem(PERMISSION_SESSION_KEY);
  }, []);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      const destination = user.role === 'student' ? '/student' : '/teacher';
      navigate(destination, { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(identifier.trim(), password);
      // If the account has 2FA enabled, `pendingChallengeId` is now set
      // and the code-entry step below renders instead of navigating.
      // Otherwise navigation happens via the useEffect above.
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await verifyTwoFactor(code.trim());
      // Navigation happens via the useEffect above once `user` is set.
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setResendMessage('');
    try {
      await resendTwoFactorCode();
      setResendMessage('A new code has been sent.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend the code');
    }
  };

  const handleBackToPassword = () => {
    setCode('');
    setError('');
    setResendMessage('');
    cancelTwoFactor();
  };

  if (pendingChallengeId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h1 className="text-center text-4xl font-bold tracking-tight text-gray-900">GALS</h1>
            <h2 className="mt-6 text-center text-2xl font-semibold text-gray-700">
              Enter verification code
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              {pendingMethod === 'totp'
                ? 'Enter the 6-digit code from your authenticator app.'
                : 'We emailed a 6-digit code to your account. It expires in 5 minutes.'}
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleVerifyCode}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}
            {resendMessage && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
                {resendMessage}
              </div>
            )}

            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                6-digit code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-center text-lg tracking-widest focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="123456"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading || code.length !== 6}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Verifying...' : 'Verify'}
              </button>
            </div>

            <div className="flex items-center justify-between text-sm">
              {pendingMethod === 'email' ? (
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-blue-600 hover:text-blue-500"
                >
                  Resend code
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={handleBackToPassword}
                className="text-gray-500 hover:text-gray-700"
              >
                Back to sign in
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-4xl font-bold tracking-tight text-gray-900">GALS</h1>
          <p className="mt-2 text-center text-base text-gray-600">Generative AI Learning System</p>
          <h2 className="mt-6 text-center text-2xl font-semibold text-gray-700">
            Sign in to your account
          </h2>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="identifier" className="block text-sm font-medium text-gray-700">
                Email or login ID
              </label>
              <input
                id="identifier"
                name="identifier"
                type="text"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="you@example.com or your login ID"
              />
              <p className="mt-1 text-xs text-gray-500">
                Use the email you registered with, or the login ID your teacher gave you.
              </p>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>

          <div className="text-center">
            <Link to="/register" className="text-blue-600 hover:text-blue-500 text-sm">
              Don&apos;t have an account? Register
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
