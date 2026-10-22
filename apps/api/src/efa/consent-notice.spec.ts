import * as fs from 'fs';
import * as path from 'path';
import {
  EFA_NOTICE_ACCEPT_LABEL,
  EFA_NOTICE_PARAGRAPHS,
  EFA_NOTICE_TITLE,
  EFA_NOTICE_VERSION,
} from './consent-notice';

const doc = fs.readFileSync(
  path.resolve(__dirname, '../../../../docs/EF_battery_v2/CONSENT_NOTICE.md'),
  'utf8',
);

describe('assessment notice', () => {
  it('the ethics copy and the app text are identical', () => {
    expect(doc).toContain(`\`${EFA_NOTICE_VERSION}\``);
    expect(doc).toContain(`**${EFA_NOTICE_TITLE}**`);
    for (const p of EFA_NOTICE_PARAGRAPHS) expect(doc).toContain(p);
    expect(doc).toContain(EFA_NOTICE_ACCEPT_LABEL);
  });

  it('names no construct (blinding)', () => {
    const all = [EFA_NOTICE_TITLE, ...EFA_NOTICE_PARAGRAPHS, EFA_NOTICE_ACCEPT_LABEL].join(' ');
    expect(all).not.toMatch(/executive|inhibition|working memory|ADEXI|Stroop|Hayling|EF\b/i);
  });
});
