import { describe, it, expect } from 'vitest';
import type { Question } from '@/types/survey';
import { getBranchRuleForResponse } from '@/utils/branch-logic';

/**
 * 회귀 테스트: 테이블 셀 옵션 branchRule 의 응답값 매칭
 *
 * 인터랙티브 셀(radio/select/checkbox-cell.tsx)은 응답값으로
 * `option.value ?? option.id` 를 저장한다. 과거 getBranchRuleForTable 은
 * `option.id` 로만 옵션을 찾아서, 옵션에 value 가 지정된 경우(빌더 응답값 입력 시)
 * branchRule(설문 종료/질문 이동)이 영원히 매칭되지 않았다.
 */

function makeTableQuestion(): Question {
  return {
    id: 'q-table',
    surveyId: 's1',
    type: 'table',
    title: 'B1',
    required: false,
    order: 0,
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
                branchRule: { id: 'br-1', value: '', action: 'end' as const },
              },
              { id: 'uuid-opt-2', label: '4학년', value: 'option-2' },
            ],
          },
          {
            id: 'cell-check',
            content: '',
            type: 'checkbox' as const,
            checkboxOptions: [
              {
                id: 'uuid-chk-1',
                label: '해당',
                value: 'chk-1',
                branchRule: { id: 'br-2', value: '', action: 'end' as const },
              },
            ],
          },
          {
            id: 'cell-select',
            content: '',
            type: 'select' as const,
            selectOptions: [
              {
                id: 'uuid-sel-1',
                label: '종료 보기',
                value: 'sel-1',
                branchRule: { id: 'br-3', value: '', action: 'end' as const },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Question;
}

describe('테이블 셀 branchRule — 저장값(option.value ?? option.id) 매칭', () => {
  const question = makeTableQuestion();

  it('radio 셀: value 로 저장된 응답에서 branchRule 을 찾는다', () => {
    const rule = getBranchRuleForResponse(question, { 'cell-radio': 'option-1' });
    expect(rule?.action).toBe('end');
  });

  it('radio 셀: value 가 없어 id 로 저장된 레거시 응답도 계속 매칭된다', () => {
    const rule = getBranchRuleForResponse(question, { 'cell-radio': 'uuid-opt-1' });
    expect(rule?.action).toBe('end');
  });

  it('radio 셀: branchRule 없는 옵션 선택 시 null', () => {
    const rule = getBranchRuleForResponse(question, { 'cell-radio': 'option-2' });
    expect(rule).toBeNull();
  });

  it('checkbox 셀: value 배열로 저장된 응답에서 branchRule 을 찾는다', () => {
    const rule = getBranchRuleForResponse(question, { 'cell-check': ['chk-1'] });
    expect(rule?.action).toBe('end');
  });

  it('select 셀: value 로 저장된 응답에서 branchRule 을 찾는다', () => {
    const rule = getBranchRuleForResponse(question, { 'cell-select': 'sel-1' });
    expect(rule?.action).toBe('end');
  });
});
