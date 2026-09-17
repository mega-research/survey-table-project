import { describe, expect, it } from 'vitest';

import { detectScreenOut } from './screen-out';
import { getBranchRuleForResponse, shouldDisplayQuestion } from '@/utils/branch-logic';
import type { Question } from '@/types/survey';

/**
 * displayCondition · tableValidationRules JSONB 드리프트 방어.
 *
 * 두 컬럼 모두 도메인 zod 가 `z.custom` 이라 형태 검증이 없다. 배열이어야 할 자리가
 * 비어 있으면 evaluateConditionGroup / getTableValidationBranchRule 이 던지는데, 이 둘은
 * 응답자 페이지 렌더와 서버의 completeResponse 재평가가 공유하는 급소다. 여기서 죽으면
 * 응답 제출 자체가 막힌다.
 */
describe('표시 조건 드리프트', () => {
  const gated = {
    id: 'q-gated',
    surveyId: 's1',
    type: 'text',
    title: 'A1',
    required: false,
    order: 0,
    // conditions 키가 없는 저장분
    displayCondition: { logicType: 'AND' },
  } as unknown as Question;

  it('conditions 가 없으면 조건 없음으로 보고 표시한다', () => {
    expect(() => shouldDisplayQuestion(gated, {}, [gated])).not.toThrow();
    // 숨기는 쪽으로 폴백하면 응답자가 답해야 할 질문을 못 본다.
    expect(shouldDisplayQuestion(gated, {}, [gated])).toBe(true);
  });

  it('conditions 가 배열이 아니어도 표시한다', () => {
    const q = {
      ...gated,
      displayCondition: { logicType: 'OR', conditions: 'oops' },
    } as unknown as Question;
    expect(shouldDisplayQuestion(q, {}, [q])).toBe(true);
  });
});

describe('테이블 검증 규칙 드리프트', () => {
  function makeQuestion(conditions: unknown): Question {
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
          label: '해당 없음',
          cells: [{ id: 'cell-1', content: '', type: 'checkbox' }],
        },
      ],
      tableValidationRules: [
        { id: 'rule-1', type: 'exclusive-check', conditions, action: 'end' },
      ],
    } as unknown as Question;
  }

  it('conditions 가 없는 규칙은 미매칭으로 본다', () => {
    const q = makeQuestion(undefined);
    expect(() => getBranchRuleForResponse(q, { 'cell-1': true })).not.toThrow();
    expect(getBranchRuleForResponse(q, { 'cell-1': true })).toBeNull();
  });

  it('rowIds 가 없는 규칙도 미매칭으로 본다', () => {
    const q = makeQuestion({ checkType: 'checkbox' });
    expect(getBranchRuleForResponse(q, { 'cell-1': true })).toBeNull();
  });

  it('드리프트된 규칙이 있어도 자격미달 판정이 죽지 않는다', () => {
    const q = makeQuestion({ checkType: 'checkbox' });
    expect(() => detectScreenOut([q], { 'q-table': { 'cell-1': true } })).not.toThrow();
    expect(detectScreenOut([q], { 'q-table': { 'cell-1': true } })).toBe(false);
  });
});
