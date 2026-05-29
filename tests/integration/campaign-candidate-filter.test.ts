import { describe, expect, it, beforeEach, vi } from 'vitest';
import { extractRawSql } from './_helpers/result-code-mock';
import type { FilterClause } from '@/lib/operations/contacts-filters.server';

// countCampaignCandidates 는 getResultCodeStatuses + db.select(count).where(...) 만 사용.
// where 의 raw SQL 을 extractRawSql 로 평탄화해 자동 제외/필터 결합을 검증한다.
// (preflight-exclusion.test.ts 패턴 — db / result-code-statuses mock)

interface FakeState {
  negativeCodes: string[];
  lastWhereRaw: string;
}
const state: FakeState = { negativeCodes: [], lastWhereRaw: '' };

function buildSelectChain() {
  const chain = {
    from() {
      return chain;
    },
    where(whereExpr: unknown) {
      state.lastWhereRaw = extractRawSql(whereExpr);
      return {
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve([{ total: 0 }]).then(resolve);
        },
      };
    },
  };
  return chain;
}

vi.mock('@/db', () => ({
  db: { select: vi.fn(() => buildSelectChain()) },
}));

vi.mock('@/lib/operations/result-code-statuses.server', async () => {
  const { mockBuildNegativeCodeExists } = await import('./_helpers/result-code-mock');
  return {
    getResultCodeStatuses: vi.fn(async () => ({
      positive: [] as string[],
      negative: state.negativeCodes,
    })),
    buildNegativeCodeExists: mockBuildNegativeCodeExists,
  };
});

import { countCampaignCandidates } from '@/lib/operations/campaigns.server';

const SURVEY_ID = '00000000-0000-4000-8000-000000000040';

describe('countCampaignCandidates — 자동 제외 + clauses 결합', () => {
  beforeEach(() => {
    state.negativeCodes = ['수신거부'];
    state.lastWhereRaw = '';
  });

  it('빈 clauses 여도 자동 제외(email PII / negative code)가 WHERE 에 포함된다', async () => {
    await countCampaignCandidates({ surveyId: SURVEY_ID, clauses: [], unrespondedOnly: false });
    expect(state.lastWhereRaw).toContain('contact_pii'); // HAS_EMAIL_PII
    expect(state.lastWhereRaw).toContain('contact_attempts'); // negative code EXISTS
    expect(state.lastWhereRaw).toContain('result_code');
  });

  it('attrs 텍스트 절이 WHERE 에 결합된다', async () => {
    const clauses: FilterClause[] = [
      { op: null, condition: { source: 'attrs.지역', mode: 'text', value: '서울' } },
    ];
    await countCampaignCandidates({ surveyId: SURVEY_ID, clauses, unrespondedOnly: false });
    expect(state.lastWhereRaw).toContain('attrs');
    expect(state.lastWhereRaw).toContain('서울');
    // 자동 제외도 여전히 유지
    expect(state.lastWhereRaw).toContain('contact_pii');
  });

  it('system.web boolean 절(응답완료=responded_at IS NOT NULL)이 결합된다', async () => {
    const clauses: FilterClause[] = [
      { op: null, condition: { source: 'system.web', mode: 'boolean', value: 'true' } },
    ];
    await countCampaignCandidates({ surveyId: SURVEY_ID, clauses, unrespondedOnly: false });
    expect(state.lastWhereRaw).toContain('responded_at');
  });
});
