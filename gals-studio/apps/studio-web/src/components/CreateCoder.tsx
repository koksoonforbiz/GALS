import { useState } from 'react';
import { api } from '../lib/api';

/** Inline "+ coder" control: name + role, creates the coder and hands it back. */
export function CreateCoder({ onCreated }: { onCreated: (c: any) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('trained_rater');
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-slate-300 px-2 py-1 text-xs"
      >
        + coder
      </button>
    );
  return (
    <span className="flex items-center gap-1">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name"
        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
      >
        {['trained_rater', 'tiebreaker', 'teacher', 'expert'].map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <button
        onClick={async () => {
          if (!name) return;
          const c = await api.createCoder(name, role);
          onCreated(c);
          setOpen(false);
          setName('');
        }}
        className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white"
      >
        add
      </button>
    </span>
  );
}
