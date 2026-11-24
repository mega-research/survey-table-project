import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import type { ChoiceGroup, TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  ariaReferenceIds,
  ariaReferenceTexts,
  resolveAriaReferences,
} from '../../../tests/helpers/aria-references';
import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 표 문항 — 척도 슬라이더 라디오 묶음의 낭독 이름과 오류 문구(CONTEXT.md 「척도 슬라이더」).
 *
 * 화면에 보이는 행 제목이 슬라이더 묶음의 이름이고(한 행에 응답 묶음이 여럿이면 「행 제목, 묶음 이름」),
 * 필수인데 답하지 않은 줄에서는 그 행의 낭독용 오류 문구가 설명으로 이어진다. 행 단위 배치(넓은 폭 · 좁은 폭)
 * 와 「행 단위 그룹 카드」 둘 다 본다. 가리키는 id 는 전부 문서에 있어야 한다 — 헬퍼가 없는 id 에서 던진다.
 *
 * jsdom 은 배치를 계산하지 않으므로 트랙 범위는 테스트가 준다(왼쪽 100px · 폭 500px, 눈금 5개).
 */

const view = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => view.mobile,
  useMediaQuery: () => view.mobile,
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
afterEach(() => {
  view.mobile = false;
});

const NAMES = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
const CIRC = ['①', '②', '③', '④', '⑤'];

// 구분 | 활용 여부 2칸 | 만족도 5칸
const columns: TableColumn[] = [
  { id: 'item', label: '구분', width: 190 },
  { id: 'use1', label: '활용함', width: 70 },
  { id: 'use2', label: '활용 안함', width: 70 },
  ...NAMES.map((label, n) => ({ id: `s${n}`, label, width: 80 })),
];

function scaleRow(id: string, title: string): TableRow {
  return {
    id,
    label: title,
    cells: [
      { id: `${id}-item`, type: 'text', content: title },
      ...['활용함', '활용 안함'].map(
        (choiceLabel, n): TableCell => ({
          id: `${id}-use${n + 1}`,
          type: 'choice_opt',
          content: CIRC[n]!,
          choiceLabel,
          choiceGroupId: `g-use-${id}`,
        }),
      ),
      ...CIRC.map(
        (content, n): TableCell => ({
          id: `${id}-sat${n}`,
          type: 'choice_opt',
          content,
          choiceLabel: NAMES[n]!,
          choiceGroupId: `g-sat-${id}`,
        }),
      ),
    ],
  };
}

const rows: TableRow[] = [scaleRow('r1', '1) 주차/접근성'), scaleRow('r2', '2) 도보통행 편의성')];
/** 활용 여부 열을 뺀 표 — 행마다 응답 묶음이 만족도 하나뿐이다 */
const onlyScaleRows = rows.map((row) => ({ ...row, cells: [row.cells[0]!, ...row.cells.slice(3)] }));
const onlyScaleColumns = [columns[0]!, ...columns.slice(3)];

const groupsOf = (tableRows: TableRow[], useGroup: Partial<ChoiceGroup>): ChoiceGroup[] =>
  tableRows.flatMap((row) => [
    ...(row.cells.some((cell) => cell.choiceGroupId === `g-use-${row.id}`)
      ? [
          {
            id: `g-use-${row.id}`,
            groupKey: `use_${row.id}`,
            type: 'radio' as const,
            label: '활용 여부',
            ...useGroup,
          },
        ]
      : []),
    {
      id: `g-sat-${row.id}`,
      groupKey: `sat_${row.id}`,
      type: 'radio' as const,
      label: '만족도',
      scaleSlider: 'positive-right' as const,
    },
  ]);

/** 그 행 만족도 묶음의 보기 칸 — 미충족 필수 묶음이 오류 칸 집합에 실리는 모양 그대로 */
const satisfactionCellIds = (rowId: string) => CIRC.map((_, n) => `${rowId}-sat${n}`);

interface HarnessProps {
  tableRows?: TableRow[];
  tableColumns?: TableColumn[];
  useGroup?: Partial<ChoiceGroup>;
  mode?: MobileTableDisplayMode;
  /** 필수인데 답하지 않은 것으로 볼 행 — 답하면 호스트(문항 카드)가 하듯 오류 칸 집합에서 빠진다 */
  requiredRowIds?: string[];
}

function Harness({
  tableRows = rows,
  tableColumns = columns,
  useGroup = {},
  mode,
  requiredRowIds = [],
}: HarnessProps) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  const answered = (value.__choiceGroups ?? {}) as Record<string, unknown>;
  const errorCellIds = new Set(
    requiredRowIds
      .filter((rowId) => answered[`sat_${rowId}`] === undefined)
      .flatMap(satisfactionCellIds),
  );
  return (
    <InteractiveTableResponse
      questionId="q1"
      columns={tableColumns}
      rows={tableRows}
      choiceGroups={groupsOf(tableRows, useGroup)}
      mobileDrilldownOmitLeadingColumns={1}
      {...(mode ? { mobileTableDisplayMode: mode } : {})}
      {...(errorCellIds.size > 0 ? { errorCellIds } : {})}
      value={value}
      onChange={setValue}
    />
  );
}

const rowBlock = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`)!;
const sliderGroup = (rowId: string) =>
  within(screen.getByTestId(`scale-slider-g-sat-${rowId}`)).getByRole('radiogroup');

function pressTick(rowId: string, tickIndex: number) {
  const track = within(screen.getByTestId(`scale-slider-g-sat-${rowId}`)).getByTestId(
    'scale-slider-track',
  );
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 600,
    width: 500,
    top: 0,
    bottom: 32,
    height: 32,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  const x = 150 + 100 * tickIndex;
  fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX: x });
  fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX: x });
}

describe.each([
  ['넓은 폭', false],
  ['좁은 폭', true],
] as const)('표 문항 — 행 단위 배치의 슬라이더 이름(%s)', (_name, mobile) => {
  it('행에 응답 묶음이 하나뿐이면 보이는 행 제목이 슬라이더 묶음의 이름이다', () => {
    view.mobile = mobile;
    render(<Harness tableRows={onlyScaleRows} tableColumns={onlyScaleColumns} />);
    for (const row of rows) {
      const group = sliderGroup(row.id);
      const [title] = resolveAriaReferences(group, 'aria-labelledby');
      // 화면에 보이는 그 행 제목 요소다 — 글자를 따로 받지 않는다
      expect(title).toBe(within(rowBlock(row.id)).getByRole('heading', { name: row.label }));
      expect(ariaReferenceIds(group, 'aria-labelledby')).toHaveLength(1);
      expect(group).not.toHaveAttribute('aria-label');
      expect(within(rowBlock(row.id)).getByRole('radiogroup', { name: row.label })).toBe(group);
    }
  });

  it('행에 응답 묶음이 여럿이면 「행 제목, 묶음 이름」 순서로 읽힌다', () => {
    view.mobile = mobile;
    render(<Harness />);
    const group = sliderGroup('r1');
    expect(ariaReferenceTexts(group, 'aria-labelledby')).toEqual(['1) 주차/접근성', '만족도']);
    expect(group).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('radiogroup', { name: '1) 주차/접근성 만족도' })).toBe(group);
    // 행마다 제 제목을 가리킨다 — 묶음 이름이 같아도 이름이 갈린다
    expect(ariaReferenceTexts(sliderGroup('r2'), 'aria-labelledby')).toEqual([
      '2) 도보통행 편의성',
      '만족도',
    ]);
  });

  it('행 블록과 슬라이더 묶음이 같은 제목 요소를 가리킨다', () => {
    view.mobile = mobile;
    render(<Harness tableRows={onlyScaleRows} tableColumns={onlyScaleColumns} />);
    const block = rowBlock('r1');
    expect(block).toHaveAttribute('role', 'group');
    expect(sliderGroup('r1').getAttribute('aria-labelledby')).toBe(
      block.getAttribute('aria-labelledby'),
    );
  });

  it('필수인데 답하지 않은 행에서는 그 행의 오류 문구가 이어지고, 답하면 풀린다', () => {
    view.mobile = mobile;
    render(<Harness requiredRowIds={['r2']} />);
    const group = sliderGroup('r2');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(ariaReferenceTexts(group, 'aria-describedby')).toEqual([
      '2) 도보통행 편의성의 응답을 확인해 주세요.',
    ]);
    expect(rowBlock('r2')).toContainElement(resolveAriaReferences(group, 'aria-describedby')[0]!);
    // 걸리지 않은 행은 잇지 않는다
    expect(sliderGroup('r1')).not.toHaveAttribute('aria-describedby');

    pressTick('r2', 3);
    expect(sliderGroup('r2')).not.toHaveAttribute('aria-invalid');
    expect(sliderGroup('r2')).not.toHaveAttribute('aria-describedby');
    // 이름은 그대로 서 있다
    expect(ariaReferenceTexts(sliderGroup('r2'), 'aria-labelledby')).toEqual([
      '2) 도보통행 편의성',
      '만족도',
    ]);
  });

  it('같은 행의 다른 칸만 걸렸으면 슬라이더에는 오류 문구를 잇지 않는다', () => {
    view.mobile = mobile;
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        choiceGroups={groupsOf(rows, {})}
        mobileDrilldownOmitLeadingColumns={1}
        errorCellIds={new Set(['r1-use1', 'r1-use2'])}
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(sliderGroup('r1')).not.toHaveAttribute('aria-invalid');
    expect(sliderGroup('r1')).not.toHaveAttribute('aria-describedby');
  });
});

describe('표 문항 — 제목 없는 행의 슬라이더 이름', () => {
  it('행 제목이 화면에 없으면 가리키지 않고 묶음 이름 글자가 이름이다', () => {
    const untitled = onlyScaleRows.map((row) => ({
      ...row,
      label: '',
      cells: row.cells.map((cell) => (cell.type === 'text' ? { ...cell, content: '' } : cell)),
    }));
    render(<Harness tableRows={untitled} tableColumns={onlyScaleColumns} />);
    const group = sliderGroup('r1');
    expect(group).not.toHaveAttribute('aria-labelledby');
    expect(rowBlock('r1')).not.toHaveAttribute('aria-labelledby');
  });
});

describe('표 문항 — 「행 단위 그룹 카드」 안의 슬라이더 이름', () => {
  const card = (rowId: string) => screen.getByTestId(`row-card-${rowId}`);

  it('카드 제목과 섹션 제목이 「카드 제목, 섹션 제목」 순서로 이름이 된다', () => {
    view.mobile = true;
    render(<Harness mode="row-group-cards" />);
    for (const row of rows) {
      const group = sliderGroup(row.id);
      const [title, section] = resolveAriaReferences(group, 'aria-labelledby');
      expect(within(card(row.id)).getByTestId('row-card-header')).toContainElement(title!);
      expect(title).toHaveTextContent(row.label);
      expect(section).toHaveTextContent('만족도');
      expect(ariaReferenceIds(group, 'aria-labelledby')).toHaveLength(2);
      expect(group).not.toHaveAttribute('aria-label');
      expect(screen.getByRole('radiogroup', { name: `${row.label} 만족도` })).toBe(group);
    }
  });

  it('필수인데 답하지 않은 카드에서는 그 카드의 오류 문구가 이어지고, 답하면 풀린다', () => {
    view.mobile = true;
    render(<Harness mode="row-group-cards" requiredRowIds={['r2']} />);
    const group = sliderGroup('r2');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(ariaReferenceTexts(group, 'aria-describedby')).toEqual([
      '2) 도보통행 편의성의 응답을 확인해 주세요.',
    ]);
    expect(card('r2')).toContainElement(resolveAriaReferences(group, 'aria-describedby')[0]!);
    expect(sliderGroup('r1')).not.toHaveAttribute('aria-describedby');
    expect(within(card('r1')).queryByText(/응답을 확인해 주세요/)).not.toBeInTheDocument();

    pressTick('r2', 3);
    expect(sliderGroup('r2')).not.toHaveAttribute('aria-invalid');
    expect(sliderGroup('r2')).not.toHaveAttribute('aria-describedby');
    expect(within(card('r2')).queryByText(/응답을 확인해 주세요/)).not.toBeInTheDocument();
  });

  it('슬라이더가 없는 카드는 제목에 id 를 달지 않고 오류 문구도 더하지 않는다', () => {
    view.mobile = true;
    // 슬라이더 설정이 없는 같은 표 — 미충족 필수 묶음이 있어도 카드의 마크업은 종전 그대로다
    const plainGroups = groupsOf(rows, {}).map((group) => {
      const plain = { ...group };
      delete plain.scaleSlider;
      return plain;
    });
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        choiceGroups={plainGroups}
        mobileTableDisplayMode="row-group-cards"
        mobileDrilldownOmitLeadingColumns={1}
        errorCellIds={new Set(satisfactionCellIds('r2'))}
        value={{}}
        onChange={() => {}}
      />,
    );
    for (const row of rows) {
      const header = within(card(row.id)).getByTestId('row-card-header');
      expect(header.querySelector('[id]')).toBeNull();
      expect(within(card(row.id)).queryByText(/응답을 확인해 주세요/)).not.toBeInTheDocument();
    }
  });
});
