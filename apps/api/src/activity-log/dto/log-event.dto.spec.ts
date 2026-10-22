import { ActivityAction, SERVER_ONLY_ACTIONS } from '../activity-action.enum';
import { LogEventSchema } from './log-event.dto';

const at = '2026-10-22T10:00:00.000Z';

describe('LogEventSchema', () => {
  it('accepts ordinary client actions', () => {
    expect(LogEventSchema.safeParse({ action: 'SLIDE_ENTERED', occurredAt: at }).success).toBe(
      true,
    );
  });

  it.each([...SERVER_ONLY_ACTIONS])('rejects the server-only action %s from clients', (action) => {
    expect(LogEventSchema.safeParse({ action, occurredAt: at }).success).toBe(false);
  });

  it('server-only actions are still valid enum members (the API writes them)', () => {
    for (const a of SERVER_ONLY_ACTIONS) expect(Object.values(ActivityAction)).toContain(a);
  });
});
