import { describe, expect, test } from 'vitest';

import { extractSentryAlertSummary } from '../src/sentry';

describe('extractSentryAlertSummary', () => {
  test('uses metadata type and value as the alert title', () => {
    const summary = extractSentryAlertSummary({
      action: 'triggered',
      data: {
        issue_id: '1117540176',
        issue_url: 'https://sentry.io/api/0/issues/1117540176/',
        level: 'error',
        metadata: {
          type: 'ReferenceError',
          value: 'heck is not defined',
        },
        project: 'survey-table-project',
        release: '2026-06-25',
      },
    });

    expect(summary).toEqual({
      title: 'ReferenceError: heck is not defined',
      errorType: 'ReferenceError',
      level: 'error',
      project: 'survey-table-project',
      release: '2026-06-25',
      issueId: '1117540176',
      issueUrl: 'https://sentry.io/api/0/issues/1117540176/',
    });
  });

  test('falls back to action when detailed Sentry fields are missing', () => {
    const summary = extractSentryAlertSummary({ action: 'created' });

    expect(summary).toEqual({
      title: 'created',
    });
  });

  test('uses a stable fallback title for malformed payloads', () => {
    const summary = extractSentryAlertSummary(null);

    expect(summary).toEqual({
      title: 'Sentry issue alert',
    });
  });
});
