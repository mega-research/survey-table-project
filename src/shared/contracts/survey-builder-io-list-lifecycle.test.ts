import { describe, expect, it } from 'vitest';

import {
  LIFECYCLE_NOW,
  SURVEY_LIST_LIFECYCLE_CASES,
} from '@tests/fixtures/survey-list-lifecycle-cases';

import { normalizeSurveyStatus, resolveSurveyListLifecycle } from './survey-builder-io';

/**
 * 목록 상태(작성중·진행중·종료) — TS 쪽. SQL 쪽은 같은 표로
 * `tests/integration/survey-list-lifecycle.realdb.test.ts` 가 대조한다.
 */
describe('resolveSurveyListLifecycle', () => {
  it.each(SURVEY_LIST_LIFECYCLE_CASES)('$name → $expected', (c) => {
    expect(
      resolveSurveyListLifecycle(
        { status: normalizeSurveyStatus(c.status), currentVersionId: c.currentVersionId, endDate: c.endDate },
        LIFECYCLE_NOW.getTime(),
      ),
    ).toBe(c.expected);
  });
});
