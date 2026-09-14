import { createContext, useContext, type ReactNode } from 'react';
import type { UserRole } from '@ats/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Match this item only on an exact path (dashboard entries). */
  end?: boolean;
}

/**
 * Two-door split: everything the shared shell needs to know about *where
 * the roles live* on this door, injected by the entry point.
 *
 * The student bundle is served from a public hostname, so it must not
 * contain teacher route strings at all — not in the router, not in the
 * sidebar, not in a redirect. Rather than have shared components branch
 * on the door with inline literals, each entry hands the shell a config
 * that only mentions the routes that exist in that bundle. A role with no
 * `homePath` on this door is a wrong-door login (see WrongDoorPage).
 */
export interface NavConfig {
  /** Sidebar entries per role; a role absent here gets an empty sidebar. */
  items: Partial<Record<UserRole, NavItem[]>>;
  /** Post-login landing page per role; absent = this door doesn't serve the role. */
  homePath: Partial<Record<UserRole, string>>;
}

const NavConfigContext = createContext<NavConfig | null>(null);

export function NavConfigProvider({
  config,
  children,
}: {
  config: NavConfig;
  children: ReactNode;
}) {
  return <NavConfigContext.Provider value={config}>{children}</NavConfigContext.Provider>;
}

export function useNavConfig(): NavConfig {
  const ctx = useContext(NavConfigContext);
  if (!ctx) {
    throw new Error('useNavConfig must be used within a NavConfigProvider (see app/AppShell.tsx)');
  }
  return ctx;
}

/** Sidebar items for the given role on this door. */
export function useNavItems(role: UserRole | undefined): NavItem[] {
  const { items } = useNavConfig();
  return (role && items[role]) || [];
}

/**
 * Where `role` lands after login on this door, or `null` if this door
 * does not serve the role. Callers must show the wrong-door screen on
 * `null` instead of navigating — a redirect to a route that isn't in
 * this bundle would fall through the `*` catch-all back to /login and
 * loop forever.
 */
export function useHomePath(role: UserRole | undefined): string | null {
  const { homePath } = useNavConfig();
  return (role && homePath[role]) || null;
}
