import { describe, expect, it } from 'vitest';

import type { SurveyResponse } from '@/db/schema';
import type { Question, QuestionGroup } from '@/types/survey';

import {
  applyDemandView,
  buildDemandSummary,
  parseDemandSortMode,
  sortByNeedRate,
} from './demand-summary';

const group = (id: string, name: string, order: number): QuestionGroup =>
  ({ id, surveyId: 's', name, order }) as QuestionGroup;

/** 판단 항목 — 필요함 / 필요하지 않음 */
const judgement = (id: string, groupId: string | null, order: number): Question =>
  ({
    id,
    type: 'radio',
    title: `${id} 문항`,
    questionCode: id.toUpperCase(),
    required: true,
    order,
    ...(groupId ? { groupId } : {}),
    options: [
      { id: `${id}-need`, value: '1', label: '필요함' },
      { id: `${id}-drop`, value: '2', label: '필요하지 않음' },
    ],
  }) as Question;

/** 문항 의견 — 부모 바로 뒤에 오는 `부모코드_T` 장문형 (ADR 0022). id 는 `<부모>-op`. */
const opinionQ = (parentId: string, groupId: string | null, order: number): Question =>
  ({
    id: `${parentId}-op`,
    type: 'textarea',
    title: `${parentId} 의견`,
    questionCode: `${parentId.toUpperCase()}_T`,
    required: false,
    order,
    ...(groupId ? { groupId } : {}),
  }) as Question;

const freeText = (id: string, groupId: string | null, order: number): Question =>
  ({ id, type: 'textarea', title: `${id} 종합 의견`, required: false, order, ...(groupId ? { groupId } : {}) }) as Question;

/** questionResponses 만 의미 있는 최소 응답 행. */
const answer = (questionResponses: Record<string, unknown>): SurveyResponse =>
  ({ id: `r${Math.random()}`, questionResponses, metadata: null, completedAt: null }) as unknown as SurveyResponse;

/**
 * 모든 응답이 지금 배포판으로 쓰였다는 뜻의 lookup. 버전이 하나뿐인 보통의 경우다.
 * 다중 버전은 아래 별도 describe 에서 버전별 lookup 을 준다.
 */
const asCurrent =
  (pool: readonly Question[]) => (_versionId: string | null, questionId: string) =>
    pool.find((q) => q.id === questionId) ?? null;

describe('buildDemandSummary', () => {
  const groups = [group('g1', 'A. 일반', 0), group('g2', 'B. 경영', 1)];
  const questions = [
    judgement('a1', 'g1', 0),
    opinionQ('a1', 'g1', 1),
    judgement('a2', 'g1', 2),
    judgement('b1', 'g2', 0),
    freeText('z1', 'g2', 1),
  ];

  it('판단 항목 하나가 한 줄이다 — 의견 짝 문항은 자기 행을 갖지 않는다', () => {
    // 그룹 소계 행도 넣지 않는다. 의견은 부모 행의 의견 칸으로 접힌다.
    const rows = buildDemandSummary(questions, groups, [], asCurrent(questions));
    expect(rows.map((r) => r.questionId)).toEqual(['a1', 'a2', 'b1', 'z1']);
  });

  it('짝이 안 맞는 _T 는 일반 문항으로 자기 행에 남는다 — 조용히 접지 않는다', () => {
    // 코드는 맞지만 부모 바로 뒤가 아니다. 관리자가 순서를 옮긴 경우다.
    const shifted = [judgement('a1', 'g1', 0), judgement('a2', 'g1', 1), opinionQ('a1', 'g1', 2)];
    const rows = buildDemandSummary(shifted, groups, [], asCurrent(shifted));
    expect(rows.map((r) => r.questionId)).toEqual(['a1', 'a2', 'a1-op']);
    expect(rows[2]?.needCount).toBeNull();
  });

  it('행 순서는 조사표 순서다 — 그룹 순서를 먼저 태운다', () => {
    const rows = buildDemandSummary(questions, [group('g2', 'B. 경영', 0), group('g1', 'A. 일반', 1)], [], asCurrent(questions));
    expect(rows.map((r) => r.questionId)).toEqual(['b1', 'z1', 'a1', 'a2']);
  });

  it('하위그룹이 부모 문항 앞에 오면 표 순서도 그렇다', () => {
    // 그룹 order 는 형제 범위 값이다. 전역 정렬하면 하위그룹이 엉뚱한 자리로 가고
    // 표·엑셀의 행 순서가 응답 화면과 갈린다.
    const nestedGroups = [
      group('h', 'H. 정책 인식', 0),
      { ...group('h1', '지원정책별', 0), parentGroupId: 'h' } as QuestionGroup,
    ];
    const nestedQuestions = [
      judgement('sub1', 'h1', 0),
      judgement('own1', 'h', 1),
      judgement('own2', 'h', 2),
    ];
    const rows = buildDemandSummary(nestedQuestions, nestedGroups, [], asCurrent(nestedQuestions));
    expect(rows.map((r) => r.questionId)).toEqual(['sub1', 'own1', 'own2']);
  });

  it('그룹은 묶음 축으로만 실린다 — 각 행이 자기 그룹 이름을 갖는다', () => {
    const rows = buildDemandSummary(questions, groups, [], asCurrent(questions));
    expect(rows[0]?.groupName).toBe('A. 일반');
    expect(rows[2]?.groupName).toBe('B. 경영');
  });

  it('필요 n · 불필요 n · 필요율을 낸다', () => {
    const responses = [
      answer({ a1: '1' }),
      answer({ a1: '1' }),
      answer({ a1: '2' }),
      answer({ a1: '1' }),
    ];
    const row = buildDemandSummary(questions, groups, responses, asCurrent(questions))[0]!;
    expect(row.needCount).toBe(3);
    expect(row.dropCount).toBe(1);
    expect(row.needRate).toBeCloseTo(75, 6);
  });

  it('아무도 답하지 않은 문항의 비율은 0 이 아니라 비어 있다', () => {
    const row = buildDemandSummary(questions, groups, [answer({ a2: '1' })], asCurrent(questions))[0]!;
    expect(row.needCount).toBe(0);
    expect(row.needRate).toBeNull();
  });

  it('판단 항목이 아닌 문항은 행을 남기고 비율 칸만 비운다', () => {
    // 표에서 빼면 조사표 순서가 끊겨 어디를 보는지 잃는다
    const row = buildDemandSummary(questions, groups, [answer({ z1: '자유 서술' })], asCurrent(questions))[3]!;
    expect(row.questionId).toBe('z1');
    expect(row.needCount).toBeNull();
    expect(row.dropCount).toBeNull();
    expect(row.needRate).toBeNull();
  });

  describe('의견은 짝 문항의 답에서 읽는다', () => {
    it('서술이 있는 의견만 센다', () => {
      const responses = [
        answer({ a1: '1', 'a1-op': 'B4 와 겹칩니다' }),
        answer({ a1: '2', 'a1-op': '표본이 작아 무의미' }),
        answer({ a1: '1' }),
      ];
      const row = buildDemandSummary(questions, groups, responses, asCurrent(questions))[0]!;
      expect(row.opinionCount).toBe(2);
      expect(row.opinions).toEqual(['B4 와 겹칩니다', '표본이 작아 무의미']);
    });

    it('공백만 있는 서술은 의견이 아니다', () => {
      const responses = [answer({ a1: '1', 'a1-op': '   ' }), answer({ a1: '1', 'a1-op': '' })];
      const row = buildDemandSummary(questions, groups, responses, asCurrent(questions))[0]!;
      expect(row.opinionCount).toBe(0);
    });

    it('의견은 판정과 직교한다 — 분모에 들어가지 않는다', () => {
      // 예전엔 의견이 세 번째 판정값이라 분모에만 들어가 필요율을 끌어내렸다.
      // 지금은 필요함을 고른 채로 의견을 적으므로 필요율은 판정만 본다.
      const responses = [
        answer({ a1: '1', 'a1-op': '겹침' }),
        answer({ a1: '2', 'a1-op': '축소 필요' }),
      ];
      const row = buildDemandSummary(questions, groups, responses, asCurrent(questions))[0]!;
      expect(row).toMatchObject({ needCount: 1, dropCount: 1, opinionCount: 2 });
      expect(row.needRate).toBe(50);
    });

    it('판정 없이 의견만 적은 응답은 의견으로만 센다', () => {
      // 화면은 판정을 필수로 막지만, 옛 데이터·관리자 편집으로 들어올 수 있다.
      const row = buildDemandSummary(questions, groups, [answer({ 'a1-op': '의견만' })], asCurrent(questions))[0]!;
      expect(row).toMatchObject({ needCount: 0, dropCount: 0, opinionCount: 1, needRate: null });
    });

    it('서술이 문자열이 아니면 건너뛴다 — 예외를 던지지 않는다', () => {
      const responses = [answer({ a1: '1', 'a1-op': 12 }), answer({ a1: '1', 'a1-op': { x: 1 } })];
      const row = buildDemandSummary(questions, groups, responses, asCurrent(questions))[0]!;
      expect(row.opinionCount).toBe(0);
    });
  });
});

describe('buildDemandSummary — 누적 집계 (여러 배포판)', () => {
  // 완료 응답은 재배포 뒤에도 자기 버전에 고정된다(ADR 0014). 지금 스냅샷 하나로
  // 옛 답을 읽으면 0 건이 되거나 반대 의미로 세어진다 — 여기서 막는다.
  const withVersion = (versionId: string | null, questionResponses: Record<string, unknown>) =>
    ({ ...answer(questionResponses), versionId }) as SurveyResponse;

  /** 선택지 값을 바꿔 발번한 버전. 문항 id 는 버전을 가로질러 그대로다. */
  const revalued = (id: string, need: string, drop: string): Question =>
    ({
      ...judgement(id, 'g1', 0),
      options: [
        { id: `${id}-need`, value: need, label: '필요함' },
        { id: `${id}-drop`, value: drop, label: '필요하지 않음' },
      ],
    }) as Question;

  const current = [judgement('a1', 'g1', 0), opinionQ('a1', 'g1', 1)];
  const groups = [group('g1', 'A. 일반', 0)];

  const twoVersions = (versionId: string | null, questionId: string) => {
    if (versionId === 'v1') return questionId === 'a1' ? revalued('a1', 'A', 'B') : null;
    if (versionId === 'v2') return current.find((q) => q.id === questionId) ?? null;
    return null;
  };

  it('버전마다 선택지 값이 달라도 자기 버전으로 읽어 합친다', () => {
    const [row] = buildDemandSummary(
      current,
      groups,
      [
        withVersion('v1', { a1: 'A' }), // 옛 버전의 '필요함'
        withVersion('v1', { a1: 'B' }), // 옛 버전의 '필요하지 않음'
        withVersion('v2', { a1: '1' }), // 지금 버전의 '필요함'
      ],
      twoVersions,
    );
    expect(row).toMatchObject({ needCount: 2, dropCount: 1, uncountedCount: 0 });
    expect(row?.needRate).toBeCloseTo((2 / 3) * 100);
  });

  it('옛 버전에서 값의 의미가 뒤집혔어도 반대로 세지 않는다', () => {
    // 지금 스냅샷 하나로 읽었다면 '1'=필요함 규칙이 옛 응답에도 적용돼
    // 필요하지 않음 2건이 필요함으로 뒤집힌다.
    const flipped = (versionId: string | null, questionId: string) =>
      versionId === 'v1'
        ? revalued('a1', '2', '1')
        : (current.find((q) => q.id === questionId) ?? null);
    const [row] = buildDemandSummary(
      current,
      groups,
      [withVersion('v1', { a1: '1' }), withVersion('v1', { a1: '1' }), withVersion('v2', { a1: '1' })],
      flipped,
    );
    expect(row).toMatchObject({ needCount: 1, dropCount: 2 });
  });

  it('의견은 버전과 무관하게 짝 문항 id 로 읽는다', () => {
    // 짝 문항도 평범한 문항이라 id 가 버전을 가로질러 유지된다. 선택지 값처럼
    // 버전마다 뜻이 바뀌는 것이 아니므로 as-of 를 거치지 않고 바로 읽는다.
    const [row] = buildDemandSummary(
      current,
      groups,
      [withVersion('v1', { a1: 'A', 'a1-op': '옛 의견' }), withVersion('v2', { a1: '1', 'a1-op': '지금 의견' })],
      twoVersions,
    );
    expect(row?.opinions).toEqual(['옛 의견', '지금 의견']);
    expect(row?.opinionCount).toBe(2);
  });

  it('옛 3지선다 버전의 답은 해석 불가로 센다 — 옛 규칙으로 조용히 읽지 않는다', () => {
    // 의견이 세 번째 판정값이던 시절의 응답. 그 모양은 더 이상 판단 항목이 아니므로
    // 필요/불필요 어느 쪽으로도 세지 않고 uncounted 에 남긴다.
    const legacy = (versionId: string | null, questionId: string) =>
      versionId === 'old'
        ? ({
            ...judgement('a1', 'g1', 0),
            options: [
              { id: 'x', value: '1', label: '필요함' },
              { id: 'y', value: '2', label: '필요하지 않음' },
              { id: 'z', value: '3', label: '의견', allowTextInput: true },
            ],
          } as Question)
        : (current.find((q) => q.id === questionId) ?? null);
    const [row] = buildDemandSummary(
      current,
      groups,
      [withVersion('old', { a1: '1' }), withVersion('old', { a1: '3' }), withVersion('v2', { a1: '1' })],
      legacy,
    );
    expect(row).toMatchObject({ needCount: 1, dropCount: 0, uncountedCount: 2 });
  });

  it('해석할 수 없는 버전의 답은 버리지 않고 uncounted 로 센다', () => {
    // 스냅샷이 정리된 버전(lookup 이 null) — 분모에도 분자에도 들어가지 않는다.
    const [row] = buildDemandSummary(
      current,
      groups,
      [withVersion('v0', { a1: '1' }), withVersion('v2', { a1: '1' })],
      twoVersions,
    );
    expect(row).toMatchObject({ needCount: 1, dropCount: 0, uncountedCount: 1 });
    expect(row?.needRate).toBe(100);
  });

  it('해석할 수 없는 버전이라도 답이 없으면 세지 않는다', () => {
    const [row] = buildDemandSummary(
      current,
      groups,
      [withVersion('v0', {}), withVersion('v2', { a1: '1' })],
      twoVersions,
    );
    expect(row?.uncountedCount).toBe(0);
  });
});

describe('sortByNeedRate', () => {
  const rows = [
    { needRate: 80, order: 0 },
    { needRate: null, order: 1 },
    { needRate: 20, order: 2 },
    { needRate: 50, order: 3 },
  ].map((r) => ({
    questionId: `q${r.order}`,
    questionCode: null,
    title: '',
    groupId: null,
    groupName: null,
    order: r.order,
    needCount: r.needRate === null ? null : 1,
    dropCount: r.needRate === null ? null : 1,
    needRate: r.needRate,
    opinionCount: 0,
    opinions: [],
    uncountedCount: 0,
  }));

  it('필요율 오름차순 — 뺄 후보가 위로 올라온다', () => {
    expect(sortByNeedRate(rows).map((r) => r.needRate)).toEqual([20, 50, 80, null]);
  });

  it('내림차순에서도 비율 없는 행은 뒤에 남는다', () => {
    expect(sortByNeedRate(rows, 'desc').map((r) => r.needRate)).toEqual([80, 50, 20, null]);
  });

  it('원본 배열을 변경하지 않는다', () => {
    const before = rows.map((r) => r.questionId);
    sortByNeedRate(rows);
    expect(rows.map((r) => r.questionId)).toEqual(before);
  });
});

describe('applyDemandView — 화면과 엑셀이 공유하는 상태', () => {
  const rows = buildDemandSummary(
    [
      judgement('a1', 'g1', 0),
      judgement('a2', 'g1', 1),
      judgement('b1', 'g2', 0),
    ],
    [group('g1', 'A. 일반', 0), group('g2', 'B. 경영', 1)],
    [answer({ a1: '2' }), answer({ a2: '1' }), answer({ b1: '1' })],
    asCurrent([judgement('a1', 'g1', 0), judgement('a2', 'g1', 1), judgement('b1', 'g2', 0)]),
  );

  it('조사표 순서가 기본이다', () => {
    expect(applyDemandView(rows, { sort: 'sheet', groupId: null }).map((r) => r.questionId)).toEqual(
      ['a1', 'a2', 'b1'],
    );
  });

  it('그룹 필터가 걸리면 그 그룹만 남는다', () => {
    expect(
      applyDemandView(rows, { sort: 'sheet', groupId: 'g2' }).map((r) => r.questionId),
    ).toEqual(['b1']);
  });

  it('필요율 낮은 순이면 뺄 후보가 위로 올라온다', () => {
    expect(
      applyDemandView(rows, { sort: 'need-asc', groupId: null }).map((r) => r.questionId)[0],
    ).toBe('a1');
  });

  it('필터와 정렬이 함께 걸린다', () => {
    expect(
      applyDemandView(rows, { sort: 'need-asc', groupId: 'g1' }).map((r) => r.questionId),
    ).toEqual(['a1', 'a2']);
  });
});

describe('parseDemandSortMode', () => {
  it('아는 값만 통과시키고 나머지는 조사표 순서로 떨어진다', () => {
    expect(parseDemandSortMode('need-asc')).toBe('need-asc');
    expect(parseDemandSortMode('need-desc')).toBe('need-desc');
    expect(parseDemandSortMode('sheet')).toBe('sheet');
    expect(parseDemandSortMode(null)).toBe('sheet');
    expect(parseDemandSortMode('drop table')).toBe('sheet');
  });
});
