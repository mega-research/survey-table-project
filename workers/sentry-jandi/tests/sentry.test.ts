import { describe, expect, test } from 'vitest';

import { extractSentryAlertSummary } from '../src/sentry';

describe('extractSentryAlertSummary', () => {
  test('extracts details from issue alert event payloads', () => {
    const summary = extractSentryAlertSummary({
      action: 'triggered',
      data: {
        event: {
          event_id: 'e4874d664c3540c1a32eab185f12c5ab',
          issue_id: '1117540176',
          issue_url: 'https://sentry.io/api/0/issues/1117540176/',
          web_url: 'https://sentry.io/organizations/acme/issues/1117540176/events/e4874d/',
          level: 'error',
          metadata: {
            type: 'ReferenceError',
            value: 'Sentry JANDI test 2026-07-03T02:46:45.830Z',
          },
          project: 'test-survey-project',
          environment: 'production',
          release: 'survey-table-project@2026.07.03',
          culprit: '<anonymous>',
        },
        triggered_rule: 'New issue alert',
      },
    });

    expect(summary).toEqual({
      title: 'ReferenceError: Sentry JANDI test 2026-07-03T02:46:45.830Z',
      errorType: 'ReferenceError',
      level: 'error',
      project: 'test-survey-project',
      environment: 'production',
      release: 'survey-table-project@2026.07.03',
      culprit: '<anonymous>',
      issueId: '1117540176',
      issueUrl: 'https://sentry.io/organizations/acme/issues/1117540176/events/e4874d/',
      eventId: 'e4874d664c3540c1a32eab185f12c5ab',
      alertRule: 'New issue alert',
    });
  });

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
