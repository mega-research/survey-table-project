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
      culprit: '<anonymous>',
      issueId: '1117540176',
      eventId: 'e4874d664c3540c1a32eab185f12c5ab',
      issueUrl: 'https://sentry.io/issues/1117540176/',
      alertRule: 'New issue alert',
    });

    expect(message).toEqual({
      body: '[Sentry:error] ReferenceError: heck is not defined',
      connectColor: '#E5484D',
      connectInfo: [
        { title: 'Rule', description: 'New issue alert' },
        { title: 'Type', description: 'ReferenceError' },
        { title: 'Project', description: 'survey-table-project' },
        { title: 'Level', description: 'error' },
        { title: 'Environment', description: 'production' },
        { title: 'Release', description: '2026-06-25' },
        { title: 'Culprit', description: '<anonymous>' },
        { title: 'Issue ID', description: '1117540176' },
        { title: 'Event ID', description: 'e4874d664c3540c1a32eab185f12c5ab' },
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
