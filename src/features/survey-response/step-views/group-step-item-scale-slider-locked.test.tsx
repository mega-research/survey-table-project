import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PriorAnswersProvider } from '@/features/question-renderer/prior-answers-context';
import { GroupStepItem } from '@/features/survey-response/step-views/group-step-item';
import { CHANGE_CONFIRM_KEY } from '@/lib/survey/change-confirmation';
import type { Question, TableCell } from '@/types/survey';
import type { StepItem } from '@/utils/group-ordering';

/**
 * 이월 응답으로 잠긴 문항의 척도 슬라이더 — 응답 화면의 문항 카드(잠금을 거는 자리)까지 이은 통합 테스트
 * (CONTEXT.md 「척도 슬라이더」 · 「변동 확인」).
 *
 * 이월 값이 있는 문항은 「달라짐」을 고르기 전까지 잠긴다. 잠금은 문항 카드가 입력 영역을 `fieldset disabled`
 * 로 감싸는 것 하나이고, 슬라이더에는 잠금 prop 이 없다 — 안쪽 native radio 의 비활성 상태를 읽는다.
 * 트랙은 폼 컨트롤이 아니라 fieldset 이 직접 막아 주지 않으므로, 이 사슬이 끊기면 잠긴 답이 눌린다.
 *
 * jsdom 은 배치를 계산하지 않으므로 트랙 범위는 테스트가 준다(왼쪽 100px · 폭 500px, 눈금 5개).
 */

vi.mock('@/utils/branch-logic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/branch-logic')>()),
  shouldDisplayQuestion: () => true,
}));
vi.mock('@/hooks/use-media-query', () => ({ useMobileView: () => false, useMediaQuery: () => false }));

const LABELS = ['전혀 없다', '없다', '보통이다', '있다', '매우 있다'];

/** 보통 라디오 문항(보기 목록) — 문항 설정으로 켠 슬라이더 */
const radioQuestion: Question = {
  id: 'q7',
  type: 'radio',
  title: '추천 의향',
  required: true,
  order: 1,
  scaleSlider: 'positive-right',
  options: LABELS.map((label, n) => ({ id: `o${n + 1}`, label, value: String(n + 1) })),
} as unknown as Question;

/** 그룹 없는 보기 소스 표 — 같은 문항 설정이 표의 보기 칸을 슬라이더로 만든다 */
const tableQuestion: Question = {
  id: 'q8',
  type: 'radio',
  title: '전반적 만족도',
  required: true,
  order: 2,
  scaleSlider: 'positive-right',
  mobileDrilldownOmitLeadingColumns: 1,
  tableColumns: [
    { id: 'item', label: '구분' },
    ...LABELS.map((label, n) => ({ id: `s${n}`, label })),
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '전반적 만족도',
      cells: [
        { id: 'r1-item', type: 'text', content: '전반적 만족도' },
        ...['①', '②', '③', '④', '⑤'].map(
          (content, n): TableCell => ({
            id: `r1-sat${n}`,
            type: 'choice_opt',
            content,
            choiceLabel: LABELS[n]!,
          }),
        ),
      ],
    },
  ],
} as unknown as Question;

const toItem = (question: Question): StepItem => ({
  question,
  rootGroupId: null,
  rootGroupName: null,
  subgroupName: null,
});

function renderItem(
  question: Question,
  options: { prior: Record<string, unknown> | null; responses?: Record<string, unknown> },
) {
  const onResponse = vi.fn();
  render(
    <PriorAnswersProvider
      answers={options.prior}
      confirmAnswers={options.prior}
      highlightAnswers={null}
      waveLabel={null}
      changeConfirmEnabled={options.prior !== null}
    >
      <GroupStepItem
        item={toItem(question)}
        showSubgroupHeading={false}
        responses={options.responses ?? {}}
        questions={[question]}
        onResponse={onResponse}
        isHighlighted={false}
        showRequiredMessage={false}
        showChangeConfirmMessage={false}
      />
    </PriorAnswersProvider>,
  );
  return { onResponse };
}

function trackOf(sliderTestId: string): HTMLElement {
  const track = within(screen.getByTestId(sliderTestId)).getByTestId('scale-slider-track');
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
const drag = (track: HTMLElement, from: number, to: number) => {
  fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX: from });
  fireEvent.pointerMove(track, { pointerId: 1, button: 0, clientX: to });
  fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX: to });
};
/** 그 문항의 답 쓰기 — 변동 확인 등 다른 키의 쓰기는 세지 않는다 */
const answerWrites = (onResponse: ReturnType<typeof vi.fn>, questionId: string) =>
  onResponse.mock.calls.filter(([key]) => key === questionId);

describe('이월로 잠긴 라디오 문항의 척도 슬라이더', () => {
  it('잠긴 문항의 슬라이더는 눌리지 않는다 — 트랙 누르기 · 끌기 · 점 타일 · 키보드', () => {
    const { onResponse } = renderItem(radioQuestion, { prior: { q7: '2' } });
    const slider = screen.getByTestId('scale-slider-q7');
    // 이월 값의 자리에 손잡이가 서 있고, 안쪽 라디오는 전부 비활성이다
    expect(within(slider).getByTestId('scale-slider-thumb')).toBeInTheDocument();
    for (const radio of within(slider).getAllByRole('radio')) expect(radio).toBeDisabled();

    const track = trackOf('scale-slider-q7');
    press(track, TICK_X[4]!);
    drag(track, TICK_X[1]!, TICK_X[3]!);
    fireEvent.click(slider.querySelector('[data-tile="point"]')!);
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    fireEvent.keyDown(track, { key: 'Delete' });
    expect(answerWrites(onResponse, 'q7')).toHaveLength(0);
  });

  it('「달라짐」을 고르면 잠금이 풀려 슬라이더로 답할 수 있다', () => {
    const responses = { q7: '2', [CHANGE_CONFIRM_KEY]: { q7: 'changed' } };
    const { onResponse } = renderItem(radioQuestion, { prior: { q7: '2' }, responses });
    press(trackOf('scale-slider-q7'), TICK_X[4]!);
    expect(answerWrites(onResponse, 'q7')).toEqual([['q7', '5']]);
  });

  it('이월 값이 없는 문항은 처음부터 잠기지 않는다', () => {
    const { onResponse } = renderItem(radioQuestion, { prior: null });
    press(trackOf('scale-slider-q7'), TICK_X[2]!);
    expect(answerWrites(onResponse, 'q7')).toEqual([['q7', '3']]);
  });
});

describe('이월로 잠긴 그룹 없는 보기 소스 표의 척도 슬라이더', () => {
  it('잠긴 문항의 슬라이더는 눌리지 않는다', () => {
    const { onResponse } = renderItem(tableQuestion, { prior: { q8: 'r1-sat1' } });
    const slider = screen.getByTestId('scale-slider-run:r1-sat0');
    expect(within(slider).getByTestId('scale-slider-thumb')).toBeInTheDocument();
    const track = trackOf('scale-slider-run:r1-sat0');
    press(track, TICK_X[4]!);
    drag(track, TICK_X[1]!, TICK_X[3]!);
    expect(answerWrites(onResponse, 'q8')).toHaveLength(0);
  });

  it('잠기지 않은 문항은 슬라이더로 답한 보기 칸 id 가 쓰인다', () => {
    const { onResponse } = renderItem(tableQuestion, { prior: null });
    press(trackOf('scale-slider-run:r1-sat0'), TICK_X[3]!);
    expect(answerWrites(onResponse, 'q8')).toEqual([['q8', 'r1-sat3']]);
  });
});
