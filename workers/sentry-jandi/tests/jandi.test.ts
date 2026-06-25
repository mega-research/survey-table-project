import { describe, expect, test } from 'vitest';

import { buildJandiMessage } from '../src/jandi';

describe('buildJandiMessage', () => {
  test('formats a Sentry summary as a JANDI message', () => {
    const message = buildJandiMessage({
      title: 'ReferenceError: heck is not defined',
      errorType: 'ReferenceError',
      level: 'error',
      project: 'survey-table-project',
      environment: 'production',
      release: '2026-06-25',
      issueId: '1117540176',
      issueUrl: 'https://sentry.io/issues/1117540176/',
    });

    expect(message).toEqual({
      body: '[Sentry] ReferenceError: heck is not defined',
      connectColor: '#E5484D',
      connectInfo: [
        { title: 'Project', description: 'survey-table-project' },
        { title: 'Level', description: 'error' },
        { title: 'Environment', description: 'production' },
        { title: 'Release', description: '2026-06-25' },
        { title: 'Issue ID', description: '1117540176' },
        { title: 'Issue', description: '[Open in Sentry](https://sentry.io/issues/1117540176/)' },
      ],
    });
  });

  test('omits empty optional details', () => {
    const message = buildJandiMessage({
      title: 'Sentry issue alert',
    });

    expect(message).toEqual({
      body: '[Sentry] Sentry issue alert',
      connectColor: '#6B7280',
      connectInfo: [],
    });
  });

  test('uses severity colors', () => {
    expect(buildJandiMessage({ title: 'fatal', level: 'fatal' }).connectColor).toBe('#D92D20');
    expect(buildJandiMessage({ title: 'warning', level: 'warning' }).connectColor).toBe('#F59E0B');
    expect(buildJandiMessage({ title: 'info', level: 'info' }).connectColor).toBe('#3B82F6');
  });
});
