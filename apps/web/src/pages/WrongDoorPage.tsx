import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useHomePath } from '../nav/NavConfigContext';

/**
 * Two-door split: shown when a signed-in account has no home on this door
 * (a teacher/admin who signed in through the public student door).
 *
 * Deliberately no auto-redirect and no link to the other door — the
 * student bundle must not know the staff hostname. The only action is
 * sign-out. The wording assumes the student door because the admin door
 * serves every role and therefore never lands here.
 */
export function WrongDoorPage() {
  const { user, logout } = useAuth();
  const homePath = useHomePath(user?.role);

  if (!user) return <Navigate to="/login" replace />;
  if (homePath) return <Navigate to={homePath} replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900">This sign-in is for students.</h1>
        <p className="text-gray-600">Staff should use the staff portal.</p>
        <p className="text-sm text-gray-500">
          Signed in as <span className="font-medium">{user.email}</span>
        </p>
        <button
          type="button"
          onClick={() => logout()}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
