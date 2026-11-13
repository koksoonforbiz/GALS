import { useState, type ReactNode } from 'react';
import { Laptop } from 'lucide-react';
import { blockedDevice, currentDeviceSignals } from '../../lib/device';

/**
 * Student door only: phones and tablets see this instead of the app — before
 * login, logging or any recording starts. Decided once on load.
 */
export function DeviceGate({ children }: { children: ReactNode }) {
  const [blocked] = useState(() => blockedDevice(currentDeviceSignals()));
  if (!blocked) return <>{children}</>;
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gray-50 p-6"
      data-testid="device-gate"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg">
        <Laptop className="mx-auto h-10 w-10 text-blue-600" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold text-gray-900">Please use a laptop or desktop</h1>
        <p className="mt-2 text-sm text-gray-600">
          GALS works only on a laptop or desktop computer, not on a{' '}
          {blocked === 'phone' ? 'phone' : 'tablet'}. Open{' '}
          <span className="font-medium text-gray-900">{window.location.host}</span> in Chrome or
          Edge on your computer.
        </p>
      </div>
    </div>
  );
}
