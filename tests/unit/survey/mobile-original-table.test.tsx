import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { InteractiveTableResponse } from '@/components/survey-builder/interactive-table-response';
import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import type { Question } from '@/types/survey';

/**
 * mobileOriginalTable(모바일에서 원본 표로 보기) 분기 회귀 테스트.
 *
 * 옵션이 켜진 질문은 모바일 뷰포트에서도 카드/스테퍼 전환 없이 원본 표
 * (가로 스크롤)를 유지한다. 기본값(미지정/false)은 기존 카드 전환 동작.
 */

// 모바일 뷰 강제
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/lib/survey/contact-attrs-context', () => ({
  useContactAttrs: () => ({}),
}));
// 모바일 카드 경로는 스텁으로 식별
vi.mock('@/components/survey-builder/mobile-table-stepper', () => ({
  MobileTableStepper: () => <div data-testid="mobile-stepper" />,
}));
vi.mock('@/components/survey-builder/mobile-table-drilldown', () => ({
  MobileTableDrilldown: () => <div data-testid="mobile-drilldown" />,
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

const columns = [
  { id: 'c0', label: '항목' },
  { id: 'c1', label: '점수' },
];
const rows = [
  {
    id: 'r1',
    label: '행1',
    cells: [
      { id: 'r1c0', type: 'text', content: '1) 직무' },
      {
        id: 'r1c1',
        type: 'radio',
        content: '',
        radioOptions: [
          { id: 'o0', label: '⓪', value: '0' },
          { id: 'o1', label: '⑩', value: '10' },
        ],
      },
    ],
  },
];

describe('InteractiveTableResponse — 모바일 원본 표 분기', () => {
  it('기본값이면 모바일에서 카드/스테퍼로 전환한다', () => {
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns as never}
        rows={rows as never}
        onChange={() => {}}
      />,
    );
    expect(
      screen.queryByTestId('mobile-stepper') ?? screen.queryByTestId('mobile-drilldown'),
    ).toBeTruthy();
  });

  it('mobileOriginalTable 이면 모바일에서도 원본 표를 렌더한다', () => {
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns as never}
        rows={rows as never}
        onChange={() => {}}
        mobileOriginalTable
      />,
    );
    expect(screen.queryByTestId('mobile-stepper')).toBeNull();
    expect(screen.queryByTestId('mobile-drilldown')).toBeNull();
    // 원본 표의 열 라벨이 보인다
    expect(screen.getByText('점수')).toBeInTheDocument();
  });

  it('mobileTableDisplayMode original 이면 legacy boolean 없이도 원본 표를 렌더한다', () => {
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns as never}
        rows={rows as never}
        onChange={() => {}}
        mobileTableDisplayMode="original"
      />,
    );
    expect(screen.queryByTestId('mobile-stepper')).toBeNull();
    expect(screen.queryByTestId('mobile-drilldown')).toBeNull();
    expect(screen.getByText('점수')).toBeInTheDocument();
  });
});

function choiceQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q2',
    type: 'radio',
    title: 'Q',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'c0', label: '기술' },
      { id: 'c1', label: '선택' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'r1c0', type: 'text', content: '컴퓨터 비전', mobileDisplay: 'hidden' },
          { id: 'r1c1', type: 'choice_opt', content: '', choiceLabel: '① 컴퓨터 비전' },
        ],
      },
    ],
    ...overrides,
  } as unknown as Question;
}

describe('ChoiceTableResponse — 모바일 원본 표 분기', () => {
  it('기본값이면 모바일에서 옵션 카드로 전환한다 (열 라벨 미표시)', () => {
    render(<ChoiceTableResponse question={choiceQuestion()} value={null} onChange={() => {}} />);
    expect(screen.queryByText('기술')).toBeNull();
  });

  it('mobileOriginalTable 이면 모바일에서도 원본 표를 렌더한다', () => {
    render(
      <ChoiceTableResponse
        question={choiceQuestion({ mobileOriginalTable: true })}
        value={null}
        onChange={() => {}}
      />,
    );
    // 원본 표의 열 라벨이 렌더된다 = TablePreview 경로
    expect(screen.getByText('기술')).toBeInTheDocument();
    expect(screen.getByRole('radio')).toBeInTheDocument();
  });

  it('mobileTableDisplayMode original 이면 legacy boolean 없이도 원본 표를 렌더한다', () => {
    render(
      <ChoiceTableResponse
        question={choiceQuestion({ mobileTableDisplayMode: 'original' })}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('기술')).toBeInTheDocument();
    expect(screen.getByRole('radio')).toBeInTheDocument();
  });
});
