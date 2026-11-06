import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import { QuestionInput } from '@/features/survey-response/question-input';
import type { Question } from '@/types/survey';

/**
 * 경고만 하는 표 제약의 배선 — 차단 검증과 같은 평가 컨텍스트(명단 값·참조표)로 경고를 계산해 표에 넘긴다.
 * 명단 값을 빠뜨리면 attr 수식이 평가 불능으로 건너뛰어 경고가 조용히 사라진다(2026-11-05 리뷰).
 */
const captured: { softWarnings?: readonly string[] }[] = [];

vi.mock('@/features/question-renderer/interactive-table-response', () => ({
  InteractiveTableResponse: (props: { softWarnings?: readonly string[] }) => {
    captured.push(props);
    return <div data-testid="table" />;
  },
}));

const question = {
  id: 'q1',
  type: 'table',
  title: '표',
  required: false,
  order: 0,
  tableColumns: [{ id: 'col-1', label: '수량' }],
  tableRowsData: [
    { id: 'r1', label: '행', cells: [{ id: 'c1', type: 'input', content: '', inputType: 'number' }] },
  ],
  sumConstraints: [
    {
      id: 'warn-attr',
      cellIds: [],
      leftExpr: { kind: 'cell', cellId: 'c1' },
      operator: 'lte',
      target: 0,
      targetExpr: { kind: 'attr', attrsKey: '기준수량' },
      severity: 'warn',
      errorMessage: '명단 기준보다 많아요',
    },
  ],
} as unknown as Question;

function lastWarnings(attrs: Record<string, string>, value: Record<string, unknown>) {
  captured.length = 0;
  render(
    <ContactAttrsProvider attrs={attrs}>
      <QuestionInput
        question={question}
        value={value}
        onChange={() => {}}
        allResponses={{ q1: value }}
        allQuestions={[question]}
      />
    </ContactAttrsProvider>,
  );
  return captured[captured.length - 1]!.softWarnings;
}

describe('QuestionInput — 경고 제약 평가 컨텍스트', () => {
  it('명단 값을 기준으로 한 경고 제약이 걸리면 표에 경고를 넘긴다', () => {
    expect(lastWarnings({ 기준수량: '10' }, { c1: '20' })).toEqual(['명단 기준보다 많아요']);
    expect(lastWarnings({ 기준수량: '10' }, { c1: '5' })).toEqual([]);
  });
});
