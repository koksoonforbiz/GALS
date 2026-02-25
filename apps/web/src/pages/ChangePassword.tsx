import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface PasswordChangeResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    createdAt: string;
    updatedAt: string;
  };
}

export function ChangePassword() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || localStorage.getItem('passwordChangeToken') || '';

  const checks = {
    length: newPassword.length >= 8,
    uppercase: /[A-Z]/.test(newPassword),
    lowercase: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    match: newPassword === confirmPassword && confirmPassword.length > 0,
  };

  const allValid = checks.length && checks.uppercase && checks.lowercase && checks.number && checks.match;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allValid) return;

    setError('');
    setIsLoading(true);

    try {
      const response = await api.post<PasswordChangeResponse>('/auth/change-password', {
        token,
        newPassword,
      });

      localStorage.removeItem('passwordChangeToken');
      localStorage.setItem('token', response.accessToken);
      localStorage.setItem('user', JSON.stringify(response.user));

      // Force reload to pick up new auth state
      window.location.href = response.user.role === 'student' ? '/student' : '/teacher';
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

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Session Expired</h2>
          <p className="text-gray-600 mb-4">Your password change session has expired. Please log in again.</p>
          <button
            onClick={() => navigate('/login')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-900">Change Your Password</h2>
          <p className="mt-2 text-sm text-gray-600">
            Welcome! You&apos;ve been invited to the Adaptive Tutoring System. Please create a new password to continue.
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>

            {/* Password strength indicators */}
            <div className="space-y-1 text-sm">
              <div className={checks.length ? 'text-green-600' : 'text-gray-400'}>
                {checks.length ? '✓' : '○'} 8+ characters
              </div>
              <div className={checks.uppercase ? 'text-green-600' : 'text-gray-400'}>
                {checks.uppercase ? '✓' : '○'} Uppercase letter
              </div>
              <div className={checks.lowercase ? 'text-green-600' : 'text-gray-400'}>
                {checks.lowercase ? '✓' : '○'} Lowercase letter
              </div>
              <div className={checks.number ? 'text-green-600' : 'text-gray-400'}>
                {checks.number ? '✓' : '○'} Number
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              {confirmPassword && !checks.match && (
                <p className="mt-1 text-sm text-red-500">Passwords do not match</p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={!allValid || isLoading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Setting password...' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
