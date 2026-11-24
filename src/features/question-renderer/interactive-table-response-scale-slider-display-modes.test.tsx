import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  MOBILE_TABLE_DISPLAY_MODES,
  type MobileTableDisplayMode,
} from '@/types/mobile-table-display';
import type {
  ChoiceGroup,
  StagedRowsConfig,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 표 문항 — 좁은 폭에서 척도 슬라이더가 배치를 가져간 표를 모바일 표시 방식 아홉 가지로 그린다
 * (CONTEXT.md 「척도 슬라이더」 · 「모바일 표시 방식」).
 *
 * 슬라이더로 그려지는 행이 있으면 「행 단위 그룹 카드」만 그 카드 안에서, 그 밖은 저작자가 고른 방식과
 * 무관하게 행 단위 배치다. 그때 **저작자가 고른 방식의 전용 장치·상태가 화면에 남으면 안 된다** — 고른
 * 방식을 직접 읽는 파생값이 하나라도 있으면 그려지지 않는 화면에 버튼을 넘기거나 대체 버튼을 숨긴다
 * (2026-11-24 리뷰: 「항목 단위 카드」의 행 추가·삭제 버튼이 사라졌다).
 *
 * 그래서 여덟 방식의 화면을 「행별 척도」의 화면과 통째로 견준다. 방식이 하나 늘어도 이 테스트가 돈다.
 *
 * jsdom 은 배치를 계산하지 않으므로 트랙 범위는 테스트가 준다(왼쪽 100px · 폭 500px). 눈금 5개면 칸 하나가
 * 100px 이고 눈금은 150 · 250 · 350 · 450 · 550 에 선다.
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
afterEach(() => {
  vi.restoreAllMocks();
});

const NAMES = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
const CIRC = ['①', '②', '③', '④', '⑤'];

// 구분 | 만족도 5칸 | 의견
const columns: TableColumn[] = [
  { id: 'item', label: '구분', width: 190 },
  ...NAMES.map((label, n) => ({ id: `s${n}`, label, width: 80 })),
  { id: 'memo', label: '의견', width: 200 },
];

/** 척도 행 — 만족도 묶음(슬라이더) 하나와 그 행의 의견 입력칸 */
function scaleRow(id: string, title: string): TableRow {
  return {
    id,
    label: title,
    cells: [
      { id: `${id}-item`, type: 'text', content: title },
      ...CIRC.map(
        (content, n): TableCell => ({
          id: `${id}-sat${n}`,
          type: 'choice_opt',
          content,
          choiceLabel: NAMES[n]!,
          choiceGroupId: `g-sat-${id}`,
        }),
      ),
      { id: `${id}-memo`, type: 'input', content: '' },
    ],
  };
}

/** 차례로 여는 줄 — 묶음에는 보기 칸이 든 행을 넣을 수 없어 입력 줄로 만든다 */
function memoRow(id: string): TableRow {
  return {
    id,
    label: `기타 ${id}`,
    cells: columns.map(
      (column, n): TableCell =>
        n === 0
          ? { id: `${id}-item`, type: 'text', content: `기타 ${id}` }
          : n === columns.length - 1
            ? { id: `${id}-memo`, type: 'input', content: '' }
            : { id: `${id}-${column.id}`, type: 'text', content: '' },
    ),
  };
}

const rows: TableRow[] = [
  scaleRow('r1', '1) 주차/접근성'),
  scaleRow('r2', '2) 도보통행 편의성'),
  memoRow('m1'),
  memoRow('m2'),
  memoRow('m3'),
];

const stagedRowsConfig: StagedRowsConfig = {
  enabled: true,
  rowIds: ['m1', 'm2', 'm3'],
  initialVisibleCount: 1,
  addLabel: '항목 추가',
};

const groups = (slider: boolean): ChoiceGroup[] =>
  ['r1', 'r2'].map((rowId) => ({
    id: `g-sat-${rowId}`,
    groupKey: `sat_${rowId}`,
    type: 'radio',
    label: '만족도',
    ...(slider ? { scaleSlider: 'positive-right' as const } : {}),
  }));

/** r2 만족도 묶음 — 필수인데 답하지 않은 묶음으로 넘긴다 */
const R2_SCALE_CELL_IDS = CIRC.map((_, n) => `r2-sat${n}`);

function Harness({
  mode,
  slider = true,
  errorCellIds,
}: {
  mode: MobileTableDisplayMode;
  slider?: boolean;
  errorCellIds?: Set<string>;
}) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        choiceGroups={groups(slider)}
        stagedRowsConfig={stagedRowsConfig}
        mobileTableDisplayMode={mode}
        mobileDrilldownOmitLeadingColumns={1}
        errorCellIds={errorCellIds}
        value={value}
        onChange={setValue}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);
const sheet = () => screen.queryByTestId('mobile-row-wise-original-sheet');
const sliderOf = (rowId: string) => screen.getByTestId(`scale-slider-g-sat-${rowId}`);
const addButtons = () => screen.queryAllByRole('button', { name: '항목 추가' });
const removeButtons = () => screen.queryAllByRole('button', { name: '마지막 줄 삭제' });
const memoInput = (rowId: string) => document.querySelector(`[data-cell-id="${rowId}-memo"]`);

function trackOf(rowId: string): HTMLElement {
  const track = within(sliderOf(rowId)).getByTestId('scale-slider-track');
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
  return track;
}
const TICK_X = [150, 250, 350, 450, 550];
const press = (track: HTMLElement, x: number) => {
  fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX: x });
  fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX: x });
};

/**
 * 화면 글자 — 렌더마다 달라지는 React id(useId)는 처음 나온 순서의 번호로 바꿔 두 렌더를 견줄 수 있게 한다.
 * 견본 표의 저작 id 에는 이 모양이 없다.
 */
function screenHtml(container: HTMLElement): string {
  const seen = new Map<string, string>();
  return container.innerHTML.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, (id) => {
    if (!seen.has(id)) seen.set(id, `id${seen.size}`);
    return seen.get(id)!;
  });
}

/** 한 방식으로 그려 응답자의 걸음을 밟고, 걸음마다 화면을 적어 둔다 */
function walk(mode: MobileTableDisplayMode): string[] {
  const { container, unmount } = render(
    <Harness mode={mode} errorCellIds={new Set(R2_SCALE_CELL_IDS)} />,
  );
  const shots = [screenHtml(container)];
  fireEvent.click(addButtons()[0]!);
  shots.push(screenHtml(container));
  press(trackOf('r1'), TICK_X[3]!);
  shots.push(screenHtml(container));
  fireEvent.click(removeButtons()[0]!);
  shots.push(screenHtml(container));
  unmount();
  return shots;
}

const ROW_WISE_MODES = MOBILE_TABLE_DISPLAY_MODES.filter((mode) => mode !== 'row-group-cards');

describe('표 문항 — 슬라이더로 전환된 「항목 단위 카드」의 행 차례로 열기 (리뷰 지적)', () => {
  it('추가 버튼이 정확히 하나 보이고, 누르면 다음 행이 열리고, 빼기도 된다', () => {
    render(<Harness mode="item-cards" />);
    // 항목 카드가 아니라 행 단위 배치가 그려진다 — 버튼은 그 아래에 한 번 선다
    expect(sheet()).toBeInTheDocument();
    expect(memoInput('m1')).not.toBeNull();
    expect(memoInput('m2')).toBeNull();
    expect(addButtons()).toHaveLength(1);
    expect(
      sheet()!.compareDocumentPosition(addButtons()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(addButtons()[0]!);
    expect(memoInput('m2')).not.toBeNull();
    expect(memoInput('m3')).toBeNull();
    expect(addButtons()).toHaveLength(1);

    expect(removeButtons()).toHaveLength(1);
    fireEvent.click(removeButtons()[0]!);
    expect(memoInput('m2')).toBeNull();
  });

  it('슬라이더 설정이 없는 「항목 단위 카드」는 그대로 카드 안에 버튼을 둔다', () => {
    render(<Harness mode="item-cards" slider={false} />);
    expect(sheet()).not.toBeInTheDocument();
    expect(addButtons()).toHaveLength(1);
    expect(
      within(screen.getByTestId('item-card-row-controls')).getByRole('button', {
        name: '항목 추가',
      }),
    ).toBeInTheDocument();
  });
});

describe('표 문항 — 좁은 폭 × 모바일 표시 방식 아홉 가지 × 척도 슬라이더', () => {
  it.each(ROW_WISE_MODES)('「%s」: 행 단위 배치가 그려지고 그 방식의 전용 장치가 남지 않는다', (mode) => {
    render(<Harness mode={mode} />);
    expect(sheet()).toBeInTheDocument();
    expect(within(sheet()!).getByTestId('scale-slider-g-sat-r1')).toBeInTheDocument();
    expect(within(sheet()!).getByTestId('scale-slider-g-sat-r2')).toBeInTheDocument();
    // 응답 칸은 전부 시트 안에 있다 — 다른 화면(항목 카드 · 축 카드 · 드릴다운 · 스테퍼 · 격자)이 함께 서지 않는다
    for (const control of [...screen.getAllByRole('radio'), ...screen.getAllByRole('textbox')]) {
      expect(sheet()!.contains(control)).toBe(true);
    }
    expect(screen.queryByTestId('item-card-row-controls')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^choice-group-section-/)).not.toBeInTheDocument();
    // 시트 밖의 버튼은 행 차례로 열기 하나뿐이다(드릴다운·스테퍼의 이동 버튼이 없다)
    const outside = screen.getAllByRole('button').filter((button) => !sheet()!.contains(button));
    expect(outside).toEqual(addButtons());
    expect(addButtons()).toHaveLength(1);
  });

  it('여덟 방식의 화면이 「행별 척도」와 같다 — 처음 · 행을 연 뒤 · 답한 뒤 · 행을 뺀 뒤', () => {
    const baseline = walk('row-wise-scale');
    expect(baseline).toHaveLength(4);
    for (const mode of ROW_WISE_MODES) {
      const shots = walk(mode);
      shots.forEach((shot, step) => {
        expect(shot === baseline[step], `${mode} · ${step}번째 걸음`).toBe(true);
      });
    }
  });

  it.each(ROW_WISE_MODES)('「%s」: 행 차례로 열기 · 필수 강조 · 값 쓰기가 동작한다', (mode) => {
    render(<Harness mode={mode} errorCellIds={new Set(R2_SCALE_CELL_IDS)} />);
    // 필수 강조 — 오류 칸 집합에 든 묶음만
    expect(within(sliderOf('r2')).getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
    expect(within(sliderOf('r1')).getByRole('radiogroup')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // 값 쓰기 — 그 묶음의 기존 채널
    press(trackOf('r1'), TICK_X[3]!);
    expect(valueOf()).toEqual({ __choiceGroups: { sat_r1: 'r1-sat3' } });
    // 행 차례로 열기
    expect(addButtons()).toHaveLength(1);
    fireEvent.click(addButtons()[0]!);
    expect(memoInput('m2')).not.toBeNull();
    fireEvent.click(removeButtons()[0]!);
    expect(memoInput('m2')).toBeNull();
  });

  it('「행 단위 그룹 카드」: 그 카드 안에서 슬라이더로 그리고 행 차례로 열기 · 필수 강조 · 값 쓰기가 동작한다', () => {
    render(<Harness mode="row-group-cards" errorCellIds={new Set(R2_SCALE_CELL_IDS)} />);
    expect(sheet()).not.toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('item-card-row-controls')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('choice-group-section-g-sat-r1')).getByTestId(
        'scale-slider-g-sat-r1',
      ),
    ).toBeInTheDocument();
    expect(within(sliderOf('r2')).getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
    press(trackOf('r1'), TICK_X[3]!);
    expect(valueOf()).toEqual({ __choiceGroups: { sat_r1: 'r1-sat3' } });
    expect(addButtons()).toHaveLength(1);
    fireEvent.click(addButtons()[0]!);
    expect(removeButtons()).toHaveLength(1);
    fireEvent.click(removeButtons()[0]!);
    expect(removeButtons()).toHaveLength(0);
  });
});
