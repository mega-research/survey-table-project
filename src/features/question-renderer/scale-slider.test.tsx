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

/** 점 타일 7장 + 눈금 글자 — 칸 글자는 번호이고 이름은 머리에서 온다 */
const SEVEN_NAMES = [
  '전혀 그렇지 않다',
  '그렇지 않다',
  '약간 그렇지 않다',
  '보통',
  '약간 그렇다',
  '그렇다',
  '매우 그렇다',
];
const sevenMarked: ScaleSliderModel = {
  tileKind: 'point',
  ticks: SEVEN_NAMES.map((name, n) => ({
    choiceId: `c${n}`,
    text: CIRC[n]!,
    name,
    mark: CIRC[n]!,
    side: n < 3 ? 'negative' : n === 3 ? 'neutral' : 'positive',
    bandIndex: null,
  })),
  bands: [],
  offScale: [],
  showsSelectionLabel: false,
  bandsCoverAllTicks: false,
};

interface DrawOptions {
  selectedChoiceId?: string;
  onToggleChoice?: (choiceId: string) => void;
  label?: string;
  invalid?: boolean;
  disabledChoiceIds?: ReadonlySet<string>;
  narrow?: boolean;
  /** 문항을 감싼 fieldset 의 잠금(이월 잠금) — 컴포넌트에는 prop 으로 가지 않는다 */
  fieldsetDisabled?: boolean;
}

function draw(model: ScaleSliderModel, options: DrawOptions = {}) {
  const onToggleChoice = options.onToggleChoice ?? vi.fn();
  const element = (
    selectedChoiceId: string | undefined,
    fieldsetDisabled = options.fieldsetDisabled,
  ) => (
    <fieldset data-testid="question-lock" disabled={fieldsetDisabled ?? false}>
      <ScaleSlider
        questionId="q1"
        sliderId="g1"
        model={model}
        label={options.label ?? ''}
        ariaLabel="주차/접근성"
        selectedChoiceId={selectedChoiceId}
        onToggleChoice={onToggleChoice}
        invalid={options.invalid}
        disabledChoiceIds={options.disabledChoiceIds}
        narrow={options.narrow}
      />
    </fieldset>
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

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
/** 그 라디오에 포커스를 두고 키를 누른다 — 탭으로 들어온 뒤의 키 입력 */
const press = (name: string, key: string) => {
  radio(name).focus();
  return fireEvent.keyDown(radio(name), { key });
};
/** 포커스가 선 라디오의 이름 — 눈금은 aria-label, 척도 밖 체크는 제 라벨 글자 */
const focusedName = () => {
  const focused = document.activeElement as HTMLInputElement | null;
  return focused?.getAttribute('aria-label') ?? focused?.labels?.[0]?.textContent;
};

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

describe('ScaleSlider — 키보드', () => {
  it('화살표로 옮길 때마다 토글이 그 눈금으로 불리고 포커스가 따라간다', () => {
    const { onToggleChoice, select } = draw(fivePoint(), { selectedChoiceId: 'c2' });
    press('보통', 'ArrowRight');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c3');
    expect(focusedName()).toBe('만족');
    select('c3');
    press('만족', 'ArrowLeft');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c2');
    expect(focusedName()).toBe('보통');
    select('c2');
    // 위·아래 화살표는 라디오 묶음의 관례대로다 — 아래가 다음, 위가 이전
    press('보통', 'ArrowDown');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c3');
    select('c3');
    press('만족', 'ArrowUp');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c2');
    expect(onToggleChoice).toHaveBeenCalledTimes(4);
  });

  it('양끝에서는 넘어가지 않는다 — 반대편으로 돌지 않고 답도 풀리지 않는다', () => {
    const { onToggleChoice, select } = draw(fivePoint(), { selectedChoiceId: 'c4' });
    // 브라우저의 라디오 묶음 기본 이동(반대편으로 돈다)도 막는다
    expect(press('매우 만족', 'ArrowRight')).toBe(false);
    expect(focusedName()).toBe('매우 만족');
    select('c0');
    expect(press('매우 불만족', 'ArrowLeft')).toBe(false);
    expect(focusedName()).toBe('매우 불만족');
    expect(onToggleChoice).not.toHaveBeenCalled();
  });

  it('포커스가 고른 눈금 밖에 있다가 화살표로 고른 눈금에 들어가도 답이 풀리지 않는다', () => {
    // 조회 전용 화면처럼 호스트가 쓰기를 무시하면 포커스만 옮겨 가고 고른 것은 제자리다
    const { onToggleChoice } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    press('보통', 'ArrowRight');
    expect(focusedName()).toBe('만족');
    expect(onToggleChoice).not.toHaveBeenCalled();
  });

  it('답하기 전에 탭으로 들어와 화살표를 누르면 옆 눈금이 답이 된다', () => {
    const { onToggleChoice } = draw(fivePoint());
    press('매우 불만족', 'ArrowRight');
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c1');
  });

  it('Home 은 첫 눈금, End 는 끝 눈금으로 옮긴다', () => {
    const { onToggleChoice, select } = draw(withOffScale, { selectedChoiceId: 'c2' });
    press('보통', 'End');
    // 끝 눈금이다 — 척도 밖 체크가 아니다
    expect(onToggleChoice).toHaveBeenLastCalledWith('c4');
    expect(focusedName()).toBe('매우 만족');
    select('c4');
    press('매우 만족', 'Home');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c0');
    expect(focusedName()).toBe('매우 불만족');
    select('c0');
    // 이미 그 자리면 아무것도 부르지 않는다
    press('매우 불만족', 'Home');
    expect(onToggleChoice).toHaveBeenCalledTimes(2);
  });

  it('끝 눈금 다음은 척도 밖 체크다 — 키보드로 닿을 길이 화살표뿐이다', () => {
    const { onToggleChoice, select } = draw(withOffScale, { selectedChoiceId: 'c4' });
    press('매우 만족', 'ArrowRight');
    expect(onToggleChoice).toHaveBeenLastCalledWith('na');
    expect(focusedName()).toBe('이용한 적 없음');
    select('na');
    // 체크가 묶음의 끝이다
    press('이용한 적 없음', 'ArrowRight');
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    press('이용한 적 없음', 'ArrowLeft');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c4');
    expect(focusedName()).toBe('매우 만족');
  });

  it('Delete·Backspace 는 고른 것으로 토글을 부른다 — 풀기는 호스트 몫이다', () => {
    const { onToggleChoice, select } = draw(withOffScale, { selectedChoiceId: 'c3' });
    press('만족', 'Delete');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c3');
    press('만족', 'Backspace');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c3');
    expect(onToggleChoice).toHaveBeenCalledTimes(2);
    // 척도 밖 체크도 같은 길로 푼다
    select('na');
    press('이용한 적 없음', 'Delete');
    expect(onToggleChoice).toHaveBeenLastCalledWith('na');
  });

  it('고른 것이 없으면 Delete·Backspace 는 아무것도 부르지 않는다', () => {
    const { onToggleChoice, select } = draw(fivePoint());
    press('매우 불만족', 'Delete');
    press('매우 불만족', 'Backspace');
    // 고른 것이 이 척도의 것이 아닐 때도 같다
    select('elsewhere');
    press('매우 불만족', 'Delete');
    expect(onToggleChoice).not.toHaveBeenCalled();
  });

  it('조합 키와 다른 키는 건드리지 않는다', () => {
    const { onToggleChoice } = draw(fivePoint(), { selectedChoiceId: 'c2' });
    radio('보통').focus();
    expect(fireEvent.keyDown(radio('보통'), { key: 'ArrowRight', altKey: true })).toBe(true);
    expect(fireEvent.keyDown(radio('보통'), { key: 'ArrowRight', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(radio('보통'), { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(radio('보통'), { key: 'a' })).toBe(true);
    expect(onToggleChoice).not.toHaveBeenCalled();
  });

  it('트랙을 눌러 고른 뒤에는 포커스가 그 눈금에 있어 화살표가 거기서 이어진다', () => {
    const { track } = draw(fivePoint());
    down(track, 460);
    up(track, 460);
    expect(focusedName()).toBe('만족');
  });
});

describe('ScaleSlider — 잠긴 묶음', () => {
  const root = () => screen.getByTestId('scale-slider-g1');

  it('fieldset disabled 안에서는 누르기·끌기·키보드가 토글을 부르지 않는다 — prop 없이', () => {
    const { track, onToggleChoice } = draw(withOffScale, {
      selectedChoiceId: 'c3',
      fieldsetDisabled: true,
    });
    // 누르기
    down(track, 160);
    expect(thumbLeft()).toBe('70%');
    up(track, 160);
    // 끌기
    down(track, 450);
    move(track, 160);
    expect(thumbLeft()).toBe('70%');
    expect(thumb()!.dataset['state']).toBe('selected');
    up(track, 160);
    // 키보드 — 잠긴 라디오는 포커스를 받지 못하지만 키 이벤트가 와도 받지 않는다
    fireEvent.keyDown(radio('만족'), { key: 'ArrowLeft' });
    fireEvent.keyDown(radio('만족'), { key: 'Home' });
    fireEvent.keyDown(radio('만족'), { key: 'Delete' });
    // 점 타일 · 척도 밖 체크 · 낭독기의 직접 누르기
    fireEvent.click(within(screen.getByTestId('scale-slider-tiles')).getByText('매우 만족'));
    fireEvent.click(screen.getByText('이용한 적 없음'));
    fireEvent.click(radio('매우 불만족'));
    expect(onToggleChoice).not.toHaveBeenCalled();
    expect(screen.getAllByRole('radio').every((input) => input.matches(':disabled'))).toBe(true);
  });

  it('잠긴 묶음의 손잡이는 고른 자리에 그대로 선다', () => {
    draw(fivePoint(), { selectedChoiceId: 'c3', fieldsetDisabled: true });
    expect(thumbLeft()).toBe('70%');
    expect(thumb()!.dataset['state']).toBe('selected');
    expect(radio('만족').checked).toBe(true);
  });

  it('잠긴 묶음의 회색은 안쪽 라디오의 비활성 상태에서 온다 — prop 도 스크립트 상태도 아니다', () => {
    // jsdom 은 스타일을 계산하지 않는다 — 회색과 포인터 차단이 「누를 수 있는 라디오가 하나도 없음」에 걸려
    // 있는지만 본다. 조건이 CSS 라 fieldset 이 나중에 잠겨도 다시 그리지 않고 따라간다(눈으로는 통합 단계).
    draw(fivePoint(), { selectedChoiceId: 'c3', fieldsetDisabled: true });
    const classes = root().className.split(/\s+/);
    expect(classes).toContain('[&:not(:has(input:enabled))]:grayscale');
    expect(classes).toContain('[&:not(:has(input:enabled))]:pointer-events-none');
    // 조건이 가리키는 상태가 실제로 그렇다
    expect(root().querySelector('input:enabled')).toBeNull();
    cleanup();
    draw(fivePoint(), { selectedChoiceId: 'c3' });
    expect(root().querySelector('input:enabled')).not.toBeNull();
  });

  it('그려진 뒤에 잠기거나 풀려도 따라간다', () => {
    const { track, onToggleChoice } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    const lock = screen.getByTestId('question-lock') as HTMLFieldSetElement;
    // 호스트가 fieldset 만 바꾼다 — 슬라이더는 다시 그려지지 않는다
    lock.disabled = true;
    down(track, 160);
    expect(thumbLeft()).toBe('70%');
    up(track, 160);
    expect(onToggleChoice).not.toHaveBeenCalled();
    lock.disabled = false;
    down(track, 160);
    up(track, 160);
    expect(onToggleChoice).toHaveBeenCalledWith('c0');
  });

  it('끄는 중에 잠기면 놓아도 토글이 불리지 않는다', () => {
    const { track, onToggleChoice } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    down(track, 450);
    move(track, 160);
    (screen.getByTestId('question-lock') as HTMLFieldSetElement).disabled = true;
    up(track, 160);
    expect(onToggleChoice).not.toHaveBeenCalled();
    expect(thumbLeft()).toBe('70%');
  });
});

describe('ScaleSlider — 비활성 눈금', () => {
  const disabledChoiceIds = new Set(['c1', 'c2']);

  it('비활성 눈금은 누를 수 없다 — 트랙도 점 타일도', () => {
    const { track, onToggleChoice } = draw(fivePoint(), { disabledChoiceIds });
    down(track, 250);
    // 미리보기도 서지 않는다
    expect(thumb()).toBeNull();
    up(track, 250);
    fireEvent.click(within(screen.getByTestId('scale-slider-tiles')).getByText('보통'));
    expect(onToggleChoice).not.toHaveBeenCalled();
    expect(radio('불만족').disabled).toBe(true);
    expect(radio('보통').disabled).toBe(true);
    expect(radio('만족').disabled).toBe(false);
    // 나머지 눈금은 그대로 눌린다
    down(track, 450);
    up(track, 450);
    expect(onToggleChoice).toHaveBeenCalledWith('c3');
  });

  it('끌기는 비활성 눈금에 서지 않는다 — 가장 가까운 누를 수 있는 눈금으로 붙는다', () => {
    const { track, onToggleChoice } = draw(fivePoint(), {
      selectedChoiceId: 'c4',
      disabledChoiceIds,
    });
    down(track, 550);
    // c2 위 — 가까운 쪽은 c3
    move(track, 360);
    expect(thumbLeft()).toBe('70%');
    // c1 위 — 가까운 쪽은 c0
    move(track, 240);
    expect(thumbLeft()).toBe('10%');
    move(track, 330);
    up(track, 330);
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c3');
  });

  it('비활성 눈금에서 끌기를 시작해도 누를 수 있는 눈금에 놓으면 답이 된다', () => {
    const { track, onToggleChoice } = draw(fivePoint(), { disabledChoiceIds });
    down(track, 250);
    move(track, 460);
    expect(thumbLeft()).toBe('70%');
    up(track, 460);
    expect(onToggleChoice).toHaveBeenCalledTimes(1);
    expect(onToggleChoice).toHaveBeenCalledWith('c3');
  });

  it('화살표는 비활성 눈금을 건너뛴다', () => {
    const { onToggleChoice, select } = draw(fivePoint(), {
      selectedChoiceId: 'c0',
      disabledChoiceIds,
    });
    press('매우 불만족', 'ArrowRight');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c3');
    expect(focusedName()).toBe('만족');
    select('c3');
    press('만족', 'ArrowLeft');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c0');
    expect(focusedName()).toBe('매우 불만족');
  });

  it('Home·End 는 누를 수 있는 양끝 눈금으로 간다. 건너뛸 곳이 없으면 멈춘다', () => {
    const { onToggleChoice, select } = draw(withOffScale, {
      selectedChoiceId: 'c2',
      disabledChoiceIds: new Set(['c0', 'c4', 'na']),
    });
    press('보통', 'Home');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c1');
    select('c1');
    press('불만족', 'ArrowLeft');
    expect(focusedName()).toBe('불만족');
    press('불만족', 'End');
    expect(onToggleChoice).toHaveBeenLastCalledWith('c3');
    select('c3');
    // 끝 눈금도 척도 밖 체크도 비활성이다
    press('만족', 'ArrowRight');
    expect(focusedName()).toBe('만족');
    expect(onToggleChoice).toHaveBeenCalledTimes(2);
  });

  it('고른 것이 비활성이면 Delete 로 풀리지 않는다', () => {
    const { onToggleChoice } = draw(fivePoint(), {
      selectedChoiceId: 'c1',
      disabledChoiceIds,
    });
    press('만족', 'Delete');
    expect(onToggleChoice).not.toHaveBeenCalled();
  });

  it('비활성인 척도 밖 체크는 눌리지 않는다', () => {
    const { onToggleChoice } = draw(withOffScale, { disabledChoiceIds: new Set(['na']) });
    expect(radio('이용한 적 없음').disabled).toBe(true);
    fireEvent.click(screen.getByText('이용한 적 없음'));
    fireEvent.click(radio('이용한 적 없음'));
    expect(onToggleChoice).not.toHaveBeenCalled();
    // 눈금은 그대로 눌린다
    fireEvent.click(within(screen.getByTestId('scale-slider-tiles')).getByText('만족'));
    expect(onToggleChoice).toHaveBeenCalledWith('c3');
  });

  it('전부 비활성이면 잠긴 묶음과 같다 — 누를 수 있는 라디오가 없고 손짓을 받지 않는다', () => {
    // 보통 라디오 문항의 프리필 잠금이 이 길로 온다(모든 보기 id 를 넘긴다)
    const { track, onToggleChoice } = draw(withOffScale, {
      selectedChoiceId: 'c3',
      disabledChoiceIds: new Set(['c0', 'c1', 'c2', 'c3', 'c4', 'na']),
    });
    expect(screen.getByTestId('scale-slider-g1').querySelector('input:enabled')).toBeNull();
    down(track, 160);
    move(track, 460);
    expect(track.dataset['dragging']).toBeUndefined();
    up(track, 460);
    expect(onToggleChoice).not.toHaveBeenCalled();
    expect(thumbLeft()).toBe('70%');
  });

  it('하나씩 흐리게 두는 것은 일부만 비활성일 때다 — 전부 비활성이면 묶음의 회색 하나로 말한다', () => {
    const dimmed = () =>
      [...screen.getByTestId('scale-slider-g1').querySelectorAll('label')].filter((label) =>
        label.className.split(/\s+/).includes('opacity-50'),
      );
    draw(withOffScale, { disabledChoiceIds });
    expect(dimmed().map((label) => label.textContent)).toEqual(['불만족', '보통']);
    cleanup();
    // 흐림이 회색 위에 겹치면 고른 답까지 반쯤 지워져 보인다
    draw(withOffScale, {
      selectedChoiceId: 'c3',
      disabledChoiceIds: new Set(['c0', 'c1', 'c2', 'c3', 'c4', 'na']),
    });
    expect(dimmed()).toEqual([]);
  });
});

describe('ScaleSlider — 필수 강조', () => {
  it('켜지면 묶음이 오류 상태가 되고 트랙과 머리 글자가 강조된다', () => {
    const { track } = draw(thirteenBands, { invalid: true, label: '회의실 및 교통비 지원' });
    expect(screen.getByRole('radiogroup').getAttribute('aria-invalid')).toBe('true');
    expect(track.dataset['invalid']).toBe('true');
    expect(screen.getByText('회의실 및 교통비 지원').dataset['invalid']).toBe('true');
  });

  it('꺼지면 강조가 없다 — 답하면 호스트가 prop 을 내린다', () => {
    const { track } = draw(thirteenBands, { label: '회의실 및 교통비 지원' });
    expect(screen.getByRole('radiogroup').hasAttribute('aria-invalid')).toBe(false);
    expect(track.dataset['invalid']).toBeUndefined();
    expect(screen.getByText('회의실 및 교통비 지원').dataset['invalid']).toBeUndefined();
  });
});

describe('ScaleSlider — 좁은 화면', () => {
  const tileTexts = () =>
    [...screen.getByTestId('scale-slider-tiles').querySelectorAll('[data-tile]')].map(
      (tile) => tile.textContent,
    );
  const nameRows = () => [
    ...screen.getByTestId('scale-slider-names').querySelectorAll<HTMLElement>('label'),
  ];

  it('점 타일 7장에 눈금 글자가 있으면 타일에는 번호만 두고 이름은 아래 목록으로 적는다', () => {
    draw(sevenMarked, { narrow: true, selectedChoiceId: 'c5' });
    expect(tileTexts()).toEqual(CIRC.slice(0, 7));
    expect(nameRows().map((row) => row.textContent)).toEqual(
      SEVEN_NAMES.map((name, n) => `${CIRC[n]}${name}`),
    );
    // 번호는 타일에 한 번만 보인다 — 트랙 아래 눈금 글자 줄은 두지 않는다
    expect(screen.queryByTestId('scale-slider-marks')).toBeNull();
    // 고른 줄만 강조된다
    expect(nameRows().map((row) => row.dataset['state'])).toEqual([
      'idle',
      'idle',
      'idle',
      'idle',
      'idle',
      'selected',
      'idle',
    ]);
    // 낭독은 라디오가 한다 — 타일·목록이 같은 이름을 두 번 읽히지 않는다
    expect(screen.getByRole('radio', { name: '⑥ 그렇다' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(7);
  });

  it('이름 목록의 줄을 눌러도 그 눈금으로 토글이 불린다', () => {
    const { onToggleChoice } = draw(sevenMarked, { narrow: true, selectedChoiceId: 'c5' });
    fireEvent.click(nameRows()[1]!);
    expect(onToggleChoice).toHaveBeenLastCalledWith('c1');
    // 고른 줄을 다시 누르면 그 눈금으로 불린다(풀기는 호스트)
    fireEvent.click(nameRows()[5]!);
    expect(onToggleChoice).toHaveBeenLastCalledWith('c5');
    // 번호 타일도 누를 수 있다
    fireEvent.click(screen.getByTestId('scale-slider-tiles').querySelectorAll('[data-tile]')[3]!);
    expect(onToggleChoice).toHaveBeenLastCalledWith('c3');
    expect(onToggleChoice).toHaveBeenCalledTimes(3);
  });

  it('이름 목록은 잠긴 묶음과 비활성 눈금에서 눌리지 않는다', () => {
    const { onToggleChoice } = draw(sevenMarked, {
      narrow: true,
      disabledChoiceIds: new Set(['c1']),
    });
    fireEvent.click(nameRows()[1]!);
    expect(onToggleChoice).not.toHaveBeenCalled();
    cleanup();
    const locked = draw(sevenMarked, { narrow: true, fieldsetDisabled: true });
    fireEvent.click(nameRows()[2]!);
    expect(locked.onToggleChoice).not.toHaveBeenCalled();
  });

  it('끄는 동안에는 손잡이가 지나는 줄이 미리보기로 바뀐다', () => {
    const { track } = draw(sevenMarked, { narrow: true, selectedChoiceId: 'c5' });
    // 7눈금 — 칸 하나가 500/7 px. 첫 눈금의 한가운데는 100 + 0.5 × 500/7
    down(track, 100 + (5.5 * 500) / 7);
    move(track, 100 + (0.5 * 500) / 7);
    expect(nameRows()[0]!.dataset['state']).toBe('preview');
    expect(nameRows()[5]!.dataset['state']).toBe('idle');
  });

  it('넓은 화면에서는 같은 척도가 이름 타일과 눈금 글자 줄이다 — 목록이 없다', () => {
    draw(sevenMarked);
    expect(tileTexts()).toEqual(SEVEN_NAMES);
    expect(screen.queryByTestId('scale-slider-names')).toBeNull();
    expect(
      [...screen.getByTestId('scale-slider-marks').children].map((el) => el.textContent),
    ).toEqual(CIRC.slice(0, 7));
  });

  it('점 타일이 6장이면 목록, 5장이면 타일 그대로다', () => {
    const marked = (count: number): ScaleSliderModel => ({
      ...sevenMarked,
      ticks: sevenMarked.ticks.slice(0, count),
    });
    draw(marked(6), { narrow: true });
    expect(tileTexts()).toEqual(CIRC.slice(0, 6));
    expect(screen.getByTestId('scale-slider-names')).toBeTruthy();
    cleanup();
    draw(marked(5), { narrow: true });
    expect(tileTexts()).toEqual(SEVEN_NAMES.slice(0, 5));
    expect(screen.queryByTestId('scale-slider-names')).toBeNull();
    // 눈금 글자는 종전대로 트랙 아래에 선다
    expect(screen.getByTestId('scale-slider-marks')).toBeTruthy();
  });

  it('눈금 글자가 없는 척도는 7장이어도 타일 그대로다 — 목록이 없다', () => {
    const unmarked: ScaleSliderModel = {
      ...sevenMarked,
      ticks: sevenMarked.ticks.map(({ mark: _mark, ...tick }) => ({ ...tick, text: tick.name! })),
    };
    draw(unmarked, { narrow: true });
    expect(tileTexts()).toEqual(SEVEN_NAMES);
    expect(screen.queryByTestId('scale-slider-names')).toBeNull();
    expect(screen.queryByTestId('scale-slider-marks')).toBeNull();
  });

  it('점 타일 5장은 좁은 화면에서도 타일 그대로다', () => {
    draw(fivePoint(), { narrow: true, selectedChoiceId: 'c3' });
    expect(tileTexts()).toEqual(FIVE_NAMES);
    expect(screen.queryByTestId('scale-slider-names')).toBeNull();
  });

  it('구간 타일 척도는 좁은 화면에서도 구간 타일과 눈금 글자 줄이다', () => {
    draw(thirteenBands, { narrow: true, selectedChoiceId: 'c9' });
    expect(tileTexts()).toEqual(['불만족', '보통', '만족']);
    expect(screen.queryByTestId('scale-slider-names')).toBeNull();
    expect(screen.getByTestId('scale-slider-marks').children).toHaveLength(13);
    expect(screen.getByTestId('scale-slider-selection').textContent).toBe('⑩ · 만족');
  });

  it('척도 밖 체크는 좁은 화면에서 트랙 아래 줄에 서고, 둘 이상이면 나란히다', () => {
    const twoOff: ScaleSliderModel = {
      ...fivePoint(),
      offScale: [
        { choiceId: 'dk', label: '모름' },
        { choiceId: 'na', label: '해당 없음' },
      ],
    };
    draw(twoOff, { narrow: true });
    const group = screen.getByRole('radiogroup');
    const checks = screen.getByTestId('scale-slider-off-scale');
    // 트랙과 같은 열 — 옆 열을 두지 않아 트랙이 짧아지지 않는다
    expect(group.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(checks.dataset['placement']).toBe('below');
    expect(
      screen.getByTestId('scale-slider-track').compareDocumentPosition(checks) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect([...checks.children].map((el) => el.textContent)).toEqual(['모름', '해당 없음']);
    cleanup();
    // 넓은 화면에서는 트랙 오른쪽 같은 줄이다
    draw(twoOff);
    expect(screen.getByRole('radiogroup').style.gridTemplateColumns).toBe('minmax(0, 1fr) auto');
    expect(screen.getByTestId('scale-slider-off-scale').dataset['placement']).toBe('beside');
  });

  it('이름 목록이 있으면 척도 밖 체크는 목록 아래다', () => {
    draw(
      { ...sevenMarked, offScale: [{ choiceId: 'na', label: '해당 없음' }] },
      { narrow: true },
    );
    expect(
      screen
        .getByTestId('scale-slider-names')
        .compareDocumentPosition(screen.getByTestId('scale-slider-off-scale')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('ScaleSlider — 글자 접힘', () => {
  /** 글자를 싣는 요소의 클래스 — jsdom 은 줄바꿈을 계산하지 않아 줄바꿈 규칙이 붙었는지만 본다 */
  const wrapClasses = (element: Element) => element.className.split(/\s+/);
  const expectWraps = (element: Element) => {
    const classes = wrapClasses(element);
    // 낱말 단위로 접되(한국어 어절 보존), 한 낱말이 칸보다 길면 글자에서 끊는다 — 넘치지 않는다.
    // 중국어판(lang=zh)에서는 globals.css 가 break-keep 을 풀어 글자 단위로 접힌다
    // 둘 다 남아 있어야 한다 — 클래스 병합이 한쪽을 지우면 어절 보존이나 넘침 방지가 조용히 빠진다
    expect(classes).toContain('break-keep');
    expect(classes).toContain('wrap-break-word');
    expect(classes).toContain('whitespace-normal');
    expect(classes).not.toContain('truncate');
    expect(classes).not.toContain('whitespace-nowrap');
  };

  it.each([
    { title: '중국어', names: ['非常不满意', '不满意', '一般', '满意', '非常满意'] },
    {
      title: '영어',
      names: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
    },
    {
      title: '베트남어',
      names: ['Rất không hài lòng', 'Không hài lòng', 'Bình thường', 'Hài lòng', 'Rất hài lòng'],
    },
  ])('$title 이름의 점 타일 — 타일은 제 칸보다 넓어지지 않고 이름은 접힌다', ({ names }) => {
    const model: ScaleSliderModel = {
      ...fivePoint(),
      ticks: fivePoint().ticks.map((tick, n) => ({ ...tick, text: names[n]!, name: names[n]! })),
    };
    for (const narrow of [false, true]) {
      draw(model, { narrow });
      const tiles = within(screen.getByTestId('scale-slider-tiles'));
      for (const name of names) {
        const label = tiles.getByText(name);
        expectWraps(label);
        // 타일은 격자 칸 안에서 줄어든다(글자 폭이 칸을 밀어 넓히지 않는다)
        expect(wrapClasses(label.closest('[data-tile]')!)).toContain('min-w-0');
      }
      // 칸은 고르게 나뉜다 — 글자가 긴 타일이 옆 타일을 좁히지 않는다
      expect(screen.getByTestId('scale-slider-tiles').style.gridTemplateColumns).toBe(
        'repeat(5, minmax(0, 1fr))',
      );
      cleanup();
    }
  });

  it('구간 타일 · 글자로만 두는 구간 이름 · 이름 목록 · 척도 밖 체크의 글자도 같은 규칙으로 접힌다', () => {
    draw(thirteenBands);
    expectWraps(within(screen.getByTestId('scale-slider-tiles')).getByText('불만족'));
    cleanup();
    draw({
      ...thirteenBands,
      bands: [thirteenBands.bands[0]!],
      ticks: thirteenBands.ticks.map((tick) => ({
        ...tick,
        bandIndex: tick.bandIndex === 0 ? 0 : null,
      })),
      bandsCoverAllTicks: false,
    });
    expectWraps(within(screen.getByTestId('scale-slider-band-names')).getByText('불만족'));
    cleanup();
    draw({ ...sevenMarked, offScale: [{ choiceId: 'na', label: '해당 없음' }] }, { narrow: true });
    expectWraps(within(screen.getByTestId('scale-slider-names')).getByText('전혀 그렇지 않다'));
    expectWraps(within(screen.getByTestId('scale-slider-off-scale')).getByText('해당 없음'));
  });
});

describe('ScaleSlider — 끄는 손짓의 표시', () => {
  it('끌기가 된 동안에만 트랙이 끄는 중으로 표시된다 — 누르기는 아니다', () => {
    const { track } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    down(track, 450);
    expect(track.dataset['dragging']).toBeUndefined();
    move(track, 452);
    expect(track.dataset['dragging']).toBeUndefined();
    move(track, 360);
    expect(track.dataset['dragging']).toBe('true');
    // 누른 자리로 되돌아와도 끌기다
    move(track, 450);
    expect(track.dataset['dragging']).toBe('true');
    up(track, 450);
    expect(track.dataset['dragging']).toBeUndefined();
  });

  it('취소되면 끄는 중 표시도 내려간다', () => {
    const { track } = draw(fivePoint(), { selectedChoiceId: 'c3' });
    down(track, 450);
    move(track, 160);
    fireEvent.pointerCancel(track, { pointerId: 1 });
    expect(track.dataset['dragging']).toBeUndefined();
  });
});

describe('ScaleSlider — 화면 밖 규칙(스타일이 계산되지 않는 자리의 구조 확인)', () => {
  const everything = () => {
    draw(
      { ...sevenMarked, offScale: [{ choiceId: 'na', label: '해당 없음' }] },
      { narrow: true, selectedChoiceId: 'c5', invalid: true, label: '우수인재 발굴' },
    );
    return [...screen.getByTestId('scale-slider-g1').querySelectorAll('*')];
  };
  const classesOf = (element: Element) =>
    (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

  it('포커스 테는 outline 으로 그린다 — box-shadow 는 강제 색 모드에서 사라진다', () => {
    const focusClasses = everything()
      .flatMap(classesOf)
      .filter((name) => name.includes('focus-visible'));
    expect(focusClasses.length).toBeGreaterThan(0);
    expect(focusClasses.filter((name) => /:ring/.test(name))).toEqual([]);
    expect(focusClasses.every((name) => /:outline-/.test(name))).toBe(true);
  });

  it('글자 크기를 px 로 못박지 않는다 — 브라우저 글자 크기 설정을 따른다', () => {
    const fixed = everything()
      .flatMap(classesOf)
      .filter((name) => /text-\[[\d.]+px\]/.test(name));
    expect(fixed).toEqual([]);
  });

  it('손가락으로 누르는 자리는 44px 까지 넓어진다 — 트랙 · 번호 타일 · 이름 목록 줄 · 척도 밖 체크', () => {
    everything();
    // 높이를 직접 늘리거나(트랙 · 번호 타일), 글자 한 줄(20px)에 위아래 여백 12px 씩을 더한다(목록 줄 · 체크)
    const grows = (element: Element) =>
      classesOf(element).some((name) => /^pointer-coarse:(min-h-11|h-11|py-3)$/.test(name));
    const track = screen.getByTestId('scale-slider-track');
    expect([...track.querySelectorAll('*')].some(grows)).toBe(true);
    for (const tile of screen.getByTestId('scale-slider-tiles').querySelectorAll('[data-tile]')) {
      expect(grows(tile)).toBe(true);
    }
    for (const row of screen.getByTestId('scale-slider-names').querySelectorAll('label')) {
      expect(grows(row)).toBe(true);
    }
    for (const check of screen.getByTestId('scale-slider-off-scale').querySelectorAll('label')) {
      expect(grows(check)).toBe(true);
    }
  });

  it('보이지 않는 라디오는 낭독 트리에 남는다 — display:none · hidden · aria-hidden 을 쓰지 않는다', () => {
    everything();
    for (const input of screen.getAllByRole('radio')) {
      expect(classesOf(input)).not.toContain('hidden');
      expect(input.hasAttribute('hidden')).toBe(false);
      expect(input.closest('[aria-hidden="true"]')).toBeNull();
    }
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
