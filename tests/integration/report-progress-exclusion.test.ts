import { describe, expect, it, beforeEach, vi } from 'vitest';

// ========================
// 모듈 모킹
// ========================
//
// report-progress.server 는 다음에 의존한다:
// - @/db 의 drizzle client (db.execute)
// - getResultCodeStatuses (surveys.contact_result_codes → positive/negative codes)
//
// 진짜 PG 가 없는 vitest 환경에서 SQL FILTER 의미를 JS 로 시뮬레이션해서
// excludeFilter 적용 시 분모/분자/제외 카운트가 의도대로 산출되는지 검증한다.
//
// 시뮬레이터는 (closing OR positive code) / (negative code OR unsubscribed_at)
// 두 술어를 in-memory contacts 배열에 적용해 SQL 결과 row 를 만들어낸다.

interface SeedContact {
  id: string;
  groupValue: string | null;
  resid: number;
  attempts: string[];
  responded: boolean;
  unsubscribed: boolean;
}

interface FakeState {
  contacts: SeedContact[];
  positiveCodes: string[];
  negativeCodes: string[];
}

const state: FakeState = {
  contacts: [],
  positiveCodes: [],
  negativeCodes: [],
};

function isClosing(c: SeedContact): boolean {
  if (c.responded) return true;
  if (state.positiveCodes.length === 0) return false;
  return c.attempts.some((a) => state.positiveCodes.includes(a));
}

function isExcluded(c: SeedContact): boolean {
  const codeBranch =
    state.negativeCodes.length > 0 &&
    c.attempts.some((a) => state.negativeCodes.includes(a));
  return codeBranch || c.unsubscribed;
}

// Drizzle SQL 객체 → raw 텍스트 (StringChunk.value 재귀 추출)
function extractRaw(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map(extractRaw).join(' ');
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.value)) return obj.value.map(extractRaw).join(' ');
  if (typeof obj.value === 'string') return obj.value;
  if (Array.isArray(obj.queryChunks)) return obj.queryChunks.map(extractRaw).join(' ');
  return '';
}

// SQL 패턴 식별 후 in-memory 결과 직조
function executeMock(sqlObj: unknown): unknown[] {
  const raw = extractRaw(sqlObj).toLowerCase();

  // getProgressTotals SQL — group_count + list_total + completed_total + excluded_total
  if (raw.includes('group_count') && raw.includes('excluded_total')) {
    const distinctGroups = new Set(
      state.contacts.map((c) => (c.groupValue == null ? '(미분류)' : c.groupValue)),
    );
    const listTotal = state.contacts.filter((c) => !isExcluded(c)).length;
    const completedTotal = state.contacts.filter(
      (c) => isClosing(c) && !isExcluded(c),
    ).length;
    const excludedTotal = state.contacts.filter((c) => isExcluded(c)).length;
    return [
      {
        group_count: distinctGroups.size,
        list_total: listTotal,
        completed_total: completedTotal,
        excluded_total: excludedTotal,
      },
    ];
  }

  // getProgressRows SQL — group_label + first_resid + counts
  if (raw.includes('group_label') && raw.includes('excluded_count')) {
    const byGroup = new Map<string | null, SeedContact[]>();
    for (const c of state.contacts) {
      const key = c.groupValue;
      const arr = byGroup.get(key) ?? [];
      arr.push(c);
      byGroup.set(key, arr);
    }
    const rows: Record<string, unknown>[] = [];
    for (const [gv, arr] of byGroup.entries()) {
      const groupLabel = gv == null ? '(미분류)' : gv;
      const firstResid = Math.min(...arr.map((c) => c.resid));
      rows.push({
        group_label: groupLabel,
        group_value_raw: gv,
        first_resid: firstResid,
        excluded_count: arr.filter((c) => isExcluded(c)).length,
        list_count: arr.filter((c) => !isExcluded(c)).length,
        completed_count: arr.filter((c) => isClosing(c) && !isExcluded(c)).length,
      });
    }
    // ORDER BY group_value_raw NULLS LAST (간이) — 테스트 안정성 위해 라벨 asc
    rows.sort((a, b) => {
      if (a.group_value_raw == null && b.group_value_raw == null) return 0;
      if (a.group_value_raw == null) return 1;
      if (b.group_value_raw == null) return -1;
      return String(a.group_value_raw).localeCompare(String(b.group_value_raw));
    });
    return rows;
  }

  return [];
}

vi.mock('@/db', () => ({
  db: {
    execute: vi.fn((sqlObj: unknown) => Promise.resolve(executeMock(sqlObj))),
  },
}));

vi.mock('@/lib/operations/result-code-statuses.server', () => ({
  getResultCodeStatuses: vi.fn(async () => ({
    positive: state.positiveCodes,
    negative: state.negativeCodes,
  })),
}));

// progress-filters.server 의 FilterCondition 타입만 import 하므로 모킹 불필요
// — buildFilterSql(null) 분기만 사용한다.

import {
  getProgressRows,
  getProgressTotals,
} from '@/lib/operations/report-progress.server';

const SURVEY_ID = '00000000-0000-4000-8000-000000000010';

interface SeedContactInput {
  groupValue: string | null;
  resid?: number;
  attempts?: string[];
  responded?: boolean;
  unsubscribed?: boolean;
}

function setup(
  positiveCodes: string[],
  negativeCodes: string[],
  contacts: SeedContactInput[],
) {
  state.positiveCodes = positiveCodes;
  state.negativeCodes = negativeCodes;
  state.contacts = contacts.map((c, i) => ({
    id: `ct-${i + 1}`,
    resid: c.resid ?? i + 1,
    groupValue: c.groupValue,
    attempts: c.attempts ?? [],
    responded: c.responded ?? false,
    unsubscribed: c.unsubscribed ?? false,
  }));
}

describe('getProgressTotals — negative exclusion', () => {
  beforeEach(() => {
    state.contacts = [];
    state.positiveCodes = [];
    state.negativeCodes = [];
  });

  it('DEFAULT codes — 수신거부 마킹 ct 는 분모/분자에서 제외', async () => {
    setup(['1.조사완료'], ['수신거부'], [
      { groupValue: 'A', responded: true },                  // 분자+분모
      { groupValue: 'A', attempts: ['1.조사완료'] },          // 분자+분모
      { groupValue: 'A' },                                    // 분모만
      { groupValue: 'A', attempts: ['수신거부'] },            // 제외
    ]);
    const totals = await getProgressTotals(SURVEY_ID, null);
    expect(totals.listTotal).toBe(3);
    expect(totals.completedTotal).toBe(2);
    expect(totals.excludedTotal).toBe(1);
  });

  it('unsubscribed_at IS NOT NULL 도 제외', async () => {
    setup(['1.조사완료'], ['수신거부'], [
      { groupValue: 'A', responded: true },
      { groupValue: 'A', unsubscribed: true },                // 제외
    ]);
    const totals = await getProgressTotals(SURVEY_ID, null);
    expect(totals.listTotal).toBe(1);
    expect(totals.completedTotal).toBe(1);
    expect(totals.excludedTotal).toBe(1);
  });

  it('exclude 우선 — 응답 완료해도 negative 면 분자/분모 제외', async () => {
    setup(['1.조사완료'], ['수신거부'], [
      { groupValue: 'A', responded: true, attempts: ['수신거부'] },  // 제외
      { groupValue: 'A', responded: true },                          // 분자+분모
    ]);
    const totals = await getProgressTotals(SURVEY_ID, null);
    expect(totals.listTotal).toBe(1);
    expect(totals.completedTotal).toBe(1);
    expect(totals.excludedTotal).toBe(1);
  });

  it('사용자 정의 — 신규 positive 코드 인정', async () => {
    setup(
      ['1.조사완료', '추가완료'],
      ['수신거부'],
      [
        { groupValue: 'A', attempts: ['추가완료'] },           // 분자
        { groupValue: 'A', attempts: ['1.조사완료'] },         // 분자
        { groupValue: 'A' },                                    // 분모만
      ],
    );
    const totals = await getProgressTotals(SURVEY_ID, null);
    expect(totals.listTotal).toBe(3);
    expect(totals.completedTotal).toBe(2);
    expect(totals.excludedTotal).toBe(0);
  });

  it('fallback — status 없고 1.조사완료 만 positive 로 자동 인정', async () => {
    // extractResultCodeStatuses fallback 결과를 직접 주입 — positive=['1.조사완료'], negative=[]
    setup(
      ['1.조사완료'],
      [],
      [
        { groupValue: 'A', attempts: ['1.조사완료'] },         // 분자
        { groupValue: 'A', attempts: ['2.재통화예약'] },       // 분모만
      ],
    );
    const totals = await getProgressTotals(SURVEY_ID, null);
    expect(totals.listTotal).toBe(2);
    expect(totals.completedTotal).toBe(1);
    expect(totals.excludedTotal).toBe(0);
  });
});

describe('getProgressRows — 그룹별 excludedCount', () => {
  beforeEach(() => {
    state.contacts = [];
    state.positiveCodes = [];
    state.negativeCodes = [];
  });

  it('그룹별 분자/분모/제외 카운트', async () => {
    setup(['1.조사완료'], ['수신거부'], [
      { groupValue: 'A', responded: true },
      { groupValue: 'A' },
      { groupValue: 'A', attempts: ['수신거부'] },
      { groupValue: 'B', responded: true },
      { groupValue: 'B', attempts: ['수신거부'] },
    ]);
    const rows = await getProgressRows({
      surveyId: SURVEY_ID,
      condition: null,
      page: 1,
      size: 100,
      sort: 'groupLabel',
      dir: 'asc',
      metaKeys: [],
    });
    const a = rows.find((r) => r.groupLabel === 'A')!;
    const b = rows.find((r) => r.groupLabel === 'B')!;
    expect(a.listCount).toBe(2);
    expect(a.completedCount).toBe(1);
    expect(a.excludedCount).toBe(1);
    expect(b.listCount).toBe(1);
    expect(b.completedCount).toBe(1);
    expect(b.excludedCount).toBe(1);
  });
});
