import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { User as UserIcon } from 'lucide-react';

interface HeaderProps {
  onLogoutRequest?: () => void;
}

/** Account menu — a small fixed button in the bottom-left corner that
 *  opens a popover with the user's name/role, Account, and Sign out.
 *  Replaces the old always-a-row-in-the-layout top header (no app title
 *  shown anywhere now); positioned `fixed` so it never takes any layout
 *  space and sits above the sidebar regardless of scroll. */
export function Header({ onLogoutRequest }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const handleLogout = () => {
    setOpen(false);
    if (onLogoutRequest) {
      onLogoutRequest();
    } else {
      logout();
      navigate('/login');
    }
  };

  const roleColor =
    user.role === 'teacher'
      ? 'bg-purple-100 text-purple-800'
      : user.role === 'admin'
        ? 'bg-red-100 text-red-800'
        : 'bg-green-100 text-green-800';

  return (
    <div ref={menuRef} data-replay-region="header" className="fixed bottom-3 left-3 z-50">
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-52 rounded-lg border border-gray-200 bg-white shadow-lg py-1.5 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="text-sm font-medium text-gray-800 truncate">{user.name}</div>
            <span
              className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${roleColor}`}
            >
              {user.role}
            </span>
          </div>
          <Link
            to="/account/security"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Account
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-gray-200 shadow-md text-gray-600 hover:bg-gray-50 transition-colors"
        title={user.name}
        aria-label="Account menu"
        aria-expanded={open}
      >
        <UserIcon size={18} />
      </button>
    </div>
  );
}
