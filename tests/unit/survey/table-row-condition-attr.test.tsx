/**
 * 표 행 조건의 attr 피연산자.
 *
 * 응답 화면의 행 필터는 `shouldDisplayRow` 를 evalCtx 없이 불러서 `attr('...')` 이 항상
 * undefined 였다. 그래서 `2025_상태 != '취업'` 같은 조건이 무조건 참이 되고, OR 로 묶인
 * 행이 전부 표시됐다 — 실사 중이던 BQ1-1 이 "이직 안 함(②)" 응답자에게도 전 행을 폈다.
 *
 * 제출 경로(use-response-lifecycle)는 evalCtx 를 넘기고 있어서 화면과 제출 판정이
 * 어긋나 있었다. 렌더 경로가 같은 ctx 를 쓰는지 여기서 지킨다.
 */
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { InteractiveTableResponse } from '@/components/survey-builder/interactive-table-response';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import { evaluateQuestionConditionGroup } from '@/utils/branch-logic';
import type { Question, QuestionConditionGroup, TableColumn, TableRow } from '@/types/survey';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => false,
  useMediaQuery: () => false,
}));

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const SOURCE_Q = 'q-bq1';

/** BQ1 = ①(옵션1) 이거나 2025_상태 가 '취업' 이 아니면 표시. */
const rowCondition: QuestionConditionGroup = {
  logicType: 'OR',
  conditions: [
    {
      id: 'c1',
      name: '조건 1',
      enabled: true,
      logicType: 'AND',
      conditionType: 'value-match',
      requiredValues: ['옵션1'],
      sourceQuestionId: SOURCE_Q,
    },
    {
      id: 'c2',
      name: '조건 2',
      enabled: true,
      logicType: 'AND',
      conditionType: 'expression',
      expressionConfig: {
        clauses: [
          {
            kind: 'comparison',
            comparison: {
              op: '!=',
              left: { kind: 'attr', attrsKey: '2025_상태' },
              right: { kind: 'literal', value: '취업' },
            },
          },
        ],
        joinOps: [],
      },
      sourceQuestionId: SOURCE_Q,
    },
  ],
} as unknown as QuestionConditionGroup;

const columns: TableColumn[] = [
  { id: 'c0', label: '항목', width: 150 },
  { id: 'c1', label: '값', width: 300 },
] as unknown as TableColumn[];

const rows: TableRow[] = [
  {
    id: 'row-company',
    cells: [
      { id: 'row-company-0', type: 'text', content: '기업명' },
      { id: 'row-company-1', type: 'input' },
    ],
    displayCondition: rowCondition,
  },
  {
    id: 'row-field',
    cells: [
      { id: 'row-field-0', type: 'text', content: '업무 분야' },
      { id: 'row-field-1', type: 'input' },
    ],
  },
] as unknown as TableRow[];

const sourceQuestion = {
  id: SOURCE_Q,
  type: 'radio',
  title: '이직 여부',
  required: false,
  order: 0,
  options: [
    { value: '옵션1', label: '① 있다' },
    { value: '옵션2', label: '② 없다' },
  ],
} as unknown as Question;

function renderTable(attrs: Record<string, string>) {
  return render(
    <ContactAttrsProvider attrs={attrs}>
      <InteractiveTableResponse
        questionId="q-bq1-1"
        columns={columns}
        rows={rows}
        allResponses={{ [SOURCE_Q]: '옵션2' }}
        allQuestions={[sourceQuestion]}
      />
    </ContactAttrsProvider>,
  );
}

describe('표 행 조건의 attr 피연산자', () => {
  it('2025_상태 가 취업이면 BQ1=② 응답자에게 기업명 행을 숨긴다', () => {
    renderTable({ '2025_상태': '취업' });
    expect(screen.queryByText('기업명')).not.toBeInTheDocument();
    expect(screen.getByText('업무 분야')).toBeInTheDocument();
  });

  it('2025_상태 가 취업이 아니면 기업명 행을 표시한다', () => {
    renderTable({ '2025_상태': '창업' });
    expect(screen.getByText('기업명')).toBeInTheDocument();
  });

  it('attrs 가 비면 fail-safe 로 표시한다 — 빌더 미리보기 경로', () => {
    renderTable({});
    expect(screen.getByText('기업명')).toBeInTheDocument();
  });
});

/**
 * 빈 조건 목록.
 *
 * 빌더에서 조건을 모두 지우면 `{logicType, conditions: []}` 가 남는다. OR 는 some([]) 이
 * false 라 그 문항·행이 아무에게도 안 나온다 — 발행된 DQ2 가 실제로 그렇게 죽었다.
 * AND 는 every([]) 가 true 라 우연히 맞았을 뿐이므로 세 결합을 함께 못 박는다.
 */
describe('빈 조건 목록은 조건 없음과 같다', () => {
  const responses = {};
  const questions: Question[] = [];
  const ctx = { responses: {}, contactAttrs: {}, lookups: [] };

  it.each(['AND', 'OR', 'NOT'] as const)('%s 결합에서 표시한다', (logicType) => {
    expect(
      evaluateQuestionConditionGroup({ logicType, conditions: [] }, responses, questions, ctx),
    ).toBe(true);
  });

  it('조건이 전부 비활성이어도 표시한다', () => {
    expect(
      evaluateQuestionConditionGroup(
        {
          logicType: 'OR',
          conditions: [
            {
              id: 'c1',
              enabled: false,
              logicType: 'AND',
              conditionType: 'value-match',
              requiredValues: ['옵션1'],
              sourceQuestionId: SOURCE_Q,
            },
          ],
        } as never,
        responses,
        questions,
        ctx,
      ),
    ).toBe(true);
  });
});
