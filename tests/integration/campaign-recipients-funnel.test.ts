import { describe, expect, it, beforeEach, vi } from 'vitest';
import { extractRawSql } from './_helpers/result-code-mock';

/**
 * listCampaignRecipients 의 깔때기(그룹 / 메모=반송사유) 조건 결합 검증.
 *
 * db 를 mock 해 where 절 raw SQL 을 평탄화한 뒤, "없음"(FILTER_NONE_VALUE) 이
 * IN 목록이 아니라 IS NULL 로 승격되는지 본다 — NULL 은 IN 으로 표현할 수 없어
 * 값으로 흘리면 영구 미스매치가 된다.
 * (campaign-candidate-filter.test.ts 의 db mock 패턴 재사용)
 */

const state = { whereRaws: [] as string[] };

function buildChain() {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where(whereExpr: unknown) {
      state.whereRaws.push(extractRawSql(whereExpr));
      const rows: unknown[] = [{ total: 0 }];
      const tail = {
        orderBy: () => tail,
        limit: () => tail,
        offset: () => Promise.resolve([]),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return tail;
    },
  };
  return chain;
}

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => buildChain()),
    selectDistinct: vi.fn(() => buildChain()),
  },
}));

import { listCampaignRecipients } from '@/lib/operations/campaigns.server';
import { FILTER_NONE_VALUE } from '@/lib/operations/filter-shared';

const SURVEY_ID = '00000000-0000-4000-8000-000000000041';
const CAMPAIGN_ID = '00000000-0000-4000-8000-000000000042';

async function run(args: {
  groupValues?: string[];
  errorReasons?: string[];
  resultCodes?: string[];
}) {
  state.whereRaws = [];
  await listCampaignRecipients({
    surveyId: SURVEY_ID,
    campaignId: CAMPAIGN_ID,
    scope: 'real',
    ...args,
  });
  return state.whereRaws.join(' || ');
}

describe('listCampaignRecipients — 깔때기 조건', () => {
  beforeEach(() => {
    state.whereRaws = [];
  });

  // extractRawSql 은 drizzle Column 을 텍스트로 펼치지 못한다(빈 자리로 남는다).
  // 그래서 컬럼명 대신 이 모듈이 직접 짠 구조(NULLIF / IN / 대문자 IS NULL)와
  // 바인딩된 값으로 검증한다. 베이스 where 의 archived_at 조건은 drizzle isNull 이라
  // 소문자 "is null" 로 나오므로 대문자 매칭과 섞이지 않는다.
  it('깔때기 미지정이면 그룹·사유 조건을 아예 붙이지 않는다', async () => {
    const raw = await run({});
    expect(raw).not.toContain('NULLIF');
    expect(raw).not.toContain('IS NULL');
  });

  it('그룹 값 선택 → IN 절, IS NULL 없음', async () => {
    const raw = await run({ groupValues: ['모바일', 'PC'] });
    expect(raw).toContain('NULLIF');
    expect(raw).toContain(' IN ');
    expect(raw).toContain('모바일');
    expect(raw).toContain('PC');
    expect(raw).not.toContain('IS NULL');
  });

  it('"없음" 단독 → IN 절 없이 IS NULL', async () => {
    const raw = await run({ groupValues: [FILTER_NONE_VALUE] });
    expect(raw).toContain('IS NULL');
    expect(raw).not.toContain(' IN ');
    // 센티널 문자열이 값으로 새어 들어가면 안 된다.
    expect(raw).not.toContain(FILTER_NONE_VALUE);
  });

  it('값 + "없음" 혼합 → IN 과 IS NULL 의 OR', async () => {
    const raw = await run({ errorReasons: ['hard bounce', FILTER_NONE_VALUE] });
    expect(raw).toContain(' IN ');
    expect(raw).toContain('hard bounce');
    expect(raw).toContain('IS NULL');
    expect(raw).toContain(' OR ');
    expect(raw).not.toContain(FILTER_NONE_VALUE);
  });

  it('빈 문자열을 NULL 과 같은 "없음" 으로 접는다 — 표의 공백 표시와 일치', async () => {
    const raw = await run({ groupValues: [FILTER_NONE_VALUE] });
    expect(raw).toContain("NULLIF");
  });

  it('최근 결과코드 값 선택 → IN 절', async () => {
    const raw = await run({ resultCodes: ['1.조사완료'] });
    expect(raw).toContain('result_code');
    expect(raw).toContain(' IN ');
    expect(raw).toContain('1.조사완료');
  });

  it('최근 결과코드 "없음" → IS NULL, 센티널 문자열은 값으로 새지 않는다', async () => {
    const raw = await run({ resultCodes: [FILTER_NONE_VALUE] });
    expect(raw).toContain('result_code');
    expect(raw).toContain('IS NULL');
    expect(raw).not.toContain(' IN ');
    expect(raw).not.toContain(FILTER_NONE_VALUE);
  });

  it('두 축을 함께 걸면 AND 로 결합된다', async () => {
    const raw = await run({ groupValues: ['모바일'], errorReasons: ['hard bounce'] });
    expect(raw).toContain('모바일');
    expect(raw).toContain('hard bounce');
    expect(raw.split('NULLIF').length - 1).toBeGreaterThanOrEqual(2);
  });
});
