import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listUnsubscribedContacts } from '@/lib/operations/campaigns.server';

/**
 * listUnsubscribedContacts 가 컨택 attrs 를 행에 싣는지 — 수신거부자 명단이 컬럼 설정의
 * "메일 표시" attrs 컬럼을 그리려면 필요하다 (캠페인 상세 수신자 행과 같은 규칙).
 */

const state = {
  rows: [] as unknown[],
};

function buildChain() {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where() {
      const tail = {
        orderBy: () => tail,
        limit: () => tail,
        offset: () => Promise.resolve(state.rows),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve([{ total: state.rows.length }]).then(resolve),
      };
      return tail;
    },
  };
  return chain;
}

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => buildChain()),
  },
}));

const SURVEY_ID = '00000000-0000-4000-8000-000000000041';

function unsubRow(overrides: Record<string, unknown>) {
  return {
    id: 'ct-1',
    resid: 7,
    groupValue: null,
    unsubscribedAt: new Date('2026-08-26T00:00:00Z'),
    latestResultCode: null,
    latestAttemptAt: null,
    ...overrides,
  };
}

describe('listUnsubscribedContacts — 컨택 attrs 전달', () => {
  beforeEach(() => {
    state.rows = [];
  });

  it('행에 contact_targets.attrs 를 attrs 로 싣는다', async () => {
    state.rows = [unsubRow({ attrs: { 리스트ID: 'L-001' } })];

    const result = await listUnsubscribedContacts({ surveyId: SURVEY_ID, scope: 'real' });

    expect(result.rows[0]?.attrs).toEqual({ 리스트ID: 'L-001' });
  });

  it('attrs 가 NULL 이면 빈 객체', async () => {
    state.rows = [unsubRow({ attrs: null })];

    const result = await listUnsubscribedContacts({ surveyId: SURVEY_ID, scope: 'real' });

    expect(result.rows[0]?.attrs).toEqual({});
  });
});
