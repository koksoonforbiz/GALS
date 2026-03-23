import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useActivityLog } from './ActivityLogContext';

/**
 * Drop this hook in your root layout component (once).
 * It listens for React Router navigation events and logs page views.
 */
export function usePageViewTracker() {
  const location = useLocation();
  const { track } = useActivityLog();

  useEffect(() => {
    // Parse courseId / moduleItemId from the URL if your routes include them
    const parts = location.pathname.split('/').filter(Boolean);

    const courseIdx = parts.indexOf('courses');
    const courseId = courseIdx !== -1 ? parts[courseIdx + 1] : undefined;

    const itemIdx = parts.indexOf('items');
    const moduleItemId = itemIdx !== -1 ? parts[itemIdx + 1] : undefined;

    const moduleIdx = parts.indexOf('modules');
    const moduleId = moduleIdx !== -1 ? parts[moduleIdx + 1] : undefined;

    track('MODULE_ITEM_VIEWED', {
      courseId,
      moduleId,
      moduleItemId,
      metadata: {
        path: location.pathname,
        search: location.search,
        summary: `Viewed: ${location.pathname}`,
      },
    });
  }, [location.pathname, track]);
}
