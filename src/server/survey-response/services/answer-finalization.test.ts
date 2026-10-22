import { describe, expect, it, vi } from 'vitest';

import { EMPTY_PII_TARGETS, isEncryptedAnswerValue } from '@/lib/crypto/response-pii';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import type { Question } from '@/types/survey';

import { type FinalizationMaterial, finalizeAnswers } from './answer-finalization';

vi.mock('@/db', () => ({ db: {} }));

/**
 * 응답 확정 — 순서·조합 계약.
 *
 * 세 저장 경로(complete 페이로드·빈 complete·관리자 수정)가 각자 들고 있던 순서 검사를 이 한 벌로
 * 옮겼다. 호출부 테스트는 "확정 결과를 저장하는가"만 본다.
 */

const hiddenByCtrl = (id: string, extra: Partial<Question> = {}): Question =>
  ({
    id,
    type: 'text',
    title: id,
    order: 9,
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: `${id}-c1`,
          enabled: true,
          logicType: 'AND',
          conditionType: 'value-match',
          sourceQuestionId: 'q-ctrl',
          requiredValues: ['yes'],
        },
      ],
    },
    ...extra,
  }) as Question;

const CTRL = { id: 'q-ctrl', type: 'radio', title: '상류', order: 0 } as Question;

/**
 * 순서 계약 픽스처 — 세 단계가 모두 할 일이 있다.
 *
 *   q-gate : gate_ctrl 이 채워져야 gate_val 이 활성
 *   q-vis  : gate_val 을 보는 표시 조건 → 숨은 문항 strip 이 게이팅보다 먼저여야 산다
 *   q-hid  : q-ctrl 로 숨는 표
 *   q-calc : q-hid·q-gate 셀의 합 → calc 이 두 strip 뒤여야 0
 */
const ORDER_QUESTIONS = [
  CTRL,
  {
    id: 'q-gate',
    type: 'table',
    title: '게이팅 표',
    order: 1,
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
    order: 2,
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: 'vis-c1',
          enabled: true,
          logicType: 'AND',
          conditionType: 'table-cell-check',
          sourceQuestionId: 'q-gate',
          tableConditions: {
            rowIds: ['r1'],
            cellColumnIndex: 1,
            checkType: 'any',
            expectedValues: ['7'],
          },
        },
      ],
    },
  },
  hiddenByCtrl('q-hid', {
    type: 'table',
    tableRowsData: [
      {
        id: 'hr1',
        label: 'hr1',
        cells: [{ id: 'hid_val', content: '', type: 'input', inputType: 'number' }],
      },
    ],
  } as Partial<Question>),
  {
    id: 'q-calc',
    type: 'table',
    title: '계산 표',
    order: 4,
    tableRowsData: [
      {
        id: 'cr1',
        label: 'cr1',
        cells: [
          {
            id: 'calc_out',
            content: '',
            type: 'calc',
            formula: {
              kind: 'agg',
              fn: 'sum',
              items: [
                { kind: 'cell', questionId: 'q-hid', cellId: 'hid_val' },
                { kind: 'cell', questionId: 'q-gate', cellId: 'gate_val' },
              ],
            },
          },
        ],
      },
    ],
  },
] as unknown as Question[];

const SCREEN_CTRL = {
  id: 'q-ctrl',
  type: 'radio',
  title: '학년',
  order: 0,
  options: [
    {
      id: 'opt-no',
      label: '1학년',
      value: 'no',
      branchRule: { id: 'br-1', value: '', action: 'end', endOutcome: 'screened_out' },
    },
    { id: 'opt-yes', label: '졸업자', value: 'yes' },
  ],
} as unknown as Question;

function material(
  questions: Question[],
  overrides: Partial<FinalizationMaterial> = {},
): FinalizationMaterial {
  return {
    snapshot: { questions } as unknown as SurveyVersionSnapshot,
    questions,
    groups: [],
    lookups: [],
    contactAttrs: {},
    piiTargets: EMPTY_PII_TARGETS,
    responseId: 'resp-1',
    ...overrides,
  };
}

describe('finalizeAnswers — 순서와 조합', () => {
  it('숨은 문항 strip → 게이팅 strip → calc 재계산 순서로 확정한다', () => {
    const { plain, changed } = finalizeAnswers(material(ORDER_QUESTIONS), {
      'q-ctrl': 'no',
      'q-gate': { gate_ctrl: '', gate_val: '7' },
      'q-vis': 'kept',
      'q-hid': { hid_val: '100' },
      'q-calc': { calc_out: '999' },
    });

    expect(plain['q-vis']).toBe('kept'); // 숨은 문항 strip 이 게이팅보다 먼저
    expect(plain['q-hid']).toBeUndefined(); // 숨은 문항 strip 이 돈다
    expect(plain['q-gate']).toEqual({ gate_ctrl: '' }); // 게이팅 strip 이 돈다
    expect((plain['q-calc'] as Record<string, unknown>)['calc_out']).toBe('0'); // calc 이 두 strip 뒤
    expect(changed).toBe(true);
  });

  it('표시 조건만 있는 설문도 숨은 문항 값을 지운다', () => {
    const { plain, changed } = finalizeAnswers(material([CTRL, hiddenByCtrl('q-hid')]), {
      'q-ctrl': 'no',
      'q-hid': '숨기 전에 적은 값',
    });

    expect(plain).toEqual({ 'q-ctrl': 'no' });
    expect(changed).toBe(true);
  });

  it('할 일이 없으면 받은 객체를 그대로 돌려주고 changed 가 거짓이다', () => {
    const input = { 'q-ctrl': 'yes', 'q-hid': '보이는 값' };
    const result = finalizeAnswers(material([CTRL, hiddenByCtrl('q-hid')]), input);

    expect(result.plain).toBe(input);
    expect(result.changed).toBe(false);
  });

  it('skipHiddenStrip 이면 숨은 문항은 남기고 게이팅·calc 은 그대로 돈다', () => {
    const { plain } = finalizeAnswers(
      material(ORDER_QUESTIONS),
      {
        'q-ctrl': 'no',
        'q-gate': { gate_ctrl: '', gate_val: '7' },
        'q-hid': { hid_val: '100' },
        'q-calc': { calc_out: '999' },
      },
      { skipHiddenStrip: true },
    );

    expect(plain['q-hid']).toEqual({ hid_val: '100' });
    expect(plain['q-gate']).toEqual({ gate_ctrl: '' });
    expect((plain['q-calc'] as Record<string, unknown>)['calc_out']).toBe('100');
  });

  it('스냅샷이 없으면 확정 단계를 건너뛰고 판정은 null — 암호화는 한다', () => {
    const input = { 'q-ctrl': 'no', 'q-hid': '값', 'q-pii': '010-1234-5678' };
    const result = finalizeAnswers(
      material([], {
        snapshot: null,
        piiTargets: { questionIds: new Set(['q-pii']), cellIds: new Map() },
      }),
      input,
    );

    expect(result.plain).toBe(input);
    expect(result.changed).toBe(false);
    expect(result.screenedOut).toBeNull();
    expect(isEncryptedAnswerValue(result.stored['q-pii'])).toBe(true);
  });
});

describe('finalizeAnswers — 사이드카', () => {
  it('등록되지 않은 __ 키는 버린다', () => {
    const { plain, changed } = finalizeAnswers(material([CTRL]), {
      'q-ctrl': 'yes',
      __unregistered__: { anything: 1 },
    });

    expect(plain).toEqual({ 'q-ctrl': 'yes' });
    expect(changed).toBe(true);
  });

  it('스냅샷에 없는 문항의 상세 기재 항목과 빈 사이드카는 버리고, 정돈된 사이드카는 그대로 둔다', () => {
    const input = {
      'q-ctrl': 'yes',
      __optTexts__: { 'q-ctrl': { 'opt-etc': '직접 입력' }, 'q-gone': { x: '유령' } },
      __changeConfirm__: {},
    };
    const { plain } = finalizeAnswers(material([CTRL]), input);

    expect(plain).toEqual({ 'q-ctrl': 'yes', __optTexts__: { 'q-ctrl': { 'opt-etc': '직접 입력' } } });

    const tidy = { 'q-ctrl': 'yes', __optTexts__: { 'q-ctrl': { 'opt-etc': '직접 입력' } } };
    expect(finalizeAnswers(material([CTRL]), tidy).plain).toBe(tidy);
  });
});

describe('finalizeAnswers — 자격미달 판정과 암호화', () => {
  it('확정 평문으로 판정한다', () => {
    expect(finalizeAnswers(material([SCREEN_CTRL]), { 'q-ctrl': 'no' }).screenedOut).toBe(true);
    expect(finalizeAnswers(material([SCREEN_CTRL]), { 'q-ctrl': 'yes' }).screenedOut).toBe(false);
  });

  it('숨어서 지워진 문항의 종료 분기는 판정에 걸리지 않는다', () => {
    const hiddenScreen = hiddenByCtrl('q-screen', {
      type: 'radio',
      options: [
        {
          id: 'o1',
          label: '해당',
          value: 'hit',
          branchRule: { id: 'br', value: '', action: 'end', endOutcome: 'screened_out' },
        },
      ],
    } as Partial<Question>);
    const result = finalizeAnswers(material([CTRL, hiddenScreen]), {
      'q-ctrl': 'no',
      'q-screen': 'hit',
    });

    expect(result.plain['q-screen']).toBeUndefined();
    expect(result.screenedOut).toBe(false);
  });

  it('저장값만 암호화하고 확정 평문은 평문으로 둔다', () => {
    const pii = { id: 'q-pii', type: 'text', title: '연락처', order: 1 } as Question;
    const result = finalizeAnswers(
      material([CTRL, pii], { piiTargets: { questionIds: new Set(['q-pii']), cellIds: new Map() } }),
      { 'q-ctrl': 'yes', 'q-pii': '010-1234-5678' },
    );

    expect(result.plain['q-pii']).toBe('010-1234-5678');
    expect(isEncryptedAnswerValue(result.stored['q-pii'])).toBe(true);
    expect(result.stored['q-ctrl']).toBe('yes');
  });
});

/**
 * 경로 밖 문항 — 분기 이동으로 건너뛴 페이지의 답.
 *
 *   1페이지 q-route : 'skip' → q-last 로 goto, 'out' → 자격미달 종료
 *   2페이지 q-mid   : 자격미달 보기를 가진 문항
 *   3페이지 q-last  : 평범한 문항 + 계산 표 q-sum (자기 셀을 그대로 옮기는 계산 칸)
 */
const ROUTE_QUESTIONS = [
  {
    id: 'q-route',
    type: 'radio',
    title: '경로',
    order: 0,
    options: [
      {
        id: 'opt-skip',
        label: '건너뛰기',
        value: 'skip',
        branchRule: { id: 'br-skip', value: '', action: 'goto', targetQuestionId: 'q-last' },
      },
      {
        id: 'opt-out',
        label: '대상 아님',
        value: 'out',
        branchRule: { id: 'br-out', value: '', action: 'end', endOutcome: 'screened_out' },
      },
      { id: 'opt-stay', label: '계속', value: 'stay' },
    ],
  },
  {
    id: 'q-mid',
    type: 'radio',
    title: '중간',
    order: 1,
    pageBreakBefore: true,
    options: [
      {
        id: 'opt-mid-out',
        label: '해당 없음',
        value: 'mid-out',
        branchRule: { id: 'br-mid', value: '', action: 'end', endOutcome: 'screened_out' },
      },
      { id: 'opt-mid-in', label: '해당', value: 'mid-in' },
    ],
  },
  { id: 'q-last', type: 'text', title: '끝', order: 2, pageBreakBefore: true },
  {
    id: 'q-sum',
    type: 'table',
    title: '합계 표',
    order: 3,
    tableRowsData: [
      {
        id: 'sr1',
        label: 'sr1',
        cells: [
          { id: 'sum_in', content: '', type: 'input', inputType: 'number' },
          {
            id: 'sum_out',
            content: '',
            type: 'calc',
            formula: { kind: 'cell', cellId: 'sum_in' },
          },
        ],
      },
    ],
  },
] as unknown as Question[];

describe('finalizeAnswers — 경로 밖 문항', () => {
  it('건너뛴 페이지에 남은 자격미달 보기는 지우고 완료로 판정한다', () => {
    const result = finalizeAnswers(material(ROUTE_QUESTIONS), {
      'q-route': 'skip',
      'q-mid': 'mid-out',
      'q-last': '답',
    });

    expect(result.plain['q-mid']).toBeUndefined();
    expect(result.plain['q-last']).toBe('답');
    expect(result.screenedOut).toBe(false);
    expect(result.changed).toBe(true);
  });

  it('첫 페이지에서 자격미달로 끝나면 뒤쪽 답을 지우고 계산 표에 값을 채우지 않는다', () => {
    const result = finalizeAnswers(material(ROUTE_QUESTIONS), {
      'q-route': 'out',
      'q-last': '전에 적은 답',
      'q-sum': { sum_out: '0' },
    });

    expect(result.plain).toEqual({ 'q-route': 'out' });
    expect(result.screenedOut).toBe(true);
  });

  it('경로 위 계산 표는 종전대로 채운다', () => {
    const result = finalizeAnswers(material(ROUTE_QUESTIONS), {
      'q-route': 'stay',
      'q-mid': 'mid-in',
      'q-sum': { sum_in: '4' },
    });

    expect(result.plain['q-sum']).toEqual({ sum_in: '4', sum_out: '4' });
    expect(result.screenedOut).toBe(false);
  });

  it('숨은 문항의 계산 표에는 값을 채우지 않는다', () => {
    const hiddenCalc = hiddenByCtrl('q-hcalc', {
      type: 'table',
      tableRowsData: [
        {
          id: 'hc1',
          label: 'hc1',
          cells: [
            { id: 'hc_in', content: '', type: 'input', inputType: 'number' },
            { id: 'hc_out', content: '', type: 'calc', formula: { kind: 'cell', cellId: 'hc_in' } },
          ],
        },
      ],
    } as Partial<Question>);
    const result = finalizeAnswers(material([CTRL, hiddenCalc]), { 'q-ctrl': 'no' });

    expect(result.plain).toEqual({ 'q-ctrl': 'no' });
    expect(result.changed).toBe(false);
  });

  it('문항 섞기 설문은 경로 밖 strip 을 건너뛴다', () => {
    const snapshot = {
      questions: ROUTE_QUESTIONS,
      settings: { shuffleQuestions: true },
    } as unknown as SurveyVersionSnapshot;
    const result = finalizeAnswers(material(ROUTE_QUESTIONS, { snapshot }), {
      'q-route': 'skip',
      'q-mid': 'mid-in',
      'q-last': '답',
    });

    expect(result.plain['q-mid']).toBe('mid-in');
  });

  it('구버전 이관(skipHiddenStrip)이면 경로 밖 답도 남긴다', () => {
    const result = finalizeAnswers(
      material(ROUTE_QUESTIONS),
      { 'q-route': 'skip', 'q-mid': 'mid-in', 'q-last': '답' },
      { skipHiddenStrip: true },
    );

    expect(result.plain['q-mid']).toBe('mid-in');
  });

  it('기록된 마지막 페이지가 계산한 경로 밖이면 건너뛴다', () => {
    const result = finalizeAnswers(
      material(ROUTE_QUESTIONS),
      { 'q-route': 'skip', 'q-mid': 'mid-in', 'q-last': '답' },
      { lastStepId: 'page:q-mid' },
    );

    expect(result.plain['q-mid']).toBe('mid-in');
  });
});
