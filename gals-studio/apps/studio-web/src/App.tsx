import { NavLink, Outlet } from 'react-router-dom';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded text-sm font-medium ${isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'}`;

export function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight">GALS Studio</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              OFFLINE
            </span>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink to="/" className={linkCls} end>
              Library
            </NavLink>
            <NavLink to="/codebook" className={linkCls}>
              Codebook
            </NavLink>
            <NavLink to="/analysis" className={linkCls}>
              Analysis
            </NavLink>
            <NavLink to="/analysis-studio" className={linkCls}>
              Cohort
            </NavLink>
            <NavLink to="/llm-coding" className={linkCls}>
              LLM Coding
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
