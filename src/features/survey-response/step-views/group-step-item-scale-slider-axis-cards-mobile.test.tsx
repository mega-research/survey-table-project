import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';
import type { Question, TableCell } from '@/types/survey';
import type { StepItem } from '@/utils/group-ordering';

import { GroupStepItem } from './group-step-item';

/**
 * 척도 슬라이더가 배치를 가져간 보기 소스 표의 필수 안내 — 응답 화면의 문항 카드까지 이은 통합 테스트
 * (CONTEXT.md 「척도 슬라이더」 · 「축 단위 카드」).
 *
 * 모바일 「축 단위 카드」는 미충족 카드마다 제 아래에 검증 안내 상자를 그리므로, 문항 카드는 문항 아래의
 * 상자와 한 줄 문구를 내지 않는다. 그런데 슬라이더로 그려지는 행이 있으면 좁은 화면은 축 단위 카드가 아니라
 * 행 단위 배치다 — 문항 카드가 저작자가 고른 방식만 보고 상자를 거두면 필수 안내가 어디에도 없다.
 */

vi.mock('@/utils/branch-logic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/branch-logic')>()),
  shouldDisplayQuestion: () => true,
}));
vi.mock('@/hooks/use-media-query', () => ({ useMobileView: () => true, useMediaQuery: () => true }));

const NAMES = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
const CIRC = ['①', '②', '③', '④', '⑤'];

/** 만족도 그룹 하나를 슬라이더로 그리는 보기 소스 표 — 필수이고 아직 답하지 않았다 */
function sliderQuestion(mode: Question['mobileTableDisplayMode'], slider = true): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '시설 만족도',
    required: true,
    order: 1,
    mobileTableDisplayMode: mode,
    mobileDrilldownOmitLeadingColumns: 1,
    choiceGroups: [
      {
        id: 'g-sat',
        type: 'radio',
        groupKey: 'rad1',
        label: '만족도',
        ...(slider ? { scaleSlider: 'positive-right' } : {}),
      },
    ],
    tableColumns: [
      { id: 'item', label: '구분' },
      ...NAMES.map((label, n) => ({ id: `s${n}`, label })),
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '주차/접근성',
        cells: [
          { id: 'r1-item', type: 'text', content: '주차/접근성' },
          ...CIRC.map(
            (content, n): TableCell => ({
              id: `r1-sat${n}`,
              type: 'choice_opt',
              content,
              choiceLabel: NAMES[n]!,
              choiceGroupId: 'g-sat',
            }),
          ),
        ],
      },
    ],
  } as unknown as Question;
}

const toItem = (question: Question): StepItem => ({
  question,
  rootGroupId: null,
  rootGroupName: null,
  subgroupName: null,
});

function renderUnfilled(question: Question) {
  return render(
    <GroupStepItem
      item={toItem(question)}
      showSubgroupHeading={false}
      responses={{}}
      questions={[question]}
      onResponse={vi.fn()}
      isHighlighted
      showRequiredMessage
      showChangeConfirmMessage={false}
    />,
  );
}

/** 문항 아래 필수 안내 — 상자 수와 「위치로 이동」 버튼 수 */
const notice = () => ({
  alerts: screen.queryAllByRole('alert').length,
  jumps: screen.queryAllByRole('button', { name: '위치로 이동' }).length,
});

describe('GroupStepItem — 슬라이더가 배치를 가져간 보기 소스 표의 필수 안내', () => {
  it('「축 단위 카드」로 둔 표도 문항 아래에 검증 안내 상자가 선다 — 축 카드는 그려지지 않는다', () => {
    renderUnfilled(sliderQuestion('axis-cards'));
    expect(screen.getByTestId('mobile-row-wise-original-sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('axis-card-g-sat')).not.toBeInTheDocument();
    expect(notice()).toEqual({ alerts: 1, jumps: 1 });
  });

  it('어느 표시 방식으로 두었어도 필수 안내는 「행별 척도」와 같다', () => {
    const baselineView = renderUnfilled(sliderQuestion('row-wise-scale'));
    const baseline = notice();
    baselineView.unmount();
    expect(baseline).toEqual({ alerts: 1, jumps: 1 });
    for (const mode of MOBILE_TABLE_DISPLAY_MODES) {
      if (mode === 'row-group-cards') continue;
      const view = renderUnfilled(sliderQuestion(mode));
      expect(notice(), mode).toEqual(baseline);
      view.unmount();
    }
  });

  it('슬라이더 설정이 없는 「축 단위 카드」는 그대로 카드 아래에만 상자를 둔다', () => {
    renderUnfilled(sliderQuestion('axis-cards', false));
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.previousElementSibling).toHaveAttribute('data-testid', 'axis-card-g-sat');
  });
});
