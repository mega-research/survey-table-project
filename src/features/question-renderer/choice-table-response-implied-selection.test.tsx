/**
 * 보기 소스 표(체크박스·라디오 문항의 내장 표)의 따라 선택 (CONTEXT.md "따라 선택").
 * 그룹 없는 체크박스 문항은 문항 전체가 한 묶음이고, 그룹 문항은 체크박스 그룹끼리 건다.
 * 규칙은 테이블 유형 문항과 같은 함수(utils/implied-selection)다.
 */
import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/features/question-renderer/choice-table-response';
import type { Question, TableCell } from '@/types/survey';

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

const opt = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content: '',
  ...extra,
});
const row = (id: string, title: string, ...cells: TableCell[]) => ({
  id,
  cells: [{ id: `${id}-title`, type: 'text' as const, content: title }, ...cells],
});

/** 그룹 없는 체크박스 문항 — 세트 상품을 고르면 그 안의 단품이 함께 골라진다 */
function ungroupedQuestion(extra: Partial<Question> = {}): Question {
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
      row('r1', '세트', opt('set', { impliedCellIds: ['tv'] })),
      row('r2', 'TV', opt('tv', { impliedCellIds: ['remote'] })),
      row('r3', '리모컨', opt('remote')),
      row('r4', '냉장고', opt('fridge')),
      row('r5', '없음', opt('none', { exclusiveChoice: true })),
    ],
    ...extra,
  } as Question;
}

/** 그룹 문항 — 열마다 체크박스 그룹(알고 있음 · 이용한 적 있음), 이용 → 알고 */
function groupedQuestion(): Question {
  return {
    id: 'q1',
    type: 'checkbox',
    title: '제도 인지·이용',
    required: false,
    order: 0,
    choiceGroups: [
      { id: 'g-know', groupKey: 'cb1', type: 'checkbox', label: '알고 있음' },
      { id: 'g-use', groupKey: 'cb2', type: 'checkbox', label: '이용한 적 있음' },
    ],
    tableColumns: [
      { id: 'c0', label: '항목', width: 200 },
      { id: 'c1', label: '알고 있음', width: 100 },
      { id: 'c2', label: '이용한 적 있음', width: 100 },
    ],
    tableRowsData: [
      row(
        'r1',
        '제도 A',
        opt('know-a', { choiceGroupId: 'g-know' }),
        opt('use-a', { choiceGroupId: 'g-use', impliedCellIds: ['know-a'] }),
      ),
      row(
        'r2',
        '모름',
        opt('know-none', { choiceGroupId: 'g-know', exclusiveChoice: true }),
        { id: 'r2-pad', type: 'text', content: '-' },
      ),
    ],
  } as Question;
}

function Harness({ question, initial = null }: { question: Question; initial?: unknown }) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <>
      <ChoiceTableResponse question={question} value={value} onChange={setValue} />
      {/* output 요소는 역할이 status 라 안내 줄과 겹친다 */}
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  );
}

const readValue = () => JSON.parse(screen.getByTestId('value').textContent ?? 'null');
// 그려지는 순서 = 표 순서
const boxAt = (index: number) => screen.getAllByRole('checkbox')[index]!;

describe('보기 소스 표 — 그룹 없는 체크박스 문항의 따라 선택', () => {
  it('보기를 고르면 걸린 보기가 사슬 끝까지 함께 골라진다', async () => {
    const user = userEvent.setup();
    render(<Harness question={ungroupedQuestion()} />);
    await user.click(boxAt(0));
    expect(readValue()).toEqual(['set', 'tv', 'remote']);
    expect(boxAt(1)).toBeChecked();
    expect(boxAt(2)).toBeChecked();
    expect(boxAt(3)).not.toBeChecked();
  });

  it('풀 때는 누른 보기 하나만 풀린다', async () => {
    const user = userEvent.setup();
    render(<Harness question={ungroupedQuestion()} initial={['set', 'tv', 'remote']} />);
    await user.click(boxAt(1));
    expect(readValue()).toEqual(['set', 'remote']);
  });

  it('「없음」이 골라진 채 고르면 「없음」이 풀리고 따라 선택도 된다', async () => {
    const user = userEvent.setup();
    render(<Harness question={ungroupedQuestion()} initial={['none']} />);
    await user.click(boxAt(1));
    expect(readValue()).toEqual(['tv', 'remote']);
  });

  it('짝이 없는 보기는 그것만 골라진다', async () => {
    const user = userEvent.setup();
    render(<Harness question={ungroupedQuestion()} />);
    await user.click(boxAt(3));
    expect(readValue()).toEqual(['fridge']);
  });

  it('라디오 문항에서는 짝이 적혀 있어도 따라 선택이 없다', async () => {
    const user = userEvent.setup();
    render(<Harness question={ungroupedQuestion({ type: 'radio' })} />);
    await user.click(screen.getAllByRole('radio')[0]!);
    expect(readValue()).toBe('set');
  });
});

describe('보기 소스 표 — 최대 선택 수', () => {
  it('함께 골라질 보기까지 넣어 상한 안이면 그대로 들어간다', async () => {
    const user = userEvent.setup();
    render(<Harness question={ungroupedQuestion({ maxSelections: 3 })} />);
    await user.click(boxAt(0));
    expect(readValue()).toEqual(['set', 'tv', 'remote']);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('함께 골라질 보기까지 넣으면 상한을 넘을 때는 누른 보기도 받지 않고 안내한다', async () => {
    const user = userEvent.setup();
    render(<Harness question={ungroupedQuestion({ maxSelections: 3 })} initial={['fridge']} />);
    await user.click(boxAt(0));
    expect(readValue()).toEqual(['fridge']);
    expect(boxAt(0)).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent(
      '이 보기는 다른 보기와 함께 선택되어 최대 3개를 넘습니다. 선택한 보기를 먼저 풀어 주세요.',
    );
  });

  it('안내는 다음 선택이 들어가면 사라진다', async () => {
    const user = userEvent.setup();
    render(<Harness question={ungroupedQuestion({ maxSelections: 3 })} initial={['fridge']} />);
    await user.click(boxAt(0));
    expect(screen.getByRole('status')).toBeInTheDocument();
    await user.click(boxAt(2));
    expect(readValue()).toEqual(['fridge', 'remote']);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('이미 골라져 있는 보기는 상한에 다시 세지 않는다', async () => {
    const user = userEvent.setup();
    render(
      <Harness question={ungroupedQuestion({ maxSelections: 3 })} initial={['tv', 'remote']} />,
    );
    await user.click(boxAt(0));
    expect(readValue()).toEqual(['tv', 'remote', 'set']);
  });
});

describe('보기 소스 표 — 그룹 문항의 따라 선택', () => {
  it('한 그룹의 보기를 고르면 다른 그룹의 걸린 보기가 함께 골라진다', async () => {
    const user = userEvent.setup();
    render(<Harness question={groupedQuestion()} />);
    // 순서: know-a, use-a, know-none
    await user.click(boxAt(1));
    expect(readValue()).toEqual({ cb2: ['use-a'], cb1: ['know-a'] });
  });

  it('따라 골라지는 그룹의 「모름」은 풀린다', async () => {
    const user = userEvent.setup();
    render(<Harness question={groupedQuestion()} initial={{ cb1: ['know-none'] }} />);
    await user.click(boxAt(1));
    expect(readValue()).toEqual({ cb1: ['know-a'], cb2: ['use-a'] });
  });

  it('풀 때는 누른 보기 하나만 풀린다', async () => {
    const user = userEvent.setup();
    render(
      <Harness question={groupedQuestion()} initial={{ cb1: ['know-a'], cb2: ['use-a'] }} />,
    );
    await user.click(boxAt(1));
    expect(readValue()).toEqual({ cb1: ['know-a'] });
  });
});
