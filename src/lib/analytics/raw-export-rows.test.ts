import { describe, expect, it } from 'vitest';

import {
  type NonRespondentTarget,
  buildNonRespondentRow,
  sortRowsForContactPopulation,
} from '@/lib/analytics/raw-export-rows';
import type { RawExportResponseRow } from '@/lib/analytics/raw-workbook';
import { NOT_RESPONDED_STATUS } from '@/lib/operations/profiles';

// 조사 대상 4명(resid 1~4) 중 2·4 만 응답했고 1·3 은 미응답. 익명 응답 2건은 시스템ID 가 없다.
const t1: NonRespondentTarget = { id: 't1', resid: 1, groupValue: 'A', inviteCode: 'c1' };
const t3: NonRespondentTarget = { id: 't3', resid: 3, groupValue: null, inviteCode: 'c3' };

function response(over: Partial<RawExportResponseRow> & Pick<RawExportResponseRow, 'id'>): RawExportResponseRow {
  return {
    questionResponses: { q1: 'opt1' },
    groupValue: null,
    resid: null,
    inviteCode: null,
    ipHash: 'hash',
    currentStepId: null,
    platform: 'desktop',
    browser: 'Chrome',
    status: 'completed',
    startedAt: new Date('2026-09-01T09:00:00Z'),
    completedAt: null,
    totalSeconds: 60,
    ...over,
  };
}

const r1 = response({ id: 'r1', resid: 2, inviteCode: 'c2', startedAt: new Date('2026-09-01T09:00:00Z') });
const r2 = response({
  id: 'r2',
  resid: 4,
  inviteCode: 'c4',
  status: 'in_progress',
  startedAt: new Date('2026-09-01T09:05:00Z'),
});
const r3 = response({ id: 'r3', startedAt: new Date('2026-09-01T09:02:00Z') });
const r4 = response({ id: 'r4', startedAt: new Date('2026-09-01T09:01:00Z') });

describe('buildNonRespondentRow', () => {
  it('조사 대상 값만 채우고 응답 메타는 전부 null, 문항 응답은 빈 객체다', () => {
    const row = buildNonRespondentRow(t1);
    expect(row).toEqual({
      id: 't1',
      questionResponses: {},
      groupValue: 'A',
      resid: 1,
      inviteCode: 'c1',
      ipHash: null,
      currentStepId: null,
      platform: null,
      browser: null,
      status: NOT_RESPONDED_STATUS,
      startedAt: null,
      completedAt: null,
      totalSeconds: null,
    });
  });
});

describe('sortRowsForContactPopulation', () => {
  it('시스템ID 오름차순, 익명 응답은 뒤에 시작일시 오름차순으로 놓는다', () => {
    const nr1 = buildNonRespondentRow(t1);
    const nr3 = buildNonRespondentRow(t3);
    const input = [r1, r2, r3, r4, nr1, nr3];
    const sorted = sortRowsForContactPopulation(input);
    expect(sorted.map((r) => r.id)).toEqual(['t1', 'r1', 't3', 'r2', 'r4', 'r3']);
  });

  it('입력 배열은 건드리지 않는다', () => {
    const input = [r2, r1, buildNonRespondentRow(t1)];
    const snapshot = [...input];
    sortRowsForContactPopulation(input);
    expect(input).toEqual(snapshot);
  });

  it('같은 시스템ID 응답이 여럿이면 시작일시 오름차순이다', () => {
    const later = response({ id: 'later', resid: 2, startedAt: new Date('2026-09-01T10:00:00Z') });
    const earlier = response({ id: 'earlier', resid: 2, startedAt: new Date('2026-09-01T08:00:00Z') });
    const sorted = sortRowsForContactPopulation([later, r1, earlier]);
    expect(sorted.map((r) => r.id)).toEqual(['earlier', 'r1', 'later']);
  });
});
