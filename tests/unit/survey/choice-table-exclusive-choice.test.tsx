/**
 * 레거시 보기 소스 표(checkbox 문항 + choice_opt 셀)의 단독 선택 보기 (CONTEXT.md).
 * 비그룹 문항은 문항 전체가 한 그룹이고, 그룹 문항은 같은 그룹 안에서만 민다.
 */
import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import type { Question } from '@/types/survey';

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

function ungroupedQuestion(): Question {
  return {
    id: 'q1',
    type: 'checkbox',
    title: '보유 제품',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'c0', label: '항목', width: 200 },
      { id: 'c1', label: '선택', width: 100 },
    ],
    tableRowsData: [
      { id: 'r1', cells: [{ id: 'r1c0', type: 'text', content: 'TV' }, { id: 'tv', type: 'choice_opt', content: '' }] },
      { id: 'r2', cells: [{ id: 'r2c0', type: 'text', content: '냉장고' }, { id: 'fridge', type: 'choice_opt', content: '' }] },
      {
        id: 'r3',
        cells: [
          { id: 'r3c0', type: 'text', content: '없음' },
          { id: 'none', type: 'choice_opt', content: '', exclusiveChoice: true },
        ],
      },
    ],
  } as Question;
}

function groupedQuestion(): Question {
  return {
    ...ungroupedQuestion(),
    choiceGroups: [
      { id: 'g1', groupKey: 'cb1', type: 'checkbox', label: '현재' },
      { id: 'g2', groupKey: 'cb2', type: 'checkbox', label: '계획' },
    ],
    tableColumns: [
      { id: 'c0', label: '항목', width: 200 },
      { id: 'c1', label: '현재', width: 100 },
      { id: 'c2', label: '계획', width: 100 },
    ],
    tableRowsData: [
      {
        id: 'r1',
        cells: [
          { id: 'r1c0', type: 'text', content: 'TV' },
          { id: 'tv-now', type: 'choice_opt', content: '', choiceGroupId: 'g1' },
          { id: 'tv-plan', type: 'choice_opt', content: '', choiceGroupId: 'g2' },
        ],
      },
      {
        id: 'r3',
        cells: [
          { id: 'r3c0', type: 'text', content: '없음' },
          { id: 'r3c1', type: 'text', content: '-' },
          { id: 'none-plan', type: 'choice_opt', content: '', choiceGroupId: 'g2', exclusiveChoice: true },
        ],
      },
    ],
  } as Question;
}

function Harness({ question }: { question: Question }) {
  const [value, setValue] = useState<unknown>(null);
  return (
    <>
      <ChoiceTableResponse question={question} value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const readValue = () => JSON.parse(screen.getByTestId('value').textContent ?? 'null');

describe('레거시 보기 소스 표 — 단독 선택 보기', () => {
  it('비그룹 checkbox: 「없음」을 고르면 나머지가 풀리고, 일반 보기를 고르면 「없음」이 풀린다', async () => {
    const user = userEvent.setup();
    render(<Harness question={ungroupedQuestion()} />);
    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]!);
    await user.click(boxes[1]!);
    await user.click(boxes[2]!);
    expect(readValue()).toEqual(['none']);

    await user.click(boxes[0]!);
    expect(readValue()).toEqual(['tv']);
  });

  it('그룹 checkbox: 「없음」은 자기 그룹만 비우고 다른 그룹은 건드리지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness question={groupedQuestion()} />);
    const boxes = screen.getAllByRole('checkbox');
    // 순서: tv-now, tv-plan, none-plan
    await user.click(boxes[0]!);
    await user.click(boxes[1]!);
    await user.click(boxes[2]!);
    expect(readValue()).toEqual({ cb1: ['tv-now'], cb2: ['none-plan'] });
  });

  it('비그룹 checkbox: 최대 선택 수에 꽉 찬 상태에서도 「없음」은 들어간다', async () => {
    const user = userEvent.setup();
    render(<Harness question={{ ...ungroupedQuestion(), maxSelections: 2 } as Question} />);
    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]!);
    await user.click(boxes[1]!);
    await user.click(boxes[2]!);
    expect(readValue()).toEqual(['none']);
  });
});
