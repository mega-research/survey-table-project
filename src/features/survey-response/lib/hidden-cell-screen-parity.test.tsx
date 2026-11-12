/**
 * 화면의 「보이는 칸」과 차단 검증의 「보이는 칸」이 같은 집합인가.
 *
 * 화면(InteractiveTableResponse 가 `GatingTableCellsProvider` 로 공급하는 `visibleCellIds`)은 중복 불가
 * 묶음의 구성원과 따라 선택이 건너뛸 칸을 정하고, 차단 검증(`collectVisibleTableCells`)은 「다음」을 막을
 * 칸을 정한다. 둘은 따로 계산한다 — 렌더러는 응답 feature 를 import 할 수 없다. 갈리면 「고를 수
 * 있었는데 다음에서 막힘」·「보이는데 따라 선택이 건너뜀」이 된다. 2026-11-12 에 실제로 갈려 있었다:
 * 데스크톱은 동적 행을 본문 격자 밖에 그려, 본문 행으로만 뽑은 화면 쪽 집합에 고른 동적 행이 없었다.
 *
 * 숨기는 장치는 차단 검증 표와 같은 시나리오(`tests/helpers/hidden-cell-scenarios`)를 쓴다 — 장치를 등록부에
 * 더하면 tsc 가 시나리오를 요구하고, 그 시나리오가 여기서도 돈다.
 */
import { render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { InteractiveTableResponse } from '@/features/question-renderer/interactive-table-response';

import { collectVisibleTableCells } from './numeric-validation';
import {
  HELPER,
  MECHANISMS,
  type Scenario,
  TARGET,
  type ValidatorCase,
  q0,
  select,
} from '../../../../tests/helpers/hidden-cell-scenarios';

const view = vi.hoisted(() => ({ mobile: false }));
const captured = vi.hoisted(() => ({ visibleCellIds: undefined as ReadonlySet<string> | null | undefined }));

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => view.mobile,
  useMediaQuery: () => view.mobile,
}));
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));
// 화면이 공급하는 집합을 그대로 받아 적는다 — 공급자 본체는 원본 그대로 그린다.
vi.mock('@/features/question-renderer/cells/gating-table-cells-context', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/features/question-renderer/cells/gating-table-cells-context')
    >();
  return {
    ...original,
    GatingTableCellsProvider: (props: Parameters<typeof original.GatingTableCellsProvider>[0]) => {
      captured.visibleCellIds = props.visibleCellIds;
      return original.GatingTableCellsProvider(props);
    },
  };
});

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

afterEach(() => {
  view.mobile = false;
  captured.visibleCellIds = undefined;
});

// 화면은 중복 불가 묶음(또는 따라 선택)이 있는 표에서만 집합을 만든다 — 대상 칸과 도우미 칸을 한 묶음에 둔다.
const distinctPair: ValidatorCase = {
  name: '중복 불가 묶음',
  target: select(TARGET, 'd'),
  helper: select(HELPER, 'd'),
  helperValue: 'a',
};

/** 응답 페이지(question-input 의 table 분기)가 넘기는 것과 같은 props 로 그려 화면 쪽 집합을 받는다. */
function screenVisibleIds({ question, values, allResponses }: Scenario): string[] {
  render(
    <InteractiveTableResponse
      questionId={question.id}
      columns={question.tableColumns}
      rows={question.tableRowsData}
      value={values}
      onChange={() => {}}
      allResponses={{ ...allResponses, [question.id]: values }}
      allQuestions={[q0, question]}
      dynamicRowConfigs={question.dynamicRowConfigs}
      rowRepeatConfig={question.rowRepeatConfig}
      stagedRowsConfig={question.stagedRowsConfig}
      enableSticky={false}
    />,
  );
  expect(
    captured.visibleCellIds,
    '화면이 보이는 칸 집합을 공급하지 않았다 — 시나리오에 중복 불가 묶음이 빠졌거나 공급 자리가 바뀌었다',
  ).toBeInstanceOf(Set);
  return [...(captured.visibleCellIds as ReadonlySet<string>)].sort();
}

function validationVisibleIds({ question, values, allResponses }: Scenario): string[] {
  return collectVisibleTableCells(question, values, {
    allResponses: { ...allResponses, [question.id]: values },
    allQuestions: [q0, question],
  })
    .map((cell) => cell.id)
    .sort();
}

describe.each(Object.entries(MECHANISMS))('%s', (_name, mechanism) => {
  describe.each([
    ['데스크톱', false],
    ['모바일', true],
  ] as const)('%s', (_viewName, mobile) => {
    it.each([
      ['숨었을 때', true],
      ['보일 때', false],
    ] as const)('%s 화면과 차단 검증이 같은 칸을 본다', (_state, hidden) => {
      view.mobile = mobile;
      const scenario = mechanism.build(distinctPair, hidden);

      const validation = validationVisibleIds(scenario);
      // 시나리오가 실제로 대상 칸을 숨기고 보이는지 — 빈 대조로 통과하지 않게
      expect(validation.includes(TARGET)).toBe(!hidden);
      expect(screenVisibleIds(scenario)).toEqual(validation);
    });
  });
});
