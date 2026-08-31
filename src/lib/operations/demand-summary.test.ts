import { describe, expect, it } from 'vitest';

import type { SurveyResponse } from '@/db/schema';
import type { Question, QuestionGroup } from '@/types/survey';

import { buildDemandSummary, resolveJudgementShape, sortByNeedRate } from './demand-summary';

const group = (id: string, name: string, order: number): QuestionGroup =>
  ({ id, surveyId: 's', name, order }) as QuestionGroup;

/** 판단 항목 — 필요함 / 필요하지 않음 / 의견(기타입력) */
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
      { id: `${id}-op`, value: '3', label: '의견', allowTextInput: true },
    ],
  }) as Question;

const freeText = (id: string, groupId: string | null, order: number): Question =>
  ({ id, type: 'textarea', title: `${id} 종합 의견`, required: false, order, ...(groupId ? { groupId } : {}) }) as Question;

/** questionResponses 만 의미 있는 최소 응답 행. */
const answer = (questionResponses: Record<string, unknown>): SurveyResponse =>
  ({ id: `r${Math.random()}`, questionResponses, metadata: null, completedAt: null }) as unknown as SurveyResponse;

const opinion = (questionId: string, optionId: string, text: string) => ({
  [questionId]: '3',
  __optTexts__: { [questionId]: { [optionId]: text } },
});

describe('resolveJudgementShape', () => {
  it('선택지 셋 중 하나가 기타입력인 단일선택을 판단 항목으로 본다', () => {
    expect(resolveJudgementShape(judgement('a1', null, 0))).toEqual({
      needValue: '1',
      dropValue: '2',
      opinionValue: '3',
      opinionOptionId: 'a1-op',
    });
  });

  it('장문형은 판단 항목이 아니다', () => {
    expect(resolveJudgementShape(freeText('z1', null, 0))).toBeNull();
  });

  it('선택지가 둘이면 판단 항목이 아니다 — 의견 칸이 없다', () => {
    const two = judgement('a1', null, 0);
    expect(
      resolveJudgementShape({ ...two, options: (two.options ?? []).slice(0, 2) } as Question),
    ).toBeNull();
  });

  it('기타입력이 둘이면 어느 쪽이 의견인지 정할 수 없다', () => {
    const q = judgement('a1', null, 0);
    const options = (q.options ?? []).map((o) => ({ ...o, allowTextInput: true }));
    expect(resolveJudgementShape({ ...q, options } as Question)).toBeNull();
  });
});

describe('buildDemandSummary', () => {
  const groups = [group('g1', 'A. 일반', 0), group('g2', 'B. 경영', 1)];
  const questions = [
    judgement('a1', 'g1', 0),
    judgement('a2', 'g1', 1),
    judgement('b1', 'g2', 0),
    freeText('z1', 'g2', 1),
  ];

  it('문항 하나가 한 줄이다 — 그룹 소계 행을 넣지 않는다', () => {
    const rows = buildDemandSummary(questions, groups, []);
    expect(rows).toHaveLength(questions.length);
    expect(rows.map((r) => r.questionId)).toEqual(['a1', 'a2', 'b1', 'z1']);
  });

  it('행 순서는 조사표 순서다 — 그룹 순서를 먼저 태운다', () => {
    const rows = buildDemandSummary(questions, [group('g2', 'B. 경영', 0), group('g1', 'A. 일반', 1)], []);
    expect(rows.map((r) => r.questionId)).toEqual(['b1', 'z1', 'a1', 'a2']);
  });

  it('그룹은 묶음 축으로만 실린다 — 각 행이 자기 그룹 이름을 갖는다', () => {
    const rows = buildDemandSummary(questions, groups, []);
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
    const row = buildDemandSummary(questions, groups, responses)[0]!;
    expect(row.needCount).toBe(3);
    expect(row.dropCount).toBe(1);
    expect(row.needRate).toBeCloseTo(75, 6);
  });

  it('아무도 답하지 않은 문항의 비율은 0 이 아니라 비어 있다', () => {
    const row = buildDemandSummary(questions, groups, [answer({ a2: '1' })])[0]!;
    expect(row.needCount).toBe(0);
    expect(row.needRate).toBeNull();
  });

  it('3지선다 radio 가 아닌 문항은 행을 남기고 비율 칸만 비운다', () => {
    // 표에서 빼면 조사표 순서가 끊겨 어디를 보는지 잃는다
    const row = buildDemandSummary(questions, groups, [answer({ z1: '자유 서술' })])[3]!;
    expect(row.questionId).toBe('z1');
    expect(row.needCount).toBeNull();
    expect(row.dropCount).toBeNull();
    expect(row.needRate).toBeNull();
  });

  describe('의견은 옵션 텍스트 사이드카에서 읽는다', () => {
    it('서술이 있는 의견만 센다', () => {
      const responses = [
        answer(opinion('a1', 'a1-op', 'B4 와 겹칩니다')),
        answer(opinion('a1', 'a1-op', '표본이 작아 무의미')),
        answer({ a1: '1' }),
      ];
      const row = buildDemandSummary(questions, groups, responses)[0]!;
      expect(row.opinionCount).toBe(2);
      expect(row.opinions).toEqual(['B4 와 겹칩니다', '표본이 작아 무의미']);
    });

    it('의견을 골라놓고 서술이 비면 답으로 치지 않는다', () => {
      // 응답 화면의 판정과 같은 규칙 — 분모에도 들어가지 않는다
      const responses = [
        answer(opinion('a1', 'a1-op', '   ')),
        answer({ a1: '3' }),
        answer({ a1: '1' }),
      ];
      const row = buildDemandSummary(questions, groups, responses)[0]!;
      expect(row.opinionCount).toBe(0);
      expect(row.needRate).toBeCloseTo(100, 6);
    });

    it('사이드카가 없거나 모양이 다르면 건너뛴다 — 예외를 던지지 않는다', () => {
      const responses = [
        answer({ a1: '3' }),
        answer({ a1: '3', __optTexts__: 'not-an-object' }),
        answer({ a1: '3', __optTexts__: { a1: 'not-an-object' } }),
      ];
      const row = buildDemandSummary(questions, groups, responses)[0]!;
      expect(row.opinionCount).toBe(0);
    });

    it('사이드카 예약 키는 문항 행이 되지 않는다', () => {
      // 실존 질문 id 가 아니므로 표에 줄이 생기면 안 된다
      const rows = buildDemandSummary(questions, groups, [answer(opinion('a1', 'a1-op', '겹침'))]);
      expect(rows.map((r) => r.questionId)).not.toContain('__optTexts__');
    });

    it('의견도 분모에 들어간다', () => {
      const responses = [
        answer({ a1: '1' }),
        answer({ a1: '2' }),
        answer(opinion('a1', 'a1-op', '겹침')),
        answer(opinion('a1', 'a1-op', '축소 필요')),
      ];
      const row = buildDemandSummary(questions, groups, responses)[0]!;
      expect(row.needRate).toBeCloseTo(25, 6);
    });
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
