import { describe, it, expect } from 'vitest';
import type { Question } from '@/types/survey';
import { detectScreenOut } from '@/lib/survey-response/screen-out';

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
});
