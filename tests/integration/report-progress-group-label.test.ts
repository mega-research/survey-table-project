import { describe, expect, it, beforeEach, vi } from 'vitest';

import type { ContactColumnScheme } from '@/db/schema/schema-types';

// ========================
// 회귀: getProgressGroupLabel 그룹 헤더 라벨 결정성
// ========================
//
// 기존 휴리스틱은 첫 contact_target.attrs 안에서 value === group_value 인 첫 키를
// JSONB 순회 순서대로 골랐다. 동일 value 를 가진 attrs 키가 둘 이상이면
// 헤더 라벨이 어느 키로든 바뀔 수 있었다.
//
// 수정 후: contact_columns 스킴(extractSystemFieldKeys)에서 group attrs key 를
// 결정적으로 도출하고, 스킴이 못 주는 경우에만 value 매칭으로 폴백하되
// 동일 value 다중 키는 정렬해 결정적으로 첫 키를 고른다.
//
// db.select().from().where().limit() 체인을 시나리오별로 모킹해
// surveys.contact_columns / contact_targets 조회 두 갈래를 흉내낸다.

interface FakeState {
  /** surveys.contact_columns 조회가 돌려줄 스킴 */
  contactColumns: ContactColumnScheme | null;
  /** contact_targets 첫 행 조회가 돌려줄 attrs / group_value */
  firstContact: { attrs: Record<string, string> | null; groupValue: string | null } | null;
}

const state: FakeState = {
  contactColumns: null,
  firstContact: null,
};

/**
 * drizzle select 체인 모킹.
 * SELECT 한 컬럼 키로 어느 테이블 조회인지 식별한다:
 * - contactColumns → surveys.contact_columns 조회
 * - attrs → contact_targets 첫 행 조회
 */
function makeSelectChain(columns: Record<string, unknown>) {
  const keys = Object.keys(columns);
  let rows: Array<Record<string, unknown>> = [];

  if (keys.includes('contactColumns')) {
    rows = state.contactColumns === null ? [] : [{ contactColumns: state.contactColumns }];
  } else if (keys.includes('attrs')) {
    rows =
      state.firstContact === null
        ? []
        : [{ attrs: state.firstContact.attrs, groupValue: state.firstContact.groupValue }];
  }

  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

vi.mock('@/db', () => ({
  db: {
    select: vi.fn((columns: Record<string, unknown>) => makeSelectChain(columns)),
  },
}));

import { getProgressGroupLabel } from '@/lib/operations/report-progress.server';

const SURVEY_ID = '00000000-0000-4000-8000-000000000010';

function scheme(columns: ContactColumnScheme['columns']): ContactColumnScheme {
  return { version: 1, headerRow: 1, columns };
}

describe('getProgressGroupLabel — 그룹 헤더 라벨 결정성', () => {
  beforeEach(() => {
    state.contactColumns = null;
    state.firstContact = null;
    // cache() 메모이제이션 우회 위해 매 케이스 다른 surveyId 사용
  });

  it('전시회 같은 표준명칭 키가 있어도 실제 group_value 로 올바른 키를 고른다', async () => {
    // group 은 개최월인데 스킴에 전시회 키도 있다. 스킴 기반 표준명칭 휴리스틱이면
    // 전시회를 group 으로 오인하지만, 실제 저장된 group_value(개최월 값)로 역추론하면
    // 개최월을 정확히 고른다(codex 지적: 업로드 group 선택은 스킴이 아닌 mapping 에 있음).
    state.contactColumns = scheme([
      { key: '전시회', label: '전시회명', source: 'attrs.전시회', order: 1 },
      { key: '개최월', label: '개최 월', source: 'attrs.개최월', order: 2 },
    ]);
    state.firstContact = {
      attrs: { 전시회: '서울국제박람회', 개최월: '3월' },
      groupValue: '3월',
    };

    const label = await getProgressGroupLabel(`${SURVEY_ID}-1`);
    expect(label).toBe('개최 월');
  });

  it('동일 value 가 여러 attrs 키에 있으면 정렬된 첫 키를 결정적으로 고른다', async () => {
    // group_value 역추론에서 동일 value 키가 둘이면 정렬해 'aaa' 가 'zzz' 보다
    // 먼저 선택돼야 한다(JSONB 순회 순서 비의존).
    state.contactColumns = scheme([
      { key: 'zzz', label: 'ZZZ 라벨', source: 'attrs.zzz', order: 1 },
      { key: 'aaa', label: 'AAA 라벨', source: 'attrs.aaa', order: 2 },
    ]);
    state.firstContact = {
      attrs: { zzz: '대상값', aaa: '대상값' },
      groupValue: '대상값',
    };

    const label = await getProgressGroupLabel(`${SURVEY_ID}-2`);
    expect(label).toBe('AAA 라벨');
  });

  it('컨택 0건이면 그룹 fallback', async () => {
    state.contactColumns = scheme([
      { key: '메모', label: '메모', source: 'attrs.메모', order: 1 },
    ]);
    state.firstContact = null;

    const label = await getProgressGroupLabel(`${SURVEY_ID}-3`);
    expect(label).toBe('그룹');
  });

  it('group key 의 source 가 스킴에 있으면 그 라벨을 쓴다', async () => {
    // group_value 로 도출한 key 의 source 가 스킴 컬럼에 있으면 그 라벨을 쓴다.
    state.contactColumns = scheme([
      { key: '전시회', label: '전시회', source: 'attrs.전시회', order: 1 },
    ]);
    state.firstContact = {
      attrs: { 전시회: '부산모터쇼' },
      groupValue: '부산모터쇼',
    };

    const label = await getProgressGroupLabel(`${SURVEY_ID}-4`);
    expect(label).toBe('전시회');
  });
});
