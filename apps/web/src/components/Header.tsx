import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  onLogoutRequest?: () => void;
}

export function Header({ onLogoutRequest }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    if (onLogoutRequest) {
      onLogoutRequest();
    } else {
      logout();
      navigate('/login');
    }
  };

  const roleColor =
    user?.role === 'teacher'
      ? 'bg-purple-100 text-purple-800'
      : user?.role === 'admin'
        ? 'bg-red-100 text-red-800'
        : 'bg-green-100 text-green-800';

  return (
    <header data-replay-region="header" className="bg-white border-b border-gray-200 px-4 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Adaptive Tutoring System</h1>

        {user && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{user.name}</span>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${roleColor}`}>
                {user.role}
              </span>
            </div>
            <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700">
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
