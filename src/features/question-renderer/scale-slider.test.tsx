import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScaleSlider } from '@/features/question-renderer/scale-slider';
import type {
  ScaleSliderModel,
  ScaleSliderSide,
} from '@/features/question-renderer/utils/scale-slider';

/**
 * 척도 슬라이더 컴포넌트 — 모델을 받아 그리고, 누르기와 끌기를 받아 토글 콜백을 부른다
 * (CONTEXT.md 「척도 슬라이더」). 무엇을 그릴지(모델)는 투영 테스트(utils/scale-slider.test.ts)가,
 * 포인터 자리 → 눈금 계산은 utils/scale-slider-drag.test.ts 가 지킨다. 여기서는 바깥에서 보이는 동작만 본다.
 *
 * jsdom 은 배치를 계산하지 않으므로 트랙 범위는 테스트가 준다(왼쪽 100px · 폭 500px).
 * 눈금 5개면 칸 하나가 100px 이고 눈금은 150 · 250 · 350 · 450 · 550 에 선다.
 */

const attrs = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => attrs.value,
  useAnswerQuotes: () => ({}),
}));

afterEach(() => {
  cleanup();
  attrs.value = {};
});

const FIVE_NAMES = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
const RIGHT: ScaleSliderSide[] = ['negative', 'negative', 'neutral', 'positive', 'positive'];
const LEFT: ScaleSliderSide[] = ['positive', 'positive', 'neutral', 'negative', 'negative'];
const CIRC = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬'];

/** 점 타일 5장 — 칸 글자 자체가 이름이라 눈금 글자는 없다 */
const fivePoint = (sides: ScaleSliderSide[] = RIGHT): ScaleSliderModel => ({
  tileKind: 'point',
  ticks: FIVE_NAMES.map((name, n) => ({
    choiceId: `c${n}`,
    text: name,
    name,
    side: sides[n]!,
    bandIndex: null,
  })),
  bands: [],
  offScale: [],
  showsSelectionLabel: false,
  bandsCoverAllTicks: false,
});

/** 점 타일 5장 + 척도 밖 보기 하나 */
const withOffScale: ScaleSliderModel = {
  ...fivePoint(),
  offScale: [{ choiceId: 'na', label: '이용한 적 없음' }],
};

/** 13점에 구간 셋 — 구간 타일이고 눈금 글자와 고른 값 표시를 쓴다 */
const thirteenBands: ScaleSliderModel = {
  tileKind: 'band',
  ticks: CIRC.map((mark, n) => ({
    choiceId: `c${n}`,
    text: mark,
    mark,
    side: n < 6 ? 'negative' : n === 6 ? 'neutral' : 'positive',
    bandIndex: n < 5 ? 0 : n < 8 ? 1 : 2,
  })),
  bands: [
    { label: '불만족', start: 0, span: 5, side: 'negative' },
    { label: '보통', start: 5, span: 3, side: 'neutral' },
    { label: '만족', start: 8, span: 5, side: 'positive' },
  ],
  offScale: [],
  showsSelectionLabel: true,
  bandsCoverAllTicks: true,
};

interface DrawOptions {
  selectedChoiceId?: string;
  onToggleChoice?: (choiceId: string) => void;
  label?: string;
}

function draw(model: ScaleSliderModel, options: DrawOptions = {}) {
  const onToggleChoice = options.onToggleChoice ?? vi.fn();
  const element = (selectedChoiceId: string | undefined) => (
    <ScaleSlider
      questionId="q1"
      sliderId="g1"
      model={model}
      label={options.label ?? ''}
      ariaLabel="주차/접근성"
      selectedChoiceId={selectedChoiceId}
      onToggleChoice={onToggleChoice}
    />
  );
  const view = render(element(options.selectedChoiceId));
  const track = screen.getByTestId('scale-slider-track');
  // 트랙 범위 — 왼쪽 100px, 폭 500px
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
  return {
    track,
    onToggleChoice,
    unmount: view.unmount,
    /** 호스트가 답을 바꿔 다시 그린다 */
    select: (selectedChoiceId: string | undefined) => view.rerender(element(selectedChoiceId)),
  };
}

const down = (track: HTMLElement, clientX: number) =>
  fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX });
const move = (track: HTMLElement, clientX: number) =>
  fireEvent.pointerMove(track, { pointerId: 1, clientX });
const up = (track: HTMLElement, clientX: number) =>
  fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX });

const thumb = () => screen.queryByTestId('scale-slider-thumb');
const fill = () => screen.queryByTestId('scale-slider-fill');
/** 손잡이가 선 자리 — 눈금 n(0부터)은 5눈금에서 (n + 0.5) / 5 */
const thumbLeft = () => thumb()?.style.left;

describe('ScaleSlider — 답하기 전과 답한 뒤', () => {
  it('고른 것이 없으면 손잡이도 채움도 그려지지 않는다', () => {
    draw(fivePoint());
    expect(thumb()).toBeNull();
    expect(fill()).toBeNull();
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(
      true,
    );
  });

  it('고른 눈금에 손잡이가 서고 채움은 손잡이에서 오른쪽 끝까지다', () => {
    draw(fivePoint(), { selectedChoiceId: 'c3' });
    expect(thumbLeft()).toBe('70%');
    expect(fill()!.style.left).toBe('70%');
    expect((screen.getByRole('radio', { name: '만족' }) as HTMLInputElement).checked).toBe(true);
  });

  it('고른 것이 이 척도의 눈금이 아니면 손잡이가 없다', () => {
    draw(fivePoint(), { selectedChoiceId: 'elsewhere' });
    expect(thumb()).toBeNull();
  });
});

describe('ScaleSlider — 트랙 누르기와 끌기', () => {
  it('트랙을 누르면 그 자리의 눈금으로 토글이 정확히 한 번 불린다', () => {
    const { track, onToggleChoice } = draw(fivePoint());
    down(track, 460);
    up(track, 460);
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c3');
  });

  it('누르는 동안에는 그 눈금이 미리보기로 보이고 아직 토글은 불리지 않는다', () => {
    const { track, onToggleChoice } = draw(fivePoint());
    down(track, 460);
    expect(thumbLeft()).toBe('70%');
    expect(thumb()!.dataset['state']).toBe('preview');
    expect(onToggleChoice).not.toHaveBeenCalled();
  });

  it('문턱에 못 미치게 흔들린 손짓은 누르기다 — 누른 자리의 눈금으로 한 번', () => {
    const { track, onToggleChoice } = draw(fivePoint());
    // 칸 경계(400) 바로 왼쪽을 누르고 3px 움직여 경계를 넘었다 — 끌기가 아니라 누른 눈금이다
    down(track, 398);
    move(track, 401);
    up(track, 401);
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c2');
  });

  it('끄는 동안 토글이 0번이고 손잡이만 따라간다. 다른 눈금에서 놓으면 그 눈금으로 1번', () => {
    const { track, onToggleChoice } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    down(track, 450);
    move(track, 360);
    expect(thumbLeft()).toBe('50%');
    move(track, 160);
    expect(thumbLeft()).toBe('10%');
    expect(thumb()!.dataset['state']).toBe('preview');
    expect(onToggleChoice).not.toHaveBeenCalled();
    // 끄는 중에도 실제로 고른 것은 그대로다
    expect((screen.getByRole('radio', { name: '만족' }) as HTMLInputElement).checked).toBe(true);
    up(track, 160);
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c0');
  });

  it('끌다가 고른 눈금에 다시 놓으면 토글이 불리지 않는다 — 답이 풀리지 않는다', () => {
    const { track, onToggleChoice } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    down(track, 450);
    move(track, 160);
    move(track, 451);
    up(track, 451);
    expect(onToggleChoice).not.toHaveBeenCalled();
    // 미리보기는 버려지고 손잡이는 고른 자리에 선다
    expect(thumbLeft()).toBe('70%');
    expect(thumb()!.dataset['state']).toBe('selected');
  });

  it('고른 것이 없을 때 끌다가 누른 눈금에 다시 놓으면 그 눈금으로 한 번 불린다', () => {
    const { track, onToggleChoice } = draw(fivePoint());
    down(track, 450);
    move(track, 160);
    move(track, 450);
    up(track, 450);
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c3');
  });

  it('고른 눈금을 끌지 않고 누르면 그 눈금으로 토글이 한 번 불린다 — 풀기는 호스트 몫이다', () => {
    const { track, onToggleChoice, select } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    down(track, 450);
    up(track, 450);
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c3');
    // 호스트가 답을 풀면 손잡이가 사라진다
    select(undefined);
    expect(thumb()).toBeNull();
  });

  it('트랙 밖으로 끌어도 양끝 눈금에 붙는다', () => {
    const { track, onToggleChoice } = draw(fivePoint());
    down(track, 350);
    move(track, 900);
    expect(thumbLeft()).toBe('90%');
    up(track, 900);
    expect(onToggleChoice).toHaveBeenCalledWith('c4');
  });

  it('취소되면 미리보기를 버리고 토글이 불리지 않는다', () => {
    const { track, onToggleChoice } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    down(track, 450);
    move(track, 160);
    fireEvent.pointerCancel(track, { pointerId: 1 });
    expect(thumbLeft()).toBe('70%');
    expect(thumb()!.dataset['state']).toBe('selected');
    // 취소 뒤에 늦게 온 놓기는 무시한다
    up(track, 160);
    expect(onToggleChoice).not.toHaveBeenCalled();
  });

  it('고른 것이 없을 때 취소되면 손잡이가 남지 않는다', () => {
    const { track, onToggleChoice } = draw(fivePoint());
    down(track, 450);
    expect(thumb()).not.toBeNull();
    fireEvent.pointerCancel(track, { pointerId: 1 });
    expect(thumb()).toBeNull();
    expect(onToggleChoice).not.toHaveBeenCalled();
  });

  it('끄는 중에 화면에서 사라지면 토글이 불리지 않는다', () => {
    const { track, onToggleChoice, unmount } = draw(fivePoint());
    down(track, 450);
    move(track, 160);
    unmount();
    fireEvent.pointerUp(document.body, { pointerId: 1, button: 0, clientX: 160 });
    expect(screen.queryByTestId('scale-slider-thumb')).toBeNull();
    expect(onToggleChoice).not.toHaveBeenCalled();
  });

  it('다른 포인터의 움직임과 놓기는 지금 손짓에 끼어들지 않는다', () => {
    const { track, onToggleChoice } = draw(fivePoint());
    down(track, 450);
    fireEvent.pointerMove(track, { pointerId: 2, clientX: 160 });
    fireEvent.pointerUp(track, { pointerId: 2, button: 0, clientX: 160 });
    expect(thumbLeft()).toBe('70%');
    expect(onToggleChoice).not.toHaveBeenCalled();
    up(track, 450);
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c3');
  });

  it('마우스 오른쪽 단추는 받지 않는다', () => {
    const { track, onToggleChoice } = draw(fivePoint());
    fireEvent.pointerDown(track, { pointerId: 1, button: 2, clientX: 450 });
    expect(thumb()).toBeNull();
    fireEvent.pointerUp(track, { pointerId: 1, button: 2, clientX: 450 });
    expect(onToggleChoice).not.toHaveBeenCalled();
  });

  it('트랙 폭을 알 수 없으면 그 포인터는 아무 눈금도 고르지 않는다', () => {
    const { track, onToggleChoice } = draw(fivePoint());
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));
    down(track, 450);
    up(track, 450);
    expect(thumb()).toBeNull();
    expect(onToggleChoice).not.toHaveBeenCalled();
  });
});

describe('ScaleSlider — 타일', () => {
  it('점 타일을 누르면 그 눈금으로 토글이 불리고, 고른 타일만 강조된다', () => {
    const { onToggleChoice } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    const tiles = within(screen.getByTestId('scale-slider-tiles'));
    fireEvent.click(tiles.getByText('매우 만족'));
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c4');

    const states = FIVE_NAMES.map(
      (name) => tiles.getByText(name).closest<HTMLElement>('[data-tile]')!.dataset['state'],
    );
    expect(states).toEqual(['idle', 'idle', 'idle', 'selected', 'idle']);
  });

  it('고른 점 타일을 다시 눌러도 토글이 그 눈금으로 불린다', () => {
    const { onToggleChoice } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    fireEvent.click(within(screen.getByTestId('scale-slider-tiles')).getByText('만족'));
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c3');
  });

  it('끄는 동안에는 손잡이가 지나는 타일이 미리보기로 바뀌고 고른 타일의 강조는 내려간다', () => {
    const { track } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    down(track, 450);
    move(track, 160);
    const tiles = within(screen.getByTestId('scale-slider-tiles'));
    const stateOf = (name: string) =>
      tiles.getByText(name).closest<HTMLElement>('[data-tile]')!.dataset['state'];
    expect(stateOf('매우 불만족')).toBe('preview');
    expect(stateOf('만족')).toBe('idle');
  });

  it('구간 타일은 덮는 눈금 수만큼 자리를 쓰고, 눌러도 아무 일이 없으며 버튼 역할이 아니다', () => {
    const { onToggleChoice } = draw(thirteenBands, { selectedChoiceId: 'c9' });
    const row = screen.getByTestId('scale-slider-tiles');
    const tile = (name: string) => within(row).getByText(name).closest<HTMLElement>('[data-tile]')!;
    expect(tile('불만족').style.gridColumn).toBe('1 / span 5');
    expect(tile('보통').style.gridColumn).toBe('6 / span 3');
    expect(tile('만족').style.gridColumn).toBe('9 / span 5');

    fireEvent.click(tile('불만족'));
    fireEvent.pointerDown(tile('불만족'), { pointerId: 1, button: 0, clientX: 150 });
    fireEvent.pointerUp(tile('불만족'), { pointerId: 1, button: 0, clientX: 150 });
    expect(onToggleChoice).not.toHaveBeenCalled();
    expect(row.querySelector('button, label, [role="button"], [tabindex]')).toBeNull();
    // 손잡이가 들어온 구간만 강조된다
    expect(tile('만족').dataset['state']).toBe('selected');
    expect(tile('불만족').dataset['state']).toBe('idle');
    expect(tile('보통').dataset['state']).toBe('idle');
  });

  it('구간 타일은 언제나 제 구간의 쪽 색이다 — 손잡이의 눈금과 쪽이 달라도', () => {
    // 여섯째 눈금(c5)은 부정 쪽이지만 그 눈금을 덮는 「보통」 구간은 중립이다
    draw(thirteenBands, { selectedChoiceId: 'c5' });
    const row = within(screen.getByTestId('scale-slider-tiles'));
    const tile = (name: string) => row.getByText(name).closest<HTMLElement>('[data-tile]')!;
    expect(tile('보통').dataset['state']).toBe('selected');
    expect(tile('보통').dataset['side']).toBe('neutral');
    expect(thumb()!.dataset['side']).toBe('negative');
    expect(fill()!.dataset['side']).toBe('negative');
  });

  it('타일 줄과 트랙은 같은 열 틀을 쓴다 — 눈금이 타일 가운데 아래에 온다', () => {
    draw(fivePoint());
    const template = 'repeat(5, minmax(0, 1fr))';
    expect(screen.getByTestId('scale-slider-tiles').style.gridTemplateColumns).toBe(template);
    // 손잡이 자리는 같은 폭 칸의 한가운데다
    cleanup();
    draw(fivePoint(), { selectedChoiceId: 'c0' });
    expect(thumbLeft()).toBe('10%');
  });

  it('번호뿐인 척도에는 타일 줄이 없고 눈금 아래 번호만 있다', () => {
    const model: ScaleSliderModel = {
      ...thirteenBands,
      tileKind: 'none',
      bands: [],
      ticks: thirteenBands.ticks.map((tick) => ({ ...tick, bandIndex: null })),
      showsSelectionLabel: false,
      bandsCoverAllTicks: false,
    };
    draw(model);
    expect(screen.queryByTestId('scale-slider-tiles')).toBeNull();
    expect(screen.queryByTestId('scale-slider-band-names')).toBeNull();
    const marks = screen.getByTestId('scale-slider-marks');
    expect([...marks.children].map((el) => el.textContent)).toEqual(CIRC);
  });

  it('칸 글자가 타일 이름과 같으면 눈금 아래에 다시 적지 않는다', () => {
    draw(fivePoint());
    expect(screen.queryByTestId('scale-slider-marks')).toBeNull();
  });

  it('구간이 눈금을 다 덮지 못하면 타일 상자 없이 이름을 글자로만 둔다 — 양끝은 양쪽으로 붙는다', () => {
    const model: ScaleSliderModel = {
      tileKind: 'band',
      ticks: CIRC.slice(0, 5).map((mark, n) => ({
        choiceId: `c${n}`,
        text: mark,
        mark,
        side: RIGHT[n]!,
        bandIndex: n === 0 ? 0 : n === 4 ? 1 : null,
      })),
      bands: [
        { label: '전혀 그렇지 않다', start: 0, span: 1, side: 'negative' },
        { label: '매우 그렇다', start: 4, span: 1, side: 'positive' },
      ],
      offScale: [],
      showsSelectionLabel: true,
      bandsCoverAllTicks: false,
    };
    const { onToggleChoice } = draw(model);
    expect(screen.queryByTestId('scale-slider-tiles')).toBeNull();
    const names = screen.getByTestId('scale-slider-band-names');
    const left = within(names).getByText('전혀 그렇지 않다');
    const right = within(names).getByText('매우 그렇다');
    expect(left.dataset['align']).toBe('start');
    expect(right.dataset['align']).toBe('end');
    // 이름은 제 한 칸보다 넓은 자리를 쓴다
    expect(left.style.gridColumn).toBe('1 / span 2');
    expect(right.style.gridColumn).toBe('4 / span 2');
    fireEvent.click(left);
    expect(onToggleChoice).not.toHaveBeenCalled();
    expect(names.querySelector('button, label, [role="button"], [tabindex]')).toBeNull();
  });
});

describe('ScaleSlider — 고른 값 표시', () => {
  it('구간이 있는 척도는 고른 눈금의 「칸 글자 · 구간 이름」을 보인다', () => {
    draw(thirteenBands, { selectedChoiceId: 'c9', label: '다양한 인적 네트워크 형성' });
    const shown = screen.getByTestId('scale-slider-selection');
    expect(shown.textContent).toBe('⑩ · 만족');
    expect(shown.dataset['side']).toBe('positive');
    expect(screen.getByText('다양한 인적 네트워크 형성')).toBeTruthy();
  });

  it('고른 것이 없으면 표시가 없고, 끄는 동안에는 손잡이가 선 눈금을 보인다', () => {
    const { track } = draw(thirteenBands);
    expect(screen.queryByTestId('scale-slider-selection')).toBeNull();
    // 13눈금 — 칸 하나가 500/13 px. 둘째 눈금(①부터 세어 ②)의 한가운데는 100 + 1.5 × 500/13
    down(track, 100 + (1.5 * 500) / 13);
    move(track, 100 + (2.5 * 500) / 13);
    expect(screen.getByTestId('scale-slider-selection').textContent).toBe('③ · 불만족');
    expect(screen.getByTestId('scale-slider-selection').dataset['side']).toBe('negative');
  });

  it('구간이 덮지 않는 눈금은 칸 글자만 보인다', () => {
    const model: ScaleSliderModel = {
      ...thirteenBands,
      bands: [thirteenBands.bands[0]!],
      ticks: thirteenBands.ticks.map((tick) => ({
        ...tick,
        bandIndex: tick.bandIndex === 0 ? 0 : null,
      })),
      bandsCoverAllTicks: false,
    };
    draw(model, { selectedChoiceId: 'c9' });
    expect(screen.getByTestId('scale-slider-selection').textContent).toBe('⑩');
  });

  it('점 타일만 있는 척도에는 표시를 두지 않는다 — 고른 타일이 곧 표시다', () => {
    // 제목이 있어 머리 줄이 그려지는 자리에서도 표시는 없다
    draw(fivePoint(), { selectedChoiceId: 'c3', label: '거리 청결' });
    expect(screen.getByText('거리 청결')).toBeTruthy();
    expect(screen.queryByTestId('scale-slider-selection')).toBeNull();
  });
});

describe('ScaleSlider — 척도 밖 체크', () => {
  it('체크를 누르면 그 보기로 토글이 불린다', () => {
    const { onToggleChoice } = draw(withOffScale);
    fireEvent.click(screen.getByText('이용한 적 없음'));
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('na');
  });

  it('그 보기가 고른 것이면 체크되고 손잡이와 채움이 없다', () => {
    draw(withOffScale, { selectedChoiceId: 'na' });
    expect(
      (screen.getByRole('radio', { name: '이용한 적 없음' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(thumb()).toBeNull();
    expect(fill()).toBeNull();
    const tiles = screen.getByTestId('scale-slider-tiles');
    expect(tiles.querySelector('[data-state="selected"]')).toBeNull();
  });

  it('체크된 줄에서 트랙을 누르면 그 눈금으로 토글이 불린다 — 체크를 푸는 것은 호스트의 단일 선택이다', () => {
    const { track, onToggleChoice } = draw(withOffScale, { selectedChoiceId: 'na' });
    down(track, 250);
    up(track, 250);
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c1');
  });

  it('척도 밖 보기가 둘이면 체크도 둘이고 행 순서대로 선다', () => {
    draw({
      ...fivePoint(),
      offScale: [
        { choiceId: 'dk', label: '모름' },
        { choiceId: 'na', label: '해당 없음' },
      ],
    });
    const checks = screen.getByTestId('scale-slider-off-scale');
    expect(within(checks).getAllByRole('radio')).toHaveLength(2);
    expect([...checks.children].map((el) => el.textContent)).toEqual(['모름', '해당 없음']);
  });

  it('척도 밖 보기가 없으면 체크 자리를 두지 않는다', () => {
    draw(fivePoint());
    expect(screen.queryByTestId('scale-slider-off-scale')).toBeNull();
  });
});

describe('ScaleSlider — 쪽 색', () => {
  it.each([
    { title: '오른쪽이 긍정', sides: RIGHT },
    { title: '왼쪽이 긍정', sides: LEFT },
  ])('$title — 채움·손잡이·고른 타일이 고른 눈금의 쪽을 따른다', ({ sides }) => {
    const { select } = draw(fivePoint(sides), { selectedChoiceId: 'c0' });
    const selectedTile = () =>
      screen.getByTestId('scale-slider-tiles').querySelector<HTMLElement>('[data-state="selected"]')!;
    for (const [n, side] of sides.entries()) {
      select(`c${n}`);
      expect(thumb()!.dataset['side']).toBe(side);
      expect(fill()!.dataset['side']).toBe(side);
      expect(selectedTile().dataset['side']).toBe(side);
      expect(selectedTile().textContent).toBe(FIVE_NAMES[n]);
    }
  });

  it('고르지 않은 타일도 제 눈금의 쪽을 싣는다', () => {
    draw(fivePoint(LEFT));
    const tiles = [
      ...screen.getByTestId('scale-slider-tiles').querySelectorAll<HTMLElement>('[data-tile]'),
    ];
    expect(tiles.map((tile) => tile.dataset['side'])).toEqual(LEFT);
  });
});

describe('ScaleSlider — 낭독과 묶음', () => {
  it('눈금과 척도 밖 체크가 native radio 묶음 하나로 나온다', () => {
    draw(withOffScale, { selectedChoiceId: 'c3' });
    const group = screen.getByRole('radiogroup', { name: '주차/접근성' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(6);
    expect(radios.every((radio) => radio.type === 'radio')).toBe(true);
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.getAttribute('aria-label'))).toEqual(
      ['만족'],
    );
  });

  it('눈금마다 이름이 읽힌다 — 눈금 글자와 타일 이름, 구간 이름', () => {
    // 점 타일 + 눈금 글자
    draw({
      ...fivePoint(),
      ticks: fivePoint().ticks.map((tick, n) => ({ ...tick, text: CIRC[n]!, mark: CIRC[n]! })),
    });
    expect(screen.getByRole('radio', { name: '① 매우 불만족' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '⑤ 매우 만족' })).toBeTruthy();
    cleanup();
    // 구간 타일
    draw(thirteenBands);
    expect(screen.getByRole('radio', { name: '① 불만족' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '⑦ 보통' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '⑬ 만족' })).toBeTruthy();
    cleanup();
    // 칸 글자 자체가 이름이면 한 번만 읽는다
    draw(fivePoint());
    expect(screen.getByRole('radio', { name: '매우 불만족' })).toBeTruthy();
  });

  it('낭독기가 눈금 라디오를 직접 누르면 그 눈금으로 토글이 불린다', () => {
    const { onToggleChoice } = draw(thirteenBands);
    fireEvent.click(screen.getByRole('radio', { name: '⑩ 만족' }));
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c9');
  });

  it('제목을 보이면 그 글자가 묶음 이름이다', () => {
    draw(fivePoint(), { label: '거리 청결' });
    expect(screen.getByRole('radiogroup', { name: '거리 청결' })).toBeTruthy();
  });

  it('같은 문항이 여러 번 그려져도 입력 id 가 겹치지 않는다', () => {
    const one = render(
      <ScaleSlider
        questionId="q1"
        sliderId="g1"
        model={fivePoint()}
        label=""
        selectedChoiceId={undefined}
        onToggleChoice={() => {}}
        inputIdScope="preview"
      />,
    );
    const scoped = [...one.container.querySelectorAll('input')].map((input) => input.id);
    one.unmount();
    draw(fivePoint());
    const plain = screen.getAllByRole('radio').map((input) => input.id);
    expect(scoped.filter((id) => plain.includes(id))).toEqual([]);
    expect(new Set(plain).size).toBe(plain.length);
  });

  it('글자의 명단 토큰은 치환한 값으로 보이고 읽힌다', () => {
    attrs.value = { 시설: '공영주차장' };
    draw({
      ...withOffScale,
      ticks: withOffScale.ticks.map((tick, n) =>
        n === 0 ? { ...tick, text: '{{시설}} 불만', name: '{{시설}} 불만' } : tick,
      ),
      offScale: [{ choiceId: 'na', label: '{{시설}} 이용 안 함' }],
    });
    expect(screen.getByRole('radio', { name: '공영주차장 불만' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '공영주차장 이용 안 함' })).toBeTruthy();
    expect(within(screen.getByTestId('scale-slider-tiles')).getByText('공영주차장 불만')).toBeTruthy();
  });
});
