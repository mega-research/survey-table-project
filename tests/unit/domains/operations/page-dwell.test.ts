import { describe, expect, it } from 'vitest';

import {
  aggregatePageDwell,
  shapePageDwell,
  trimmedStats,
  type DwellInput,
} from '@/lib/operations/page-dwell';
import type {
  PageVisit,
  QuestionData,
  QuestionGroupData,
  SurveyVersionSnapshot,
} from '@/db/schema/schema-types';

// ── 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * 최소한의 snapshot 빌더 — 필수 필드만 채운다 (settings 등은 캐스팅으로 회피하지 않고 더미 채움).
 */
function makeSnapshot(
  groups: QuestionGroupData[],
  questions: QuestionData[],
): SurveyVersionSnapshot {
  return {
    title: 'test',
    questions,
    groups,
    settings: {
      isPublic: true,
      allowMultipleResponses: false,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '',
    },
  };
}

function makeGroup(
  id: string,
  name: string,
  order: number,
  parentGroupId?: string,
): QuestionGroupData {
  return { id, surveyId: 'survey-1', name, order, ...(parentGroupId !== undefined ? { parentGroupId } : {}) };
}

function makeQuestion(
  id: string,
  type: string,
  order: number,
  groupId?: string,
  extras: Partial<QuestionData> = {},
): QuestionData {
  return {
    id,
    type,
    title: id.toUpperCase(),
    required: false,
    order,
    ...(groupId !== undefined ? { groupId } : {}),
    ...extras,
  } as QuestionData;
}

/** PageVisit 생성: 시작 후 dwellSeconds초 머물렀다고 가정. */
function visit(stepId: string, dwellSeconds: number): PageVisit {
  const start = new Date('2026-01-01T00:00:00.000Z').getTime();
  return {
    stepId,
    enteredAt: new Date(start).toISOString(),
    leftAt: new Date(start + dwellSeconds * 1000).toISOString(),
  };
}

// ── trimmedStats ────────────────────────────────────────────────────────

describe('trimmedStats', () => {
  it('빈 배열 → n=0, mean=null, sd=null', () => {
    expect(trimmedStats([], 0.025)).toEqual({ n: 0, mean: null, sd: null });
  });

  it('단일 값 → n=1, mean=값, sd=null (n-1=0)', () => {
    expect(trimmedStats([42], 0.025)).toEqual({ n: 1, mean: 42, sd: null });
  });

  it('두 값 → 표본 SD 계산 (n-1 분모)', () => {
    // values [10, 20], mean=15, var=(25+25)/1=50, sd=sqrt(50)
    const r = trimmedStats([10, 20], 0.025);
    expect(r.n).toBe(2);
    expect(r.mean).toBe(15);
    expect(r.sd).not.toBeNull();
    expect(r.sd!).toBeCloseTo(Math.sqrt(50), 10);
  });

  it('NaN/Infinity 사전 필터', () => {
    const r = trimmedStats([1, 2, NaN, Infinity, -Infinity, 3], 0.025);
    // 유효값 [1,2,3] 만 → mean=2, var=((1)^2+0+(1)^2)/2=1, sd=1
    expect(r.n).toBe(3);
    expect(r.mean).toBe(2);
    expect(r.sd).toBeCloseTo(1, 10);
  });

  it('n=100, 양쪽 outlier 제거 효과', () => {
    const base: number[] = [];
    for (let i = 1; i <= 96; i++) base.push(i + 100); // 101..196
    const values = [1, 2, ...base, 9000, 10000];
    const trimmed = trimmedStats(values, 0.025);
    // 양쪽 floor(100*0.025)=2개씩 제거 → base만 남음.
    const expected = base.reduce((s, v) => s + v, 0) / base.length;
    expect(trimmed.n).toBe(96);
    expect(trimmed.mean).toBeCloseTo(expected, 10);
    expect(trimmed.sd).not.toBeNull();
  });
});

// ── shapePageDwell ──────────────────────────────────────────────────────

describe('shapePageDwell', () => {
  /**
   * 표준 snapshot — 그룹 G1(인적사항) 안에 q1(text)+q2(table), 그리고 ungrouped q3(text).
   * 신모델: pageBreakBefore 없으면 전체가 한 페이지.
   * pageBreakBefore를 명시해 두 페이지로 분할:
   *   1. page:q1  (q1, q2)   label='인적사항', page=1
   *   2. page:q3  (q3)       label='Q2' (rootGroupName=null, code=undefined → Q2), page=2
   */
  const baseGroups: QuestionGroupData[] = [makeGroup('G1', '인적사항', 0)];
  const baseQuestions: QuestionData[] = [
    makeQuestion('q1', 'text', 0, 'G1'),
    makeQuestion('q2', 'table', 1, 'G1'),
    makeQuestion('q3', 'text', 0, undefined, { pageBreakBefore: true } as Partial<QuestionData>),
  ];
  const baseSnapshot = makeSnapshot(baseGroups, baseQuestions);

  it('빈 응답 → 모든 step이 n=0', () => {
    const out = shapePageDwell({ responses: [], snapshot: baseSnapshot });
    expect(out.pages).toHaveLength(2);
    expect(out.pages.map((p) => p.stepId)).toEqual([
      'page:q1',
      'page:q3',
    ]);
    expect(out.pages[0]?.label).toBe('인적사항');
    for (const p of out.pages) {
      expect(p.n).toBe(0);
      expect(p.meanSeconds).toBeNull();
      expect(p.sdSeconds).toBeNull();
    }
  });

  it('단일 응답 2 visits → 각 step에 n=1, sd=null', () => {
    const input: DwellInput = {
      responses: [
        {
          pageVisits: [visit('page:q1', 30), visit('page:q3', 60)],
        },
      ],
      snapshot: baseSnapshot,
    };
    const out = shapePageDwell(input);
    const p1 = out.pages.find((p) => p.stepId === 'page:q1')!;
    const p3 = out.pages.find((p) => p.stepId === 'page:q3')!;
    expect(p1.n).toBe(1);
    expect(p1.meanSeconds).toBe(30);
    expect(p1.sdSeconds).toBeNull();
    expect(p3.n).toBe(1);
    expect(p3.meanSeconds).toBe(60);
    expect(p3.sdSeconds).toBeNull();
  });

  it('leftAt 누락된 visit는 skip', () => {
    const input: DwellInput = {
      responses: [
        {
          pageVisits: [
            // 정상
            visit('page:q1', 30),
            // leftAt 없음 → skip
            {
              stepId: 'page:q1',
              enteredAt: new Date('2026-01-01T01:00:00.000Z').toISOString(),
            } as PageVisit,
          ],
        },
      ],
      snapshot: baseSnapshot,
    };
    const out = shapePageDwell(input);
    expect(out.pages.find((p) => p.stepId === 'page:q1')!.n).toBe(1);
  });

  it('leftAt ≤ enteredAt 인 visit는 skip', () => {
    const sameMoment = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const earlier = new Date('2025-12-31T23:00:00.000Z').toISOString();
    const input: DwellInput = {
      responses: [
        {
          pageVisits: [
            // 같은 시각 → skip
            { stepId: 'page:q1', enteredAt: sameMoment, leftAt: sameMoment },
            // 더 이른 leftAt → skip
            { stepId: 'page:q1', enteredAt: sameMoment, leftAt: earlier },
            // 정상
            visit('page:q1', 10),
          ],
        },
      ],
      snapshot: baseSnapshot,
    };
    const out = shapePageDwell(input);
    expect(out.pages.find((p) => p.stepId === 'page:q1')!.n).toBe(1);
  });

  it('pageVisits=null 또는 [] → 응답 자체 skip', () => {
    const input: DwellInput = {
      responses: [{ pageVisits: null }, { pageVisits: [] }],
      snapshot: baseSnapshot,
    };
    const out = shapePageDwell(input);
    for (const p of out.pages) expect(p.n).toBe(0);
  });

  it('동일 step 여러 응답 → 평균/SD 집계', () => {
    const input: DwellInput = {
      responses: [
        { pageVisits: [visit('page:q1', 10)] },
        { pageVisits: [visit('page:q1', 20)] },
        { pageVisits: [visit('page:q1', 30)] },
      ],
      snapshot: baseSnapshot,
    };
    const out = shapePageDwell(input);
    const p1 = out.pages.find((p) => p.stepId === 'page:q1')!;
    expect(p1.n).toBe(3);
    expect(p1.meanSeconds).toBe(20);
    // var = ((10-20)^2+(20-20)^2+(30-20)^2)/(3-1) = 200/2 = 100, sd = 10
    expect(p1.sdSeconds!).toBeCloseTo(10, 10);
  });

  it('pageBreakBefore 없으면 모든 질문이 단일 페이지 — 라벨은 첫 항목 rootGroupName', () => {
    const groups = [makeGroup('G1', '그룹A', 0)];
    const questions: QuestionData[] = [
      makeQuestion('q1', 'text', 0, 'G1'),
      makeQuestion('q2', 'table', 1, 'G1'),
      makeQuestion('q3', 'text', 0), // ungrouped, pageBreakBefore 없음
    ];
    const snap = makeSnapshot(groups, questions);
    const out = shapePageDwell({ responses: [], snapshot: snap });
    // pageBreakBefore 없으면 단일 페이지
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0]?.stepId).toBe('page:q1');
    expect(out.pages[0]?.label).toBe('그룹A');
  });

  it('빈 snapshot (그룹 + 질문 0건) → pages=[]', () => {
    const empty = makeSnapshot([], []);
    const out = shapePageDwell({ responses: [], snapshot: empty });
    expect(out.pages).toEqual([]);
  });

  it('snapshot에 없는 stepId의 visit는 무시 (legacy — 구 group:/table: 포함)', () => {
    const input: DwellInput = {
      responses: [
        {
          pageVisits: [
            // 구 모델 stepId — 미상으로 무시
            visit('group:G1', 99),
            visit('table:q2', 50),
            visit('group:root', 20),
            // 신 모델 stepId
            visit('page:q1', 12),
          ],
        },
      ],
      snapshot: baseSnapshot,
    };
    const out = shapePageDwell(input);
    const p1 = out.pages.find((p) => p.stepId === 'page:q1')!;
    expect(p1.n).toBe(1);
    expect(p1.meanSeconds).toBe(12);
    // 출력에는 미상 stepId 등장 안 함
    expect(out.pages.map((p) => p.stepId)).not.toContain('group:G1');
    expect(out.pages.map((p) => p.stepId)).not.toContain('table:q2');
    expect(out.pages.map((p) => p.stepId)).not.toContain('group:root');
  });

  it('트리밍: 100명 응답 + 양쪽 2명 outlier → 트림된 평균이 원본보다 영향 적음', () => {
    // 응답 100개, 각각 visit 1개. 응답당 stepId 합산 후 표본 1개가 됨.
    // 1, 2 (하단 outlier), 101..196 (96개), 9000, 10000 (상단 outlier) = 100명.
    const dwells: number[] = [1, 2];
    for (let i = 1; i <= 96; i++) dwells.push(i + 100);
    dwells.push(9000, 10000);
    expect(dwells).toHaveLength(100);

    const responses = dwells.map((d) => ({ pageVisits: [visit('page:q1', d)] }));
    const input: DwellInput = {
      responses,
      snapshot: baseSnapshot,
    };
    const out = shapePageDwell(input);
    const p1 = out.pages.find((p) => p.stepId === 'page:q1')!;
    // floor(100*0.025)=2 → 양쪽 2개씩 제거 → 정확히 base만 남음.
    expect(p1.n).toBe(96);
    const expected = (101 + 196) / 2; // 등차수열 평균
    expect(p1.meanSeconds!).toBeCloseTo(expected, 5);
  });

  it('pageBreakBefore로 페이지 구분: 위치 카운터가 캐노니컬 순서대로 증가', () => {
    // G1 안에 [q1, q2(pageBreakBefore), q3] → 두 페이지
    const groups = [makeGroup('G1', '메인', 0)];
    const questions: QuestionData[] = [
      makeQuestion('q1', 'text', 0, 'G1'),
      makeQuestion('q2', 'table', 1, 'G1', { pageBreakBefore: true } as Partial<QuestionData>),
      makeQuestion('q3', 'text', 2, 'G1'),
    ];
    const snap = makeSnapshot(groups, questions);
    const out = shapePageDwell({ responses: [], snapshot: snap });
    expect(out.pages).toHaveLength(2);
    expect(out.pages.map((p) => p.stepId)).toEqual([
      'page:q1',
      'page:q2',
    ]);
    expect(out.pages.map((p) => p.position)).toEqual([1, 2]);
    // 두 페이지 모두 같은 그룹이므로 rootGroupName='메인'
    expect(out.pages[0]?.label).toBe('메인');
    expect(out.pages[1]?.label).toBe('메인');
  });

  it('page 필드: 신모델에서 page === position', () => {
    // G1 안에 q1, G2 안에 q2(pageBreakBefore), ungrouped q3(pageBreakBefore)
    const groups = [makeGroup('G1', '그룹1', 0), makeGroup('G2', '그룹2', 1)];
    const questions: QuestionData[] = [
      makeQuestion('q1', 'text', 0, 'G1'),
      makeQuestion('q2', 'table', 0, 'G2', { pageBreakBefore: true } as Partial<QuestionData>),
      makeQuestion('q3', 'text', 0, undefined, { pageBreakBefore: true } as Partial<QuestionData>),
    ];
    const snap = makeSnapshot(groups, questions);
    const out = shapePageDwell({ responses: [], snapshot: snap });
    expect(out.pages).toHaveLength(3);
    // page === position
    for (const p of out.pages) {
      expect(p.page).toBe(p.position);
    }
    expect(out.pages.map((p) => p.stepId)).toEqual(['page:q1', 'page:q2', 'page:q3']);
  });
});

// ── aggregatePageDwell — 응답 내 다중 visit 합산 ────────────────────────

describe('aggregatePageDwell — 응답 내 다중 visit 합산', () => {
  it('같은 응답의 같은 step 다중 visit을 표본 1개(합산값)로 집계한다', () => {
    const responses = [
      {
        pageVisits: [
          { stepId: 'page:root', enteredAt: '2026-05-29T00:00:00.000Z', leftAt: '2026-05-29T00:00:10.000Z' }, // 10s
          { stepId: 'page:root', enteredAt: '2026-05-29T00:05:00.000Z', leftAt: '2026-05-29T00:05:20.000Z' }, // 20s
        ],
      },
    ];
    const stats = aggregatePageDwell(responses, new Set(['page:root']), 0);
    const s = stats.get('page:root');
    expect(s?.n).toBe(1); // visit 2개가 아니라 응답 1개
    expect(s?.mean).toBe(30); // 10 + 20 합산
  });
});
