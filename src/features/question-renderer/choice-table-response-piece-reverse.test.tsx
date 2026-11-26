import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/features/question-renderer/choice-table-response';
import { MobileRowWiseOriginalSheet } from '@/features/question-renderer/mobile-row-wise-original-sheet';
import { buildMobileRowWiseOriginalModel } from '@/features/question-renderer/utils/mobile-row-wise-original';
import type { Question, TableCell } from '@/types/survey';

/**
 * 보기 소스 표(척도 표를 내장한 단일 선택) — 조각 좌우 반전. 형사사법포털 이용자 만족도 조사 B1:
 * 머리 = 양끝·보통 이름, 아래 = ⓪~⑩ 한 줄. 좁은 화면의 「행별 원본 문항 보기」와 「선택 행 원본 보기」에서만
 * 뒤집히고, 넓은 화면의 행 단위 배치에서는 뒤집히지 않는다.
 */

const view = vi.hoisted(() => ({ mobile: true }));
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
  view.mobile = true;
});

const SCORES = [0, 1, 2, 3, 4];
const scaleCells: TableCell[] = SCORES.map((n) => ({
  id: `c${n}`,
  type: 'choice_opt',
  content: String(n),
  choiceLabel: `${n}점`,
  choiceGroupId: 'g',
}));

const scaleQuestion = (extra: Partial<Question> = {}): Question => ({
  id: 'b1',
  type: 'radio',
  title: '전반 만족도',
  required: true,
  order: 0,
  options: [],
  mobileTableDisplayMode: 'row-wise-original',
  mobileDrilldownOmitLeadingColumns: 0,
  choiceGroups: [{ id: 'g', type: 'radio', groupKey: 'default', label: '전반 만족도' }],
  tableColumns: SCORES.map((n) => ({ id: `col${n}`, label: `${n}`, width: 100 })),
  tableHeaderGrid: [
    [
      { id: 'h-neg', label: '전혀 만족하지 않음', colspan: 1, rowspan: 1, hideRightBorder: true },
      { id: 'h-mid', label: '보통', colspan: 3, rowspan: 1, hideRightBorder: true },
      { id: 'h-pos', label: '매우 만족함', colspan: 1, rowspan: 1 },
    ],
  ],
  tableRowsData: [{ id: 'r1', label: '전반 만족도', cells: scaleCells }],
  ...extra,
});

const radioNames = () =>
  screen.getAllByRole('radio').map((el) => el.getAttribute('aria-label'));

describe('보기 소스 표 — 조각 좌우 반전 (행별 원본 문항 보기)', () => {
  it('끈 문항은 작성 순서 그대로다', () => {
    render(<ChoiceTableResponse question={scaleQuestion()} value={{}} onChange={vi.fn()} />);
    expect(radioNames()).toEqual(['0점', '1점', '2점', '3점', '4점']);
  });

  it('켠 문항은 긍정 쪽 끝부터 서고 머리 구간도 따라 뒤집힌다', () => {
    render(
      <ChoiceTableResponse
        question={scaleQuestion({ mobileDrilldownReverseColumns: true })}
        value={{}}
        onChange={vi.fn()}
      />,
    );
    expect(radioNames()).toEqual(['4점', '3점', '2점', '1점', '0점']);
    expect(screen.getAllByRole('columnheader').map((el) => el.textContent)).toEqual([
      '매우 만족함',
      '보통',
      '전혀 만족하지 않음',
    ]);
  });

  it('뒤집힌 칸을 눌러도 응답은 원래 칸 id 다', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={scaleQuestion({ mobileDrilldownReverseColumns: true })}
        value={{}}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getAllByRole('radio')[0]!);
    expect(onChange).toHaveBeenLastCalledWith({ default: 'c4' });
  });

  it('저장된 답은 뒤집힌 화면에서도 같은 칸에 표시된다', () => {
    render(
      <ChoiceTableResponse
        question={scaleQuestion({ mobileDrilldownReverseColumns: true })}
        value={{ default: 'c1' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: '1점' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '4점' })).not.toBeChecked();
  });

  it('PC 표는 켜도 작성 순서 그대로다', () => {
    view.mobile = false;
    render(
      <ChoiceTableResponse
        question={scaleQuestion({ mobileDrilldownReverseColumns: true })}
        value={{}}
        onChange={vi.fn()}
      />,
    );
    expect(radioNames()).toEqual(['0점', '1점', '2점', '3점', '4점']);
  });
});

describe('보기 소스 표 — 조각 좌우 반전 (선택 행 원본 보기)', () => {
  it('행을 열어 본 원본 표 조각도 뒤집힌다', () => {
    const question = scaleQuestion({
      mobileTableDisplayMode: 'drilldown-original-row',
      mobileDrilldownOmitLeadingColumns: 1,
      mobileDrilldownReverseColumns: true,
      tableColumns: [
        { id: 'item', label: '항목', width: 200 },
        ...SCORES.map((n) => ({ id: `col${n}`, label: `${n}`, width: 100 })),
      ],
      tableHeaderGrid: null,
      tableRowsData: [
        {
          id: 'r1',
          label: '전반 만족도',
          cells: [{ id: 'item-1', type: 'text', content: '전반 만족도' }, ...scaleCells],
        },
      ],
    });
    render(<ChoiceTableResponse question={question} value={{}} onChange={vi.fn()} />);

    const opener = screen.queryByRole('button', { name: /전반 만족도/ });
    if (opener) fireEvent.click(opener);

    expect(radioNames()).toEqual(['4점', '3점', '2점', '1점', '0점']);
  });
});

describe('행별 원본 시트 — 넓은 화면의 행 단위 배치에는 적용하지 않는다', () => {
  const columns = SCORES.map((n) => ({ id: `col${n}`, label: `${n}`, width: 100 }));
  const rows = [{ id: 'r1', label: '전반 만족도', cells: scaleCells }];
  const model = buildMobileRowWiseOriginalModel({
    authoredColumns: columns,
    authoredRows: rows,
    visibleColumns: columns,
    displayRows: rows,
    hideColumnLabels: false,
    settings: { omitLeadingAuthoredColumns: 0 },
    answerableCellTypes: ['choice_opt'],
  });
  const drawnCellIds = () =>
    within(screen.getByTestId('mobile-row-wise-original-sheet'))
      .getAllByTestId(/^drawn-/)
      .map((el) => el.textContent);
  const renderCell = (cell: TableCell) => <span data-testid={`drawn-${cell.id}`}>{cell.id}</span>;

  it('좁은 화면에서는 뒤집는다', () => {
    render(
      <MobileRowWiseOriginalSheet
        model={model}
        renderCell={renderCell}
        pieceSettings={{ reverseColumns: true }}
      />,
    );
    expect(drawnCellIds()).toEqual(['c4', 'c3', 'c2', 'c1', 'c0']);
  });

  it('넓은 화면 배치(wide)에서는 켜도 작성 순서 그대로다', () => {
    render(
      <MobileRowWiseOriginalSheet
        model={model}
        renderCell={renderCell}
        pieceSettings={{ reverseColumns: true }}
        wide
      />,
    );
    expect(drawnCellIds()).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
  });
});
