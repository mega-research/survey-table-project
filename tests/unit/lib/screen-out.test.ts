import { describe, it, expect } from 'vitest';
import type { Question } from '@/types/survey';
import { detectScreenOut } from '@/server/survey-response/domain/screen-out';

/**
 * 자격미달 판정 — end 분기의 endOutcome 이 'screened_out' 일 때만 true.
 * 미지정 end 는 기존 설문 회귀 방지를 위해 반드시 false 여야 한다.
 */

function makeRadioQuestion(endOutcome?: 'completed' | 'screened_out'): Question {
  return {
    id: 'q-radio',
    surveyId: 's1',
    type: 'radio',
    title: 'B3',
    required: false,
    order: 0,
    options: [
      {
        id: 'opt-1',
        label: '1학년',
        value: 'option-1',
        branchRule: {
          id: 'br-1',
          value: '',
          action: 'end' as const,
          ...(endOutcome ? { endOutcome } : {}),
        },
      },
      { id: 'opt-2', label: '졸업자', value: 'option-2' },
    ],
  } as Question;
}

function makeTableQuestion(): Question {
  return {
    id: 'q-table',
    surveyId: 's1',
    type: 'table',
    title: 'B1',
    required: false,
    order: 1,
    tableColumns: [{ id: 'col-1', label: '보기' }],
    tableRowsData: [
      {
        id: 'row-1',
        label: '현재 학년',
        cells: [
          {
            id: 'cell-radio',
            content: '',
            type: 'radio' as const,
            radioOptions: [
              {
                id: 'uuid-opt-1',
                label: '1학년',
                value: 'option-1',
                branchRule: {
                  id: 'br-t1',
                  value: '',
                  action: 'end' as const,
                  endOutcome: 'screened_out' as const,
                },
              },
              { id: 'uuid-opt-2', label: '졸업자', value: 'option-4' },
            ],
          },
        ],
      },
    ],
  } as Question;
}

describe('detectScreenOut', () => {
  it('endOutcome 이 screened_out 인 end 분기가 트리거되면 true', () => {
    const q = makeRadioQuestion('screened_out');
    expect(detectScreenOut([q], { 'q-radio': 'option-1' })).toBe(true);
  });

  it('endOutcome 미지정 end 분기는 false — 기존 설문 회귀 방지', () => {
    const q = makeRadioQuestion();
    expect(detectScreenOut([q], { 'q-radio': 'option-1' })).toBe(false);
  });

  it('endOutcome 이 completed 인 end 분기는 false', () => {
    const q = makeRadioQuestion('completed');
    expect(detectScreenOut([q], { 'q-radio': 'option-1' })).toBe(false);
  });

  it('자격미달 규칙이 없는 선택지를 고르면 false', () => {
    const q = makeRadioQuestion('screened_out');
    expect(detectScreenOut([q], { 'q-radio': 'option-2' })).toBe(false);
  });

  it('응답이 없는 질문은 판정에 영향을 주지 않는다', () => {
    const q = makeRadioQuestion('screened_out');
    expect(detectScreenOut([q], {})).toBe(false);
  });

  it('테이블 셀 옵션의 branchRule 도 판정한다 — 운영 설문 B1 형태', () => {
    const q = makeTableQuestion();
    const responses = { 'q-table': { 'cell-radio': 'option-1' } };
    expect(detectScreenOut([q], responses)).toBe(true);
  });

  it('테이블 셀에서 졸업자를 고르면 false', () => {
    const q = makeTableQuestion();
    const responses = { 'q-table': { 'cell-radio': 'option-4' } };
    expect(detectScreenOut([q], responses)).toBe(false);
  });

  it('질문 목록이 비어 있으면 false', () => {
    expect(detectScreenOut([], { 'q-radio': 'option-1' })).toBe(false);
  });

  it('테이블 검증 규칙의 end 분기도 endOutcome 을 따른다', () => {
    const q = {
      id: 'q-validation',
      surveyId: 's1',
      type: 'table',
      title: 'B2',
      required: false,
      order: 2,
      tableColumns: [{ id: 'col-1', label: '보기' }],
      tableRowsData: [
        {
          id: 'row-1',
          label: '해당사항 없음',
          cells: [{ id: 'cell-1', content: '', type: 'checkbox' as const }],
        },
      ],
      tableValidationRules: [
        {
          id: 'rule-1',
          type: 'exclusive-check' as const,
          conditions: { checkType: 'checkbox' as const, rowIds: ['row-1'] },
          action: 'end' as const,
          endOutcome: 'screened_out' as const,
        },
      ],
    } as Question;

    expect(detectScreenOut([q], { 'q-validation': { 'cell-1': true } })).toBe(true);
  });

  it('표시 조건이 거짓인 질문의 잔존 답변은 판정에서 제외한다', () => {
    // 응답자가 Q2 에서 자격미달 옵션을 고른 뒤 이전 페이지로 돌아가 Q1 을 바꿔 Q2 가
    // 숨겨진 경우. 제출 페이로드에는 Q2 의 옛 답이 그대로 남으므로(클라이언트가 숨은
    // 질문의 답을 지우지 않는다), 판정도 표시 조건을 봐야 실제 도달 경로와 맞는다.
    const gate = {
      id: 'q-gate',
      surveyId: 's1',
      type: 'radio',
      title: 'A1',
      required: false,
      order: 0,
      options: [
        { id: 'g-1', label: '예', value: 'yes' },
        { id: 'g-2', label: '아니오', value: 'no' },
      ],
    } as Question;
    const gated = {
      ...makeRadioQuestion('screened_out'),
      id: 'q-gated',
      order: 1,
      displayCondition: {
        logicType: 'AND' as const,
        conditions: [
          {
            id: 'c-1',
            sourceQuestionId: 'q-gate',
            conditionType: 'value-match' as const,
            requiredValues: ['yes'],
          },
        ],
      },
    } as Question;

    const responses = { 'q-gate': 'no', 'q-gated': 'option-1' };
    expect(detectScreenOut([gate, gated], responses)).toBe(false);

    // 표시 조건이 참이면 그대로 자격미달.
    expect(detectScreenOut([gate, gated], { ...responses, 'q-gate': 'yes' })).toBe(true);
  });
});
