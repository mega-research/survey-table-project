import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup, Question, TableCell, TableRow } from '@/types/survey';

import {
  ariaReferenceIds,
  ariaReferenceTexts,
  resolveAriaReferences,
} from '../../../tests/helpers/aria-references';
import { ChoiceTableResponse } from './choice-table-response';

/**
 * 보기 소스 표(radio 문항 + 내장 표) — 척도 슬라이더 라디오 묶음의 낭독 이름과 오류 문구
 * (CONTEXT.md 「척도 슬라이더」).
 *
 * 표 문항과 같은 규칙이다 — 화면에 보이는 행 제목이 이름이고(한 행에 응답 묶음이 여럿이면 「행 제목, 묶음
 * 이름」), 필수인데 답하지 않은 묶음에는 그 행의 낭독용 오류 문구가 설명으로 이어진다. 보기 묶음이 있는 표와
 * 묶음 없는 표(문항 설정) 둘 다, 행 단위 배치와 「행 단위 그룹 카드」 둘 다 본다. 가리키는 id 는 전부 문서에
 * 있어야 한다 — 헬퍼가 없는 id 에서 던진다.
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
const SAT_CELL_IDS = CIRC.map((_, n) => `sat${n}`);

const satCells = (rowId: string, groupId?: string): TableCell[] =>
  CIRC.map((content, n) => ({
    id: rowId === 'r1' ? `sat${n}` : `${rowId}-sat${n}`,
    type: 'choice_opt',
    content,
    choiceLabel: NAMES[n]!,
    ...(groupId ? { choiceGroupId: groupId } : {}),
  }));

const useCells = (): TableCell[] =>
  ['활용함', '활용 안함'].map((choiceLabel, n) => ({
    id: `u${n + 1}`,
    type: 'choice_opt',
    content: CIRC[n]!,
    choiceLabel,
    choiceGroupId: 'g-use',
  }));

interface QuestionOptions {
  /** 「활용 여부」 묶음을 함께 둔다 — 한 행에 응답 묶음이 둘이 된다 */
  withUsage?: boolean;
  mode?: Question['mobileTableDisplayMode'];
}

/** 보기 묶음이 있는 표 — 만족도 묶음의 보기 모양이 척도 슬라이더 */
function groupedQuestion({ withUsage = true, mode }: QuestionOptions = {}): Question {
  const groups: ChoiceGroup[] = [
    ...(withUsage
      ? [{ id: 'g-use', type: 'radio' as const, groupKey: 'rad1', label: '활용 여부' }]
      : []),
    { id: 'g-sat', type: 'radio', groupKey: 'rad2', label: '만족도', scaleSlider: 'positive-right' },
  ];
  return {
    id: 'q1',
    type: 'radio',
    title: '지원제도',
    required: true,
    order: 0,
    mobileDrilldownOmitLeadingColumns: 1,
    ...(mode ? { mobileTableDisplayMode: mode } : {}),
    choiceGroups: groups,
    tableColumns: [
      { id: 'c-item', label: '평가항목' },
      ...(withUsage
        ? [
            { id: 'c-u1', label: '활용함' },
            { id: 'c-u2', label: '활용 안함' },
          ]
        : []),
      ...NAMES.map((label, n) => ({ id: `c-s${n}`, label })),
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '1) 회의실 및 교통비 지원',
        cells: [
          { id: 'item', type: 'text', content: '1) 회의실 및 교통비 지원' },
          ...(withUsage ? useCells() : []),
          ...satCells('r1', 'g-sat'),
        ],
      },
    ],
  } as unknown as Question;
}

/** 묶음 없는 표 — 문항 설정으로 켠 슬라이더. 행이 둘이어도 답은 문항에 하나다 */
function ungroupedQuestion(mode?: Question['mobileTableDisplayMode']): Question {
  const row = (id: string, title: string): TableRow => ({
    id,
    label: title,
    cells: [{ id: `${id}-item`, type: 'text', content: title }, ...satCells(id)],
  });
  return {
    id: 'q1',
    type: 'radio',
    title: '전반적으로 얼마나 만족하십니까?',
    required: false,
    order: 0,
    scaleSlider: 'positive-right',
    mobileDrilldownOmitLeadingColumns: 1,
    ...(mode ? { mobileTableDisplayMode: mode } : {}),
    tableColumns: [
      { id: 'item', label: '구분' },
      ...NAMES.map((label, n) => ({ id: `s${n}`, label })),
    ],
    tableRowsData: [row('r1', '1) 시설 만족도'), row('r2', '2) 서비스 만족도')],
  } as unknown as Question;
}

/** 필수 만족도 묶음이 비어 있는 동안 그 보기 칸을 미충족으로 넘긴다 — 답하면 문항 카드가 하듯 빠진다 */
function Harness({ q, required = false }: { q: Question; required?: boolean }) {
  const [value, setValue] = useState<unknown>(undefined);
  const answered = (value as Record<string, unknown> | undefined)?.rad2 !== undefined;
  return (
    <ChoiceTableResponse
      question={q}
      value={value}
      onChange={setValue}
      {...(required && !answered ? { unfilledGroupCellIds: new Set(SAT_CELL_IDS) } : {})}
    />
  );
}

const rowBlock = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`)!;
const sliderGroup = (sliderId = 'g-sat') =>
  within(screen.getByTestId(`scale-slider-${sliderId}`)).getByRole('radiogroup');

function pressTick(tickIndex: number, sliderId = 'g-sat') {
  const track = within(screen.getByTestId(`scale-slider-${sliderId}`)).getByTestId(
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
] as const)('보기 소스 표 — 행 단위 배치의 슬라이더 이름(%s)', (_name, mobile) => {
  it('행에 응답 묶음이 하나뿐이면 보이는 행 제목이 슬라이더 묶음의 이름이다', () => {
    view.mobile = mobile;
    render(<Harness q={groupedQuestion({ withUsage: false })} />);
    const group = sliderGroup();
    const [title] = resolveAriaReferences(group, 'aria-labelledby');
    expect(title).toBe(
      within(rowBlock('r1')).getByRole('heading', { name: '1) 회의실 및 교통비 지원' }),
    );
    expect(ariaReferenceIds(group, 'aria-labelledby')).toHaveLength(1);
    expect(group).not.toHaveAttribute('aria-label');
    // 행 블록과 같은 요소를 가리킨다
    expect(group.getAttribute('aria-labelledby')).toBe(
      rowBlock('r1').getAttribute('aria-labelledby'),
    );
  });

  it('행에 응답 묶음이 여럿이면 「행 제목, 묶음 이름」 순서로 읽힌다', () => {
    view.mobile = mobile;
    render(<Harness q={groupedQuestion()} />);
    const group = sliderGroup();
    expect(ariaReferenceTexts(group, 'aria-labelledby')).toEqual([
      '1) 회의실 및 교통비 지원',
      '만족도',
    ]);
    expect(group).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('radiogroup', { name: '1) 회의실 및 교통비 지원 만족도' })).toBe(group);
  });

  it('필수인데 답하지 않은 묶음에는 그 행의 오류 문구가 이어지고, 답하면 풀린다', () => {
    view.mobile = mobile;
    render(<Harness q={groupedQuestion()} required />);
    const group = sliderGroup();
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(ariaReferenceTexts(group, 'aria-describedby')).toEqual([
      '1) 회의실 및 교통비 지원의 응답을 확인해 주세요.',
    ]);
    expect(rowBlock('r1')).toContainElement(resolveAriaReferences(group, 'aria-describedby')[0]!);

    pressTick(3);
    expect(sliderGroup()).not.toHaveAttribute('aria-invalid');
    expect(sliderGroup()).not.toHaveAttribute('aria-describedby');
    expect(ariaReferenceTexts(sliderGroup(), 'aria-labelledby')).toEqual([
      '1) 회의실 및 교통비 지원',
      '만족도',
    ]);
  });

  it('묶음 없는 표(문항 설정)는 행마다 제 행 제목이 슬라이더 묶음의 이름이다', () => {
    view.mobile = mobile;
    render(<Harness q={ungroupedQuestion()} />);
    for (const [rowId, title] of [
      ['r1', '1) 시설 만족도'],
      ['r2', '2) 서비스 만족도'],
    ] as const) {
      const group = sliderGroup(`run:${rowId === 'r1' ? 'sat0' : `${rowId}-sat0`}`);
      expect(ariaReferenceTexts(group, 'aria-labelledby')).toEqual([title]);
      expect(group).not.toHaveAttribute('aria-label');
      expect(group).not.toHaveAttribute('aria-describedby');
      expect(within(rowBlock(rowId)).getByRole('radiogroup', { name: title })).toBe(group);
    }
  });
});

describe('보기 소스 표 — 「행 단위 그룹 카드」 안의 슬라이더 이름', () => {
  const card = () => screen.getByTestId('row-card-r1');

  it('카드 제목과 섹션 제목이 「카드 제목, 섹션 제목」 순서로 이름이 된다', () => {
    view.mobile = true;
    render(<Harness q={groupedQuestion({ mode: 'row-group-cards' })} />);
    const group = sliderGroup();
    const [title, section] = resolveAriaReferences(group, 'aria-labelledby');
    expect(within(card()).getByTestId('row-card-header')).toContainElement(title!);
    expect(title).toHaveTextContent('1) 회의실 및 교통비 지원');
    expect(section).toHaveTextContent('만족도');
    expect(ariaReferenceIds(group, 'aria-labelledby')).toHaveLength(2);
    expect(group).not.toHaveAttribute('aria-label');
  });

  it('묶음 없는 표의 카드는 카드 제목 하나가 이름이다', () => {
    view.mobile = true;
    render(<Harness q={ungroupedQuestion('row-group-cards')} />);
    const group = sliderGroup('run:sat0');
    expect(ariaReferenceTexts(group, 'aria-labelledby')).toEqual(['1) 시설 만족도']);
    expect(group).not.toHaveAttribute('aria-label');
    expect(ariaReferenceTexts(sliderGroup('run:r2-sat0'), 'aria-labelledby')).toEqual([
      '2) 서비스 만족도',
    ]);
  });

  it('필수인데 답하지 않은 카드에서는 그 카드의 오류 문구가 이어지고, 답하면 풀린다', () => {
    view.mobile = true;
    render(<Harness q={groupedQuestion({ mode: 'row-group-cards' })} required />);
    const group = sliderGroup();
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(ariaReferenceTexts(group, 'aria-describedby')).toEqual([
      '1) 회의실 및 교통비 지원의 응답을 확인해 주세요.',
    ]);
    expect(card()).toContainElement(resolveAriaReferences(group, 'aria-describedby')[0]!);

    pressTick(3);
    expect(sliderGroup()).not.toHaveAttribute('aria-invalid');
    expect(sliderGroup()).not.toHaveAttribute('aria-describedby');
    expect(within(card()).queryByText(/응답을 확인해 주세요/)).not.toBeInTheDocument();
  });

  it('슬라이더가 없는 카드는 제목에 id 를 달지 않고 오류 문구도 더하지 않는다', () => {
    view.mobile = true;
    const q = groupedQuestion({ mode: 'row-group-cards' });
    // 슬라이더 설정이 없는 같은 표 — 미충족 필수 묶음이 있어도 카드의 마크업은 종전 그대로다
    q.choiceGroups = q.choiceGroups!.map((group) => {
      const plain = { ...group };
      delete plain.scaleSlider;
      return plain;
    });
    render(
      <ChoiceTableResponse
        question={q}
        value={undefined}
        onChange={() => {}}
        unfilledGroupCellIds={new Set(SAT_CELL_IDS)}
      />,
    );
    expect(within(card()).getByTestId('row-card-header').querySelector('[id]')).toBeNull();
    expect(within(card()).queryByText(/응답을 확인해 주세요/)).not.toBeInTheDocument();
  });
});
