import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { extractRawSql } from './_helpers/result-code-mock';

/**
 * listCampaignRecipients 의 깔때기(그룹 / 메모=반송사유) 조건 결합 검증.
 *
 * db 를 mock 해 where 절 raw SQL 을 평탄화한 뒤, "없음"(FILTER_NONE_VALUE) 이
 * IN 목록이 아니라 IS NULL 로 승격되는지 본다 — NULL 은 IN 으로 표현할 수 없어
 * 값으로 흘리면 영구 미스매치가 된다.
 * (campaign-candidate-filter.test.ts 의 db mock 패턴 재사용)
 */

/**
 * 실행된 쿼리 1건 — where 절 raw SQL 과 그 쿼리가 실제로 붙인 조인 테이블 목록.
 * 조인을 기록하지 않으면 "where 는 contact_targets 를 참조하는데 FROM 에는 없다" 는
 * PG 런타임 오류를 테스트가 통과시킨다 (실제로 통과시켰다).
 */
interface RecordedQuery {
  raw: string;
  joined: string[];
  /** SQL LIMIT 인자. 미지정이면 null — 앱에서 자르고 있다는 뜻. */
  limit: number | null;
  distinct: boolean;
}

const state = {
  queries: [] as RecordedQuery[],
  /** selectDistinct 체인이 돌려줄 행 (facets 테스트에서 주입). */
  distinctRows: [] as unknown[],
};

function buildChain(distinct = false) {
  const joined: string[] = [];
  const noteJoin = (table: unknown) => {
    try {
      joined.push(getTableName(table as never));
    } catch {
      // 테이블 객체가 아니면 무시 (조인 인자 형태가 바뀐 경우)
    }
  };
  const chain = {
    from: (table: unknown) => {
      noteJoin(table);
      return chain;
    },
    innerJoin: (table: unknown) => {
      noteJoin(table);
      return chain;
    },
    leftJoin: (table: unknown) => {
      noteJoin(table);
      return chain;
    },
    where(whereExpr: unknown) {
      const record: RecordedQuery = {
        raw: extractRawSql(whereExpr),
        joined: [...joined],
        limit: null,
        distinct,
      };
      state.queries.push(record);
      const rows: unknown[] = distinct ? state.distinctRows : [{ total: 0 }];
      const tail = {
        orderBy: () => tail,
        limit: (n: number) => {
          record.limit = n;
          return tail;
        },
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
    select: vi.fn(() => buildChain(false)),
    selectDistinct: vi.fn(() => buildChain(true)),
  },
}));

import {
  listCampaignRecipientFacets,
  listCampaignRecipients,
} from '@/server/mail/services/campaigns.server';
import { FILTER_NONE_VALUE } from '@/lib/operations/filter-shared';

const SURVEY_ID = '00000000-0000-4000-8000-000000000041';
const CAMPAIGN_ID = '00000000-0000-4000-8000-000000000042';

async function run(args: {
  groupValues?: string[];
  errorReasons?: string[];
  resultCodes?: string[];
}) {
  state.queries = [];
  await listCampaignRecipients({
    surveyId: SURVEY_ID,
    campaignId: CAMPAIGN_ID,
    scope: 'real',
    ...args,
  });
  return state.queries.map((q) => q.raw).join(' || ');
}

describe('listCampaignRecipients — 깔때기 조건', () => {
  beforeEach(() => {
    state.queries = [];
    state.distinctRows = [];
  });

  // 컨택 상관 필터(그룹 / 최근 결과코드)는 count 와 행 조회 양쪽에서 contact_targets 를
  // 참조한다. 한쪽이라도 조인을 빠뜨리면 PG 가 missing FROM-clause entry 로 거절해
  // 상세 페이지 전체가 죽는다.
  it.each([
    ['그룹', { groupValues: ['모바일'] }],
    ['최근 결과코드', { resultCodes: ['1.조사완료'] }],
  ])('%s 필터를 걸면 실행되는 모든 쿼리가 contact_targets 를 조인한다', async (_label, args) => {
    await run(args);
    expect(state.queries.length).toBeGreaterThan(1); // count + 행 조회
    for (const q of state.queries) {
      expect(q.joined).toContain('contact_targets');
    }
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

describe('listCampaignRecipientFacets — 깔때기 선택지 조회', () => {
  beforeEach(() => {
    state.queries = [];
    state.distinctRows = [];
  });

  // 앱에서 자르면 1만 명 캠페인에서 distinct 조합 전량이 넘어온다. 반송 사유처럼
  // 행마다 거의 고유한 값이 섞이면 상세 페이지를 열 때마다 그만큼을 실어 나른다.
  it('축마다 SQL LIMIT 으로 상한을 건다 — 앱 slice 로 대체하지 않는다', async () => {
    await listCampaignRecipientFacets({
      surveyId: SURVEY_ID,
      campaignId: CAMPAIGN_ID,
      scope: 'real',
    });

    const distinctQueries = state.queries.filter((q) => q.distinct);
    expect(distinctQueries.length).toBeGreaterThan(0);
    for (const q of distinctQueries) {
      expect(q.limit).not.toBeNull();
      expect(q.limit).toBeGreaterThan(0);
    }
  });

  it('상한을 넘는 값은 잘라서 노출한다', async () => {
    state.distinctRows = Array.from({ length: 500 }, (_, i) => ({
      v: `값${String(i).padStart(4, '0')}`,
    }));

    const facets = await listCampaignRecipientFacets({
      surveyId: SURVEY_ID,
      campaignId: CAMPAIGN_ID,
      scope: 'real',
    });

    expect(facets.groupValues.length).toBeLessThanOrEqual(200);
    expect(facets.groupValues.length).toBeGreaterThan(0);
  });
});
