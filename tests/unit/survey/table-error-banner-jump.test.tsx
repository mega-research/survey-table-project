import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { InteractiveTableResponse } from '@/features/question-renderer/interactive-table-response';
import { QuestionInput } from '@/features/survey-response/question-input';
import { buildRowWiseCellInstanceIds } from '@/features/question-renderer/scroll-to-issue';
import type { Question, TableColumn, TableRow } from '@/types/survey';

/**
 * 차단형 검증 오류 배너의 "위치로 이동" 버튼.
 * 자동 스크롤 대신 배너 버튼을 눌러 위반 셀(data-cell-id)로 스크롤한다.
 */

const mediaState = vi.hoisted(() => ({ isMobile: false }));

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => mediaState.isMobile,
  useMediaQuery: () => mediaState.isMobile,
}));
vi.mock('@/features/question-renderer/contact-attrs-context', () => ({
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));

const columns: TableColumn[] = [
  { id: 'c0', label: '항목', width: 120 },
  { id: 'c1', label: '값', width: 120 },
];
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      { id: 'r1c0', type: 'text', content: '매출' },
      { id: 'r1c1', type: 'input', content: '', inputType: 'number' },
    ],
  },
] as unknown as TableRow[];

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

beforeEach(() => {
  mediaState.isMobile = false;
});

describe('InteractiveTableResponse 오류 배너', () => {
  it('자동 이동용 셀 인스턴스 ID는 원본 작성 행과 논리 셀 ID를 함께 사용한다', () => {
    expect(buildRowWiseCellInstanceIds(rows, ['r1c1'])).toEqual(['r1:r1:r1c1']);
  });

  it('cellIds 항목은 "위치로 이동" 버튼을 렌더하고, 클릭 시 해당 셀 입력으로 스크롤·포커스한다', () => {
    const scrollSpy = vi.fn();
    // jsdom 은 scrollIntoView 를 정의하지 않으므로 프로토타입에 스텁
    Element.prototype.scrollIntoView = scrollSpy;

    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        onChange={() => {}}
        errorItems={[{ message: '선택된 셀 합계가 100이 되어야 합니다 (현재 120)', cellIds: ['r1c1'] }]}
        errorCellIds={new Set(['r1c1'])}
      />,
    );

    expect(
      screen.getByText('선택된 셀 합계가 100이 되어야 합니다 (현재 120)'),
    ).toBeInTheDocument();
    const jumpBtn = screen.getByRole('button', { name: '위치로 이동' });
    fireEvent.click(jumpBtn);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect((scrollSpy.mock.contexts[0] as HTMLElement).getAttribute('data-cell-id')).toBe('r1c1');
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('cellIds[0] 이 미렌더(열 displayCondition 으로 숨은 열)여도 렌더된 첫 셀로 스크롤한다', () => {
    // 회귀: 합계 검증은 allResponses 접근이 없어 숨은 열 셀을 못 거른다 → cellIds[0] 이
    // 미렌더 셀일 수 있고, 그 경우 이전 코드는 querySelector 가 못 찾아 무반응이었다.
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        onChange={() => {}}
        errorItems={[
          { message: '합계 오류', cellIds: ['col-hidden-not-rendered', 'r1c1'] },
        ]}
        errorCellIds={new Set(['r1c1'])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '위치로 이동' }));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    // 미렌더 cellIds[0] 을 건너뛰고 실제 렌더된 r1c1 로 스크롤
    expect((scrollSpy.mock.contexts[0] as HTMLElement).getAttribute('data-cell-id')).toBe('r1c1');
  });

  it('상세 입력과 셀이 모두 미렌더면 질문 카드로 스크롤한다', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    render(
      <div data-question-id="q1">
        <InteractiveTableResponse
          questionId="q1"
          columns={columns}
          rows={rows}
          onChange={() => {}}
          errorItems={[{
            message: '필수 응답이 비어있습니다',
            cellIds: ['nope-1'],
            detailTargetIds: ['detail-not-mounted'],
          }]}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: '위치로 이동' }));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect((scrollSpy.mock.contexts[0] as HTMLElement).getAttribute('data-question-id')).toBe('q1');
  });

  it('cellIds 가 없거나 빈 항목은 이동 버튼 없이 메시지만 표시한다', () => {
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        onChange={() => {}}
        errorItems={[{ message: '메시지만' }, { message: '빈 배열', cellIds: [] }]}
      />,
    );
    expect(screen.getByText('메시지만')).toBeInTheDocument();
    expect(screen.getByText('빈 배열')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '위치로 이동' })).toBeNull();
  });

  it('모바일 행 카드의 필수 오류를 행별 이동 버튼으로 분리한다', () => {
    mediaState.isMobile = true;
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const mobileRows: TableRow[] = [
      {
        id: 'gender-row',
        label: '성별',
        cells: [
          { id: 'gender-label', type: 'text', content: '성별', mobileDisplay: 'header' },
          {
            id: 'gender-cell',
            type: 'radio',
            content: '',
            required: true,
            radioOptions: [
              { id: 'male', value: 'male', label: '남성' },
              { id: 'female', value: 'female', label: '여성' },
            ],
          },
        ],
      },
      {
        id: 'location-row',
        label: '대학 소재지',
        cells: [
          {
            id: 'location-label',
            type: 'text',
            content: '대학 소재지',
            mobileDisplay: 'header',
          },
          {
            id: 'location-cell',
            type: 'radio',
            content: '',
            required: true,
            radioOptions: [{ id: 'seoul', value: 'seoul', label: '서울' }],
          },
        ],
      },
      {
        id: 'college-type-row',
        label: '대학 유형',
        cells: [
          {
            id: 'college-type-label',
            type: 'text',
            content: '대학 유형',
            mobileDisplay: 'header',
          },
          {
            id: 'college-type-cell',
            type: 'radio',
            content: '',
            required: true,
            radioOptions: [
              { id: 'public', value: 'public', label: '국립·공립대' },
              { id: 'private', value: 'private', label: '사립대' },
            ],
          },
        ],
      },
    ] as TableRow[];
    const question = {
      id: 'q-mobile-cards',
      type: 'table',
      title: '응답자 특성',
      description: '',
      required: true,
      order: 0,
      tableColumns: columns,
      tableRowsData: mobileRows,
    } as Question;

    render(
      <div data-question-id={question.id}>
        <QuestionInput
          question={question}
          value={{ 'location-cell': 'seoul' }}
          onChange={() => {}}
          numericIssues={[
            {
              kind: 'required-cells',
              message: '필수 응답이 비어있습니다',
              cellIds: ['gender-cell', 'college-type-cell'],
            },
          ]}
        />
      </div>,
    );

    const buttons = screen.getAllByRole('button', { name: '위치로 이동' });
    expect(buttons).toHaveLength(2);
    expect(screen.getAllByText('필수 응답이 비어있습니다')).toHaveLength(2);
    expect(screen.queryByText('성별: 필수 응답이 비어있습니다')).toBeNull();
    expect(screen.queryByText('대학 유형: 필수 응답이 비어있습니다')).toBeNull();
    expect(screen.getByText('성별:')).toHaveClass('hidden', 'md:inline');
    expect(screen.getByText('대학 유형:')).toHaveClass('hidden', 'md:inline');

    fireEvent.click(buttons[0]!);
    expect(scrollSpy.mock.contexts.at(-1)).toHaveAttribute('data-row-id', 'gender-row');

    fireEvent.click(buttons[1]!);
    expect(scrollSpy.mock.contexts.at(-1)).toHaveAttribute('data-row-id', 'college-type-row');
  });
});
