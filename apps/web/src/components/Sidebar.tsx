import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';
import { useNavItems } from '../nav/NavConfigContext';

const SIDEBAR_STATE_KEY = 'sidebar_state';

type SidebarState = 'expanded' | 'collapsed' | 'hidden';

export function Sidebar() {
  const { user } = useAuth();
  const [sidebarState, setSidebarState] = useState<SidebarState>(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STATE_KEY);
      if (stored === 'hidden' || stored === 'collapsed' || stored === 'expanded') return stored;
      // Migrate from old key
      if (localStorage.getItem('sidebar_collapsed') === 'true') return 'collapsed';
      return 'expanded';
    } catch {
      return 'expanded';
    }
  });

  const collapsed = sidebarState === 'collapsed';
  const hidden = sidebarState === 'hidden';

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STATE_KEY, sidebarState);
    } catch {
      // ignore
    }
  }, [sidebarState]);

  const cycleState = () => {
    setSidebarState((prev) => {
      if (prev === 'expanded') return 'collapsed';
      if (prev === 'collapsed') return 'hidden';
      return 'expanded';
    });
  };

  // Two-door split: items come from the NavConfig the entry injects, so
  // this component carries no route strings of its own.
  const navItems = useNavItems(user?.role);

  // Hidden state: show a thin strip with a show button
  if (hidden) {
    return (
      <aside className="w-6 bg-gray-50 border-r border-gray-200 h-full flex flex-col items-center pt-3 transition-all duration-200">
        <button
          onClick={() => setSidebarState('expanded')}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
          title="Show sidebar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 5l7 7-7 7M5 5l7 7-7 7"
            />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`${collapsed ? 'w-16' : 'w-64'} bg-gray-50 border-r border-gray-200 h-full overflow-y-auto transition-all duration-200 flex flex-col`}
    >
      {/* Toggle button */}
      <div className={`flex ${collapsed ? 'justify-center' : 'justify-end'} px-2 pt-3 pb-1`}>
        <button
          onClick={cycleState}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
          title={collapsed ? 'Hide sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 19l-7-7 7-7M19 19l-7-7 7-7"
              />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 19l-7-7 7-7M19 19l-7-7 7-7"
              />
            </svg>
          )}
        </button>
      </div>

      <nav className={collapsed ? 'px-2 pb-4' : 'px-4 pb-4'}>
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`
                }
              >
                {item.icon}
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
