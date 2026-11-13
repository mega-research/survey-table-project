import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 축 단위 카드 — 설명 셀과 보기 칸이 여는 상세 입력(피지컬 AI 실태조사 A3: 적용 산업 | 판단 예시 | 공급(S) | 활용(U)).
 * 판단 예시(「바로 표시」)는 타일 글자 아래 설명으로, 「⑭ 기타」 내용 칸은 기타를 고른 타일 바로 아래에 선다.
 * 묶음 규칙은 utils/column-axis-cards.test.ts.
 */

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
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

const columns: TableColumn[] = [
  { id: 'name', label: '적용 산업', width: 330 },
  { id: 'example', label: '판단 예시', width: 468 },
  { id: 'supply', label: '공급(S)', width: 150 },
  { id: 'use', label: '활용(U)', width: 150 },
];
const groups: ChoiceGroup[] = [
  { id: 'gs', type: 'checkbox', label: '공급(S)', groupKey: 'chk01', required: false },
  { id: 'gu', type: 'checkbox', label: '활용(U)', groupKey: 'chk02', required: false },
];
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '제조 – 자동차·운송장비',
    cells: [
      { id: 'n1', type: 'text', content: '① 제조 – 자동차·운송장비' },
      { id: 'e1', type: 'text', content: '차량조립공정로봇', mobileDisplay: 'inline' },
      { id: 's1', type: 'choice_opt', content: '', choiceGroupId: 'gs', choiceLabel: '제조' },
      { id: 'u1', type: 'choice_opt', content: '', choiceGroupId: 'gu', choiceLabel: '제조' },
    ],
  },
  {
    id: 'r14',
    label: '⑭ 기타',
    cells: [
      {
        id: 'other-name',
        type: 'input',
        content: '⑭ 기타',
        textPosition: 'left',
        mobileLabel: '기타 산업명 직접 기입',
        enabledWhen: {
          kind: 'group',
          op: 'OR',
          terms: [
            { kind: 'choice-selected', controllerCellId: 's14' },
            { kind: 'choice-selected', controllerCellId: 'u14' },
          ],
        },
        requiredWhenEnabled: true,
      },
      { id: 'e14', type: 'text', content: '우주, 해양등', mobileDisplay: 'inline' },
      { id: 's14', type: 'choice_opt', content: '', choiceGroupId: 'gs', choiceLabel: '기타' },
      { id: 'u14', type: 'choice_opt', content: '', choiceGroupId: 'gu', choiceLabel: '기타' },
    ],
  },
];

function Harness({ onValue }: { onValue?: (value: Record<string, unknown>) => void }) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <InteractiveTableResponse
      questionId="q1"
      columns={columns}
      rows={rows}
      choiceGroups={groups}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
      mobileTableDisplayMode="axis-cards"
    />
  );
}

describe('축 단위 카드 — 설명 셀과 보기 칸이 여는 상세 입력', () => {
  it('열마다 카드가 서고, 타일 글자는 산업명·그 아래 설명은 판단 예시다. 첫 열 카드는 서지 않는다', () => {
    const { container } = render(<Harness />);
    const tiles = container.querySelectorAll('[data-cell-id="s1"], [data-cell-id="u1"]');
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(within(tile as HTMLElement).getByText('① 제조 – 자동차·운송장비')).toBeTruthy();
      expect(within(tile as HTMLElement).getByTestId('choice-tile-description').textContent).toBe('차량조립공정로봇');
    }
    // 「⑭ 기타」 타일 — 제목은 행 이름, 설명은 판단 예시
    const other = container.querySelector<HTMLElement>('[data-cell-id="s14"]')!;
    expect(within(other).getByText('⑭ 기타')).toBeTruthy();
    expect(within(other).getByTestId('choice-tile-description').textContent).toBe('우주, 해양등');
    // 기타 내용 칸은 아무 것도 고르지 않았으면 어디에도 없다(첫 열 카드도 없다)
    expect(container.querySelector('[data-detail-cell-id="other-name"]')).toBeNull();
    expect(container.querySelector('[data-cell-id="other-name"]')).toBeNull();
    expect(screen.queryByPlaceholderText('기타 산업명 직접 기입')).toBeNull();
  });

  it('공급(S)의 기타를 고르면 그 타일 아래에만 기타 내용 칸이 열리고, 적은 값은 그 칸 id 로 써진다', () => {
    let last: Record<string, unknown> = {};
    const { container } = render(<Harness onValue={(v) => (last = v)} />);
    const supplyOther = container.querySelector<HTMLElement>('[data-cell-id="s14"]')!;
    const useOther = container.querySelector<HTMLElement>('[data-cell-id="u14"]')!;
    fireEvent.click(within(supplyOther).getByRole('checkbox'));
    const detail = supplyOther.querySelector<HTMLElement>('[data-detail-cell-id="other-name"]');
    expect(detail).not.toBeNull();
    expect(useOther.querySelector('[data-detail-cell-id="other-name"]')).toBeNull();
    const field = within(detail!).getByPlaceholderText('기타 산업명 직접 기입');
    fireEvent.change(field, { target: { value: '우주' } });
    fireEvent.blur(field);
    expect(last['other-name']).toBe('우주');
    // 활용(U)의 기타도 고르면 그 타일 아래에도 같은 값으로 보인다
    fireEvent.click(within(useOther).getByRole('checkbox'));
    const second = useOther.querySelector<HTMLElement>('[data-detail-cell-id="other-name"]')!;
    expect((within(second).getByPlaceholderText('기타 산업명 직접 기입') as HTMLInputElement).value).toBe('우주');
  });
});
