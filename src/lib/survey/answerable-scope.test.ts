import { describe, expect, it } from 'vitest';

import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import type { Question } from '@/types/survey';

import {
  QUOTE_CONDITION_QUESTIONS,
  QUOTE_CONTACT_ATTRS,
  quoteFromOptionResponses,
  quoteFromOtherTextResponses,
} from '../../../tests/helpers/answer-quote-condition-survey';

import {
  type AnswerableScopeMaterial,
  pruneToAnswerableScope,
  scopeMaterialFromSnapshot,
} from './answerable-scope';

/**
 * 답할 수 있는 범위 — 응답 확정·Raw 내보내기가 같이 쓰는 판정의 계약.
 *
 * 순서(숨은 문항 → 경로 밖, 둘을 고정점까지 → 게이팅)와 범위 안 문항의 정의를 여기서 한 벌로 본다.
 * 호출자 테스트는 이 결과 위에 얹는 것(계산 칸·사이드카·자격미달·암호화, 내보내기 대상 선별)만 본다.
 */

function material(
  questions: Question[],
  overrides: Partial<AnswerableScopeMaterial> = {},
): AnswerableScopeMaterial {
  return { questions, groups: [], lookups: [], settings: null, contactAttrs: {}, ...overrides };
}

const valueMatch = (id: string, sourceQuestionId: string, value: string) => ({
  logicType: 'AND' as const,
  conditions: [
    {
      id,
      enabled: true,
      logicType: 'AND' as const,
      conditionType: 'value-match' as const,
      sourceQuestionId,
      requiredValues: [value],
    },
  ],
});

const CTRL = { id: 'q-ctrl', type: 'radio', title: '상류', order: 0 } as Question;
const HIDDEN = {
  id: 'q-hid',
  type: 'text',
  title: '상류가 yes 일 때만',
  order: 1,
  displayCondition: valueMatch('hid-c1', 'q-ctrl', 'yes'),
} as Question;

/**
 *   q-gate : gate_ctrl 이 채워져야 gate_val 이 활성
 *   q-vis  : gate_val 을 보는 표시 조건 — 숨은 문항 지우기가 게이팅보다 먼저라 산다
 */
const GATE_QUESTIONS = [
  CTRL,
  HIDDEN,
  {
    id: 'q-gate',
    type: 'table',
    title: '게이팅 표',
    order: 2,
    tableRowsData: [
      {
        id: 'r1',
        label: 'r1',
        cells: [
          { id: 'gate_ctrl', content: '', type: 'input', inputType: 'number' },
          {
            id: 'gate_val',
            content: '',
            type: 'input',
            inputType: 'number',
            enabledWhen: { kind: 'filled', controllerCellId: 'gate_ctrl' },
          },
        ],
      },
    ],
  },
  {
    id: 'q-vis',
    type: 'radio',
    title: '게이팅 셀을 보는 문항',
    order: 3,
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: 'vis-c1',
          enabled: true,
          logicType: 'AND',
          conditionType: 'table-cell-check',
          sourceQuestionId: 'q-gate',
          tableConditions: { rowIds: ['r1'], cellColumnIndex: 1, checkType: 'any', expectedValues: ['7'] },
        },
      ],
    },
  },
] as unknown as Question[];

/** 1페이지 q-route('skip' → q-last 로 goto) / 2페이지 q-mid / 3페이지 q-last */
const ROUTE_QUESTIONS = [
  {
    id: 'q-route',
    type: 'radio',
    title: '경로',
    order: 0,
    options: [
      {
        id: 'o-skip',
        label: '건너뛰기',
        value: 'skip',
        branchRule: { id: 'b1', value: '', action: 'goto', targetQuestionId: 'q-last' },
      },
      { id: 'o-stay', label: '계속', value: 'stay' },
    ],
  },
  { id: 'q-mid', type: 'text', title: '중간', order: 1, pageBreakBefore: true },
  { id: 'q-last', type: 'text', title: '끝', order: 2, pageBreakBefore: true },
] as unknown as Question[];

describe('scopeMaterialFromSnapshot', () => {
  it('스냅샷이 없거나 문항이 배열이 아니면 null — 「구조가 깨졌다」와 「질문이 없다」를 가른다', () => {
    expect(scopeMaterialFromSnapshot(null, {})).toBeNull();
    expect(scopeMaterialFromSnapshot(undefined, {})).toBeNull();
    expect(
      scopeMaterialFromSnapshot({ questions: 'broken' } as unknown as SurveyVersionSnapshot, {}),
    ).toBeNull();
  });

  it('문항이 빈 배열이면 재료가 있다 — 지울 것이 없을 뿐이다', () => {
    expect(scopeMaterialFromSnapshot({ questions: [] } as unknown as SurveyVersionSnapshot, {})).toEqual(
      material([]),
    );
  });

  it('그룹·LUT 이 배열이 아니면 빈 배열로, 설정은 객체일 때만 싣고 명단 값을 얹는다', () => {
    const snapshot = {
      questions: [CTRL],
      groups: 'x',
      lookups: null,
      settings: { shuffleQuestions: true },
    } as unknown as SurveyVersionSnapshot;
    expect(scopeMaterialFromSnapshot(snapshot, { 지역: '서울' })).toEqual(
      material([CTRL], { settings: { shuffleQuestions: true }, contactAttrs: { 지역: '서울' } }),
    );
  });
});

describe('pruneToAnswerableScope — 순서', () => {
  it('숨은 문항을 지운 뒤 게이팅으로 닫힌 칸을 지운다 — 게이팅이 지울 값을 숨은 문항 판정은 본다', () => {
    const { responses, inScopeQuestionIds } = pruneToAnswerableScope(material(GATE_QUESTIONS), {
      'q-ctrl': 'no',
      'q-hid': '숨기 전에 적은 값',
      'q-gate': { gate_ctrl: '', gate_val: '7' },
      'q-vis': 'kept',
    });

    expect(responses).toEqual({ 'q-ctrl': 'no', 'q-gate': { gate_ctrl: '' }, 'q-vis': 'kept' });
    expect([...inScopeQuestionIds].sort()).toEqual(['q-ctrl', 'q-gate', 'q-vis']);
  });

  it('지울 것이 없으면 받은 객체를 그대로 돌려준다', () => {
    const input = { 'q-ctrl': 'yes', 'q-hid': '보이는 값' };
    expect(pruneToAnswerableScope(material([CTRL, HIDDEN]), input).responses).toBe(input);
  });

  it('명단 값을 읽는 조건은 재료의 명단 값으로 푼다', () => {
    const byAttr = {
      id: 'q-dep',
      type: 'text',
      title: '본조사 참여자에게만',
      order: 0,
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c1',
            enabled: true,
            logicType: 'AND',
            conditionType: 'expression',
            sourceQuestionId: '',
            expressionConfig: {
              clauses: [
                {
                  kind: 'comparison',
                  comparison: {
                    op: '==',
                    left: { kind: 'attr', attrsKey: '25년 조사 방법' },
                    right: { kind: 'literal', value: '본조사' },
                  },
                },
              ],
              joinOps: [],
            },
          },
        ],
      },
    } as unknown as Question;

    const { responses } = pruneToAnswerableScope(
      material([byAttr], { contactAttrs: { '25년 조사 방법': '2차 자료' } }),
      { 'q-dep': '2차 자료 대상자에게 남은 값' },
    );
    expect(responses).toEqual({});
  });

  it('pruneHidden: false 면 숨은 값은 남기고 닫힌 칸만 지운다 — 구버전 이관', () => {
    const result = pruneToAnswerableScope(
      material(GATE_QUESTIONS),
      { 'q-ctrl': 'no', 'q-hid': '값', 'q-gate': { gate_ctrl: '', gate_val: '7' } },
      { pruneHidden: false },
    );

    expect(result.responses).toEqual({ 'q-ctrl': 'no', 'q-hid': '값', 'q-gate': { gate_ctrl: '' } });
    expect(result.inScopeQuestionIds.has('q-hid')).toBe(false);
    expect(result.inScopeQuestionIds.has('q-ctrl')).toBe(true);
  });

  it('pruneHidden: false 는 경로 밖 답도 남기고 범위는 보이는 문항 전부다', () => {
    const input = { 'q-route': 'skip', 'q-mid': 'mid', 'q-last': '답' };
    const result = pruneToAnswerableScope(material(ROUTE_QUESTIONS), input, { pruneHidden: false });

    expect(result.responses).toBe(input);
    expect([...result.inScopeQuestionIds].sort()).toEqual(['q-last', 'q-mid', 'q-route']);
  });
});

describe('pruneToAnswerableScope — 경로 밖 문항', () => {
  it('건너뛴 페이지의 답을 지우고 범위에서 뺀다', () => {
    const result = pruneToAnswerableScope(material(ROUTE_QUESTIONS), {
      'q-route': 'skip',
      'q-mid': '전에 적은 답',
      'q-last': '답',
    });

    expect(result.responses).toEqual({ 'q-route': 'skip', 'q-last': '답' });
    expect([...result.inScopeQuestionIds].sort()).toEqual(['q-last', 'q-route']);
    expect(result.pathSkipped).toBeNull();
  });

  it('진행 중 응답이 아직 가지 않은 뒤쪽 경로 페이지의 답은 남긴다', () => {
    const input = { 'q-route': 'stay', 'q-last': '미리 적은 답' };
    const result = pruneToAnswerableScope(material(ROUTE_QUESTIONS), input, {
      lastStepId: 'page:q-route',
    });
    expect(result.responses).toBe(input);
  });

  it('문항 섞기 설문은 경로를 믿지 않는다 — 범위는 보이는 문항 전부', () => {
    const input = { 'q-route': 'skip', 'q-mid': '답', 'q-last': '답' };
    const result = pruneToAnswerableScope(
      material(ROUTE_QUESTIONS, { settings: { shuffleQuestions: true } }),
      input,
    );

    expect(result.responses).toBe(input);
    expect(result.pathSkipped).toBe('shuffle');
    expect([...result.inScopeQuestionIds].sort()).toEqual(['q-last', 'q-mid', 'q-route']);
  });

  it('기록된 마지막 페이지가 계산한 경로 밖이면 건너뛴다', () => {
    const input = { 'q-route': 'skip', 'q-mid': '답' };
    const result = pruneToAnswerableScope(material(ROUTE_QUESTIONS), input, {
      lastStepId: 'page:q-mid',
    });

    expect(result.responses).toBe(input);
    expect(result.pathSkipped).toBe('last-step-off-path');
  });
});

describe('pruneToAnswerableScope — 응답 인용값을 읽는 조건', () => {
  // 응답 화면은 명단 값 위에 응답 인용값을 얹어 조건을 푼다 — 명단 `지역=서울`, 인용값 `부산`.
  const quoteMaterial = (questions: Question[] = QUOTE_CONDITION_QUESTIONS) =>
    material(questions, { contactAttrs: QUOTE_CONTACT_ATTRS });

  it.each([
    ['보기 문구', quoteFromOptionResponses],
    ['기타 상세 기재', quoteFromOtherTextResponses],
  ])('인용값(%s)으로 보이는 열·행·문항의 답을 지우지 않는다', (_label, payload) => {
    const input = payload();
    expect(pruneToAnswerableScope(quoteMaterial(), input).responses).toBe(input);
  });

  it('인용값의 출처 문항이 숨어 지워지면 인용값을 다시 계산해 그 값을 읽던 답도 지운다', () => {
    const gate = {
      id: 'q-gate',
      type: 'radio',
      title: '부산 질문 여부',
      order: -1,
      options: [
        { id: 'opt-y', label: '예', value: 'yes' },
        { id: 'opt-n', label: '아니오', value: 'no' },
      ],
    } as unknown as Question;
    const [src, tbl, dep] = QUOTE_CONDITION_QUESTIONS;
    const gatedSrc = { ...src!, displayCondition: valueMatch('src-c1', 'q-gate', 'yes') } as Question;

    const { responses } = pruneToAnswerableScope(quoteMaterial([gate, gatedSrc, tbl!, dep!]), {
      'q-gate': 'no',
      ...quoteFromOptionResponses(),
    });

    expect(responses['q-src']).toBeUndefined();
    expect(responses['q-dep']).toBeUndefined();
    expect(responses['q-tbl']).toEqual({ 'c-all-a': '1' });
  });
});
