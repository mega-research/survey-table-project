import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import type { ChoiceGroup, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';
import type { ScaleSliderProps } from './scale-slider';

/**
 * 표 문항이 슬라이더 컴포넌트에 넘기는 것 — 필수 강조 · 좁은 화면 여부 · 머리 제목과 낭독용 이름 · 입력 id 범위.
 *
 * 그 값으로 무엇을 그리는지는 슬라이더 컴포넌트의 테스트가 본다. 여기서는 호스트가 **기존 판정에서** 내린
 * 값이 맞는지만 본다 — 필수 강조는 기존 오류 칸 집합, 좁은 화면은 기존 모바일 판정이다. 그래서 컴포넌트를
 * 받은 값을 그대로 적는 자리 표시로 바꿔 둔다.
 */

const view = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => view.mobile,
  useMediaQuery: () => view.mobile,
}));
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({ 기관명: '메가' }),
  useAnswerQuotes: () => ({}),
}));
vi.mock('./scale-slider', () => ({
  ScaleSlider: (props: ScaleSliderProps) => (
    <div
      data-testid={`slider-${props.sliderId}`}
      data-invalid={String(props.invalid === true)}
      data-narrow={String(props.narrow === true)}
      data-label={props.label}
      data-aria-label={props.ariaLabel ?? ''}
      data-input-scope={props.inputIdScope ?? ''}
      data-selected={props.selectedChoiceId ?? ''}
    />
  ),
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

const CIRC = ['①', '②', '③', '④', '⑤'];
const columns: TableColumn[] = [
  { id: 'item', label: '구분', width: 190 },
  ...CIRC.map((_, n) => ({ id: `a${n}`, label: `${n + 1}점`, width: 64 })),
  ...CIRC.map((_, n) => ({ id: `b${n}`, label: `${n + 1}점`, width: 64 })),
];
const scaleCells = (rowId: string, axis: 'imp' | 'sat') =>
  CIRC.map((content, n) => ({
    id: `${rowId}-${axis}${n}`,
    type: 'choice_opt' as const,
    content,
    choiceGroupId: `g-${axis}-${rowId}`,
  }));
const rows: TableRow[] = ['r1', 'r2'].map((rowId) => ({
  id: rowId,
  label: rowId,
  cells: [
    { id: `${rowId}-item`, type: 'text', content: `${rowId} {{기관명}} 지원` },
    ...scaleCells(rowId, 'imp'),
    ...scaleCells(rowId, 'sat'),
  ],
}));
/** 행마다 중요도·만족도 묶음 — r2 의 중요도만 슬라이더가 아니다(한 행에 슬라이더 하나) */
const groups = (satLabel = '만족도'): ChoiceGroup[] =>
  rows.flatMap((row) => [
    {
      id: `g-imp-${row.id}`,
      groupKey: `imp_${row.id}`,
      type: 'radio' as const,
      label: '중요도',
      scaleSlider: 'positive-right' as const,
    },
    {
      id: `g-sat-${row.id}`,
      groupKey: `sat_${row.id}`,
      type: 'radio' as const,
      label: satLabel,
      scaleSlider: 'positive-left' as const,
    },
  ]);

function draw(options: {
  mode?: MobileTableDisplayMode;
  errorCellIds?: Set<string>;
  value?: Record<string, unknown>;
  tableRows?: TableRow[];
  tableColumns?: TableColumn[];
  choiceGroups?: ChoiceGroup[];
} = {}) {
  return render(
    <InteractiveTableResponse
      questionId="q1"
      columns={options.tableColumns ?? columns}
      rows={options.tableRows ?? rows}
      choiceGroups={options.choiceGroups ?? groups()}
      mobileTableDisplayMode={options.mode ?? 'auto'}
      mobileDrilldownOmitLeadingColumns={1}
      errorCellIds={options.errorCellIds}
      value={options.value ?? {}}
      onChange={() => {}}
    />,
  );
}
const slider = (id: string) => screen.getByTestId(`slider-${id}`);

describe('표 문항 → 슬라이더 컴포넌트: 필수 강조', () => {
  it('기존 오류 칸 집합에 그 묶음의 칸이 있으면 그 슬라이더만 강조한다', () => {
    draw({ errorCellIds: new Set(scaleCells('r2', 'sat').map((cell) => cell.id)) });
    expect(slider('g-sat-r2')).toHaveAttribute('data-invalid', 'true');
    expect(slider('g-imp-r2')).toHaveAttribute('data-invalid', 'false');
    expect(slider('g-sat-r1')).toHaveAttribute('data-invalid', 'false');
  });

  it('오류 칸이 없으면 강조하지 않는다', () => {
    draw();
    expect(slider('g-sat-r1')).toHaveAttribute('data-invalid', 'false');
  });

  it('「행 단위 그룹 카드」 안의 슬라이더도 같은 집합에서 내린다', () => {
    view.mobile = true;
    draw({
      mode: 'row-group-cards',
      errorCellIds: new Set(scaleCells('r1', 'imp').map((cell) => cell.id)),
    });
    expect(slider('g-imp-r1')).toHaveAttribute('data-invalid', 'true');
    expect(slider('g-sat-r1')).toHaveAttribute('data-invalid', 'false');
  });
});

describe('표 문항 → 슬라이더 컴포넌트: 좁은 화면 여부', () => {
  it('넓은 폭에서는 좁은 화면이 아니다', () => {
    draw();
    expect(slider('g-sat-r1')).toHaveAttribute('data-narrow', 'false');
  });

  it('기존 모바일 판정이 참이면 행 단위 배치와 그룹 카드 둘 다 좁은 화면이다', () => {
    view.mobile = true;
    const rowWise = draw({ mode: 'row-wise-scale' });
    expect(slider('g-sat-r1')).toHaveAttribute('data-narrow', 'true');
    rowWise.unmount();
    draw({ mode: 'row-group-cards' });
    expect(slider('g-sat-r1')).toHaveAttribute('data-narrow', 'true');
  });
});

describe('표 문항 → 슬라이더 컴포넌트: 제목 · 이름 · 고른 것', () => {
  it('한 행에 응답 묶음이 둘이면 머리 제목에 묶음 이름(토큰을 푼 글자)을 준다', () => {
    draw({ choiceGroups: groups('{{기관명}} 만족도') });
    expect(slider('g-imp-r1')).toHaveAttribute('data-label', '중요도');
    expect(slider('g-sat-r1')).toHaveAttribute('data-label', '메가 만족도');
  });

  it('행에 슬라이더 묶음 하나뿐이면 머리 제목을 비우고 낭독용 이름에 행 제목(토큰을 푼 글자)을 준다', () => {
    const single = rows.map((row) => ({ ...row, cells: row.cells.slice(0, 6) }));
    draw({ tableRows: single, tableColumns: columns.slice(0, 6) });
    expect(slider('g-imp-r1')).toHaveAttribute('data-label', '');
    expect(slider('g-imp-r1')).toHaveAttribute('data-aria-label', 'r1 메가 지원');
  });

  it('입력 id 범위는 행이다 — 같은 문항의 슬라이더가 행마다 겹치지 않는다', () => {
    draw();
    expect(slider('g-sat-r1')).toHaveAttribute('data-input-scope', 'r1');
    expect(slider('g-sat-r2')).toHaveAttribute('data-input-scope', 'r2');
  });

  it('고른 것은 그 묶음 키의 저장 값이다', () => {
    draw({ value: { __choiceGroups: { sat_r2: 'r2-sat3' } } });
    expect(slider('g-sat-r2')).toHaveAttribute('data-selected', 'r2-sat3');
    expect(slider('g-sat-r1')).toHaveAttribute('data-selected', '');
    expect(slider('g-imp-r2')).toHaveAttribute('data-selected', '');
  });
});
