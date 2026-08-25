import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../lib/api';
import { useToast } from '../components/Toast';

type EnableStep = 'idle' | 'awaiting-code';
type TotpStep = 'idle' | 'awaiting-code';
type DisableStep = 'idle' | 'awaiting-password';

const METHOD_LABEL: Record<string, string> = {
  email: 'Email code',
  totp: 'Authenticator app',
};

export function AccountSecurityPage() {
  const { user, refreshUser, startTotpSetup, confirmTotpSetup } = useAuth();
  const { toast } = useToast();

  const [enableStep, setEnableStep] = useState<EnableStep>('idle');
  const [enableChallengeId, setEnableChallengeId] = useState<string | null>(null);
  const [enableCode, setEnableCode] = useState('');
  const [enableSubmitting, setEnableSubmitting] = useState(false);
  const [enableError, setEnableError] = useState('');

  const [totpStep, setTotpStep] = useState<TotpStep>('idle');
  const [totpSecret, setTotpSecret] = useState('');
  const [totpQrCodeDataUrl, setTotpQrCodeDataUrl] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpSubmitting, setTotpSubmitting] = useState(false);
  const [totpError, setTotpError] = useState('');

  const [disableStep, setDisableStep] = useState<DisableStep>('idle');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableSubmitting, setDisableSubmitting] = useState(false);
  const [disableError, setDisableError] = useState('');

  if (!user) return null;

  const noFlowInProgress = enableStep === 'idle' && totpStep === 'idle';

  const handleStartEnable = async () => {
    setEnableError('');
    setEnableSubmitting(true);
    try {
      const { challengeId } = await api.post<{ challengeId: string }>('/auth/2fa/enable');
      setEnableChallengeId(challengeId);
      setEnableStep('awaiting-code');
    } catch (err) {
      setEnableError(err instanceof ApiError ? err.message : 'Could not send a code');
    } finally {
      setEnableSubmitting(false);
    }
  };

  const handleConfirmEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enableChallengeId) return;
    setEnableError('');
    setEnableSubmitting(true);
    try {
      await api.post('/auth/2fa/enable/confirm', {
        challengeId: enableChallengeId,
        code: enableCode.trim(),
      });
      await refreshUser();
      toast('success', 'Two-factor authentication is now on (email code).');
      setEnableStep('idle');
      setEnableChallengeId(null);
      setEnableCode('');
    } catch (err) {
      setEnableError(err instanceof ApiError ? err.message : 'Invalid or expired code');
    } finally {
      setEnableSubmitting(false);
    }
  };

  const handleCancelEnable = () => {
    setEnableStep('idle');
    setEnableChallengeId(null);
    setEnableCode('');
    setEnableError('');
  };

  const handleStartTotpSetup = async () => {
    setTotpError('');
    setTotpSubmitting(true);
    try {
      const { secret, qrCodeDataUrl } = await startTotpSetup();
      setTotpSecret(secret);
      setTotpQrCodeDataUrl(qrCodeDataUrl);
      setTotpStep('awaiting-code');
    } catch (err) {
      setTotpError(err instanceof ApiError ? err.message : 'Could not start setup');
    } finally {
      setTotpSubmitting(false);
    }
  };

  const handleConfirmTotpSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setTotpError('');
    setTotpSubmitting(true);
    try {
      await confirmTotpSetup(totpCode.trim());
      toast('success', 'Two-factor authentication is now on (authenticator app).');
      setTotpStep('idle');
      setTotpSecret('');
      setTotpQrCodeDataUrl('');
      setTotpCode('');
    } catch (err) {
      setTotpError(err instanceof ApiError ? err.message : 'Invalid or expired code');
    } finally {
      setTotpSubmitting(false);
    }
  };

  const handleCancelTotpSetup = () => {
    setTotpStep('idle');
    setTotpSecret('');
    setTotpQrCodeDataUrl('');
    setTotpCode('');
    setTotpError('');
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableError('');
    setDisableSubmitting(true);
    try {
      await api.post('/auth/2fa/disable', { password: disablePassword });
      await refreshUser();
      toast('success', 'Two-factor authentication is now off.');
      setDisableStep('idle');
      setDisablePassword('');
    } catch (err) {
      setDisableError(err instanceof ApiError ? err.message : 'Incorrect password');
    } finally {
      setDisableSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-gray-800">Account security</h1>
      <p className="mt-1 text-sm text-gray-500">
        Signed in as {user.email} ({user.role})
      </p>

      <div className="mt-6 bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-800">Two-factor authentication</h2>
            <p className="mt-1 text-sm text-gray-500">
              Adds a second step at login, on top of your password — either a code emailed to you,
              or a code from an authenticator app. Only one method can be active at a time.
            </p>
          </div>
          <span
            className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${
              user.twoFactorMethod ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {user.twoFactorMethod ? METHOD_LABEL[user.twoFactorMethod] : 'Off'}
          </span>
        </div>

        {!user.twoFactorMethod && noFlowInProgress && (
          <div className="mt-4">
            {enableError && (
              <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
                {enableError}
              </div>
            )}
            {totpError && (
              <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
                {totpError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleStartEnable}
                disabled={enableSubmitting}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {enableSubmitting ? 'Sending code...' : 'Enable via email code'}
              </button>
              <button
                onClick={handleStartTotpSetup}
                disabled={totpSubmitting}
                className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {totpSubmitting ? 'Starting setup...' : 'Enable via authenticator app'}
              </button>
            </div>
          </div>
        )}

        {enableStep === 'awaiting-code' && (
          <form onSubmit={handleConfirmEnable} className="mt-4 space-y-3">
            {enableError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
                {enableError}
              </div>
            )}
            <p className="text-sm text-gray-600">
              We emailed a 6-digit code to {user.email}. Enter it below to finish enabling
              two-factor authentication.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={enableCode}
              onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="block w-full max-w-[200px] px-3 py-2 border border-gray-300 rounded-md shadow-sm text-center text-lg tracking-widest focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={enableSubmitting || enableCode.length !== 6}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {enableSubmitting ? 'Confirming...' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={handleCancelEnable}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {totpStep === 'awaiting-code' && (
          <form onSubmit={handleConfirmTotpSetup} className="mt-4 space-y-3">
            {totpError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
                {totpError}
              </div>
            )}
            <p className="text-sm text-gray-600">
              Scan this QR code with your authenticator app (Google Authenticator, Microsoft
              Authenticator, Authy, etc.), then enter the 6-digit code it shows.
            </p>
            {totpQrCodeDataUrl && (
              <img
                src={totpQrCodeDataUrl}
                alt="Scan with your authenticator app"
                className="w-40 h-40 border border-gray-200 rounded-md"
              />
            )}
            <div>
              <p className="text-xs text-gray-500 mb-1">
                Can&apos;t scan it? Enter this key manually:
              </p>
              <code className="block w-fit px-2 py-1 bg-gray-100 rounded text-sm font-mono select-all">
                {totpSecret}
              </code>
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="block w-full max-w-[200px] px-3 py-2 border border-gray-300 rounded-md shadow-sm text-center text-lg tracking-widest focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={totpSubmitting || totpCode.length !== 6}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {totpSubmitting ? 'Confirming...' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={handleCancelTotpSetup}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {user.twoFactorMethod && disableStep === 'idle' && (
          <div className="mt-4">
            <button
              onClick={() => setDisableStep('awaiting-password')}
              className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
            >
              Disable two-factor authentication
            </button>
          </div>
        )}

        {disableStep === 'awaiting-password' && (
          <form onSubmit={handleDisable} className="mt-4 space-y-3">
            {disableError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
                {disableError}
              </div>
            )}
            <p className="text-sm text-gray-600">
              Confirm your password to turn two-factor authentication off.
            </p>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              className="block w-full max-w-xs px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={disableSubmitting}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {disableSubmitting ? 'Disabling...' : 'Disable'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDisableStep('idle');
                  setDisablePassword('');
                  setDisableError('');
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
