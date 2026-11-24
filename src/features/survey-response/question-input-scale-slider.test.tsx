import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import { QuestionInput } from '@/features/survey-response/question-input';
import type { Question, QuestionOption } from '@/types/survey';

/**
 * 보통 라디오 문항의 척도 슬라이더 — 문항 설정(슬라이더 방향)을 켜면 응답 화면이 보기 목록 대신 슬라이더를
 * 그린다(CONTEXT.md 「척도 슬라이더」). 모양만 바뀐다: 쓰이는 값은 끈 같은 문항과 같은 보기 value 다.
 *
 * jsdom 은 배치를 계산하지 않으므로 트랙 범위는 테스트가 준다(왼쪽 100px · 폭 500px).
 * 눈금 5개면 칸 하나가 100px 이고 눈금은 150 · 250 · 350 · 450 · 550 에 선다.
 */

let narrowScreen = false;

beforeEach(() => {
  narrowScreen = false;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: narrowScreen, addEventListener() {}, removeEventListener() {} }),
  });
});

afterEach(cleanup);

const FIVE: QuestionOption[] = [
  { id: 'o1', label: '전혀 없다', value: '1' },
  { id: 'o2', label: '없다', value: '2' },
  { id: 'o3', label: '보통이다', value: '3' },
  { id: 'o4', label: '있다', value: '4' },
  { id: 'o5', label: '매우 있다', value: '5' },
];
const UNSURE: QuestionOption = {
  id: 'o9',
  label: '잘 모르겠다',
  value: '9',
  excludeFromMean: true,
};

const radio = (extra: Partial<Question> = {}): Question =>
  ({
    id: 'q7',
    type: 'radio',
    title: '이 서비스를 주변에 추천할 의향이 얼마나 있으십니까?',
    required: true,
    order: 0,
    options: FIVE,
    ...extra,
  }) as unknown as Question;

const slider = (extra: Partial<Question> = {}) => radio({ scaleSlider: 'positive-right', ...extra });

function draw(question: Question, value: unknown = undefined, attrs: Record<string, string> = {}) {
  const onChange = vi.fn();
  const view = render(
    <ContactAttrsProvider attrs={attrs}>
      <QuestionInput question={question} value={value} onChange={onChange} />
    </ContactAttrsProvider>,
  );
  return { ...view, onChange };
}

function trackOf() {
  const track = screen.getByTestId('scale-slider-track');
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

const press = (track: HTMLElement, clientX: number) => {
  fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX });
  fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX });
};

/** 화면 낭독기·키보드가 쓰는 길 — 눈금의 native radio */
const tickRadio = (name: string) => screen.getByRole('radio', { name });

describe('라디오 문항 — 척도 슬라이더로 그리기', () => {
  it('설정을 켠 문항은 넓은 폭에서 보기 목록 대신 슬라이더로 그려진다', () => {
    const { container } = draw(slider());
    const root = screen.getByTestId('scale-slider-q7');
    expect(within(root).getAllByRole('radio')).toHaveLength(5);
    expect(root.querySelectorAll('[data-tile="point"]')).toHaveLength(5);
    // 보기 목록의 라디오는 그리지 않는다
    expect(container.querySelector('input[id="q7-o1"]')).toBeNull();
  });

  it('좁은 폭에서도 슬라이더로 그려진다', () => {
    narrowScreen = true;
    draw(slider());
    expect(screen.getByTestId('scale-slider-q7')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('묶음의 낭독용 이름은 문항 제목이고 눈금은 보기 라벨로 읽힌다', () => {
    draw(slider());
    expect(
      screen.getByRole('radiogroup', {
        name: '이 서비스를 주변에 추천할 의향이 얼마나 있으십니까?',
      }),
    ).toBeInTheDocument();
    expect(tickRadio('있다')).toBeInTheDocument();
  });

  it('보기 라벨의 명단 토큰은 치환한 값으로 타일에 보인다', () => {
    draw(
      slider({
        options: [
          { id: 'o1', label: '{{회사명}} 불만족', value: '1' },
          { id: 'o2', label: '{{회사명}} 만족', value: '2' },
        ],
      }),
      undefined,
      { 회사명: '메가리서치' },
    );
    expect(screen.getByText('메가리서치 만족')).toBeInTheDocument();
  });

  it('「평균에서 제외」 보기는 눈금이 아니라 체크로 떨어진다', () => {
    draw(slider({ options: [...FIVE, UNSURE] }));
    const offScale = screen.getByTestId('scale-slider-off-scale');
    expect(within(offScale).getByText('잘 모르겠다')).toBeInTheDocument();
    expect(screen.getByTestId('scale-slider-tiles').querySelectorAll('[data-tile]')).toHaveLength(5);
  });

  it('보기에 지정한 배경색·글자색은 타일에 쓰지 않는다', () => {
    draw(
      slider({
        options: FIVE.map((option) => ({
          ...option,
          backgroundColor: '#ffee00',
          textColor: '#ff00ff',
        })),
      }),
    );
    const html = screen.getByTestId('scale-slider-q7').outerHTML.toLowerCase();
    expect(html).not.toContain('#ffee00');
    expect(html).not.toContain('#ff00ff');
    expect(html).not.toContain('rgb(255, 238, 0)');
  });

  it('슬라이더로 그리는 동안 보기 열 배치 설정은 화면에 닿지 않는다', () => {
    const plain = draw(slider());
    const plainHtml = plain.container.innerHTML;
    plain.unmount();
    const { container } = draw(
      slider({ optionsColumns: 3, optionsAlign: 'center', mobileOptionsColumns: 2 }),
    );
    expect(container.innerHTML).toBe(plainHtml);
  });
});

describe('라디오 문항 슬라이더 — 값', () => {
  it('트랙을 눌러 답한 값이 설정을 끈 같은 문항에서 보기를 눌러 답한 값과 같다', () => {
    const off = draw(radio());
    fireEvent.click(off.container.querySelector('label[for="q7-o4"]')!);
    const expected = off.onChange.mock.calls;
    off.unmount();

    const on = draw(slider());
    press(trackOf(), 450);
    expect(on.onChange.mock.calls).toEqual(expected);
    expect(on.onChange).toHaveBeenCalledTimes(1);
    expect(on.onChange).toHaveBeenCalledWith('4');
  });

  it('점 타일을 눌러도 그 보기의 value 가 쓰인다', () => {
    const { onChange } = draw(slider());
    fireEvent.click(tickRadio('없다'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2');
  });

  it('고른 눈금을 다시 누르면 null 이다', () => {
    const { onChange } = draw(slider(), '4');
    expect(screen.getByTestId('scale-slider-thumb')).toHaveStyle({ left: '70%' });
    press(trackOf(), 450);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('끄는 동안에는 값이 쓰이지 않고 손을 뗄 때 한 번 쓰인다', () => {
    const { onChange } = draw(slider(), '1');
    const track = trackOf();
    fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX: 150 });
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 260 });
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 360 });
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 540 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX: 540 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('5');
  });

  it('척도 밖 체크를 누르면 그 보기의 value 가 쓰이고, 고른 뒤에는 손잡이가 없다', () => {
    const question = slider({ options: [...FIVE, UNSURE] });
    const first = draw(question);
    fireEvent.click(first.container.querySelector('input[id$="o9-slider"]')!);
    expect(first.onChange).toHaveBeenCalledWith('9');
    first.unmount();

    draw(question, '9');
    expect(screen.queryByTestId('scale-slider-thumb')).toBeNull();
  });

  it('저장된 값의 눈금에 손잡이가 선다', () => {
    draw(slider(), '2');
    expect(screen.getByTestId('scale-slider-thumb')).toHaveStyle({ left: '30%' });
    expect(tickRadio('없다')).toBeChecked();
  });
});

describe('라디오 문항 슬라이더 — 폴백', () => {
  const OTHER: QuestionOption = { id: 'o6', label: '기타', value: '6', allowTextInput: true };

  it('상세 기재 보기가 있으면 설정을 끈 문항과 똑같이 그려진다 — 입력칸 포함', () => {
    const options = [...FIVE, OTHER];
    const layout = { optionsColumns: 3, mobileOptionsColumns: 2 };
    const off = draw(radio({ options, ...layout }), '6');
    const expected = off.container.innerHTML;
    expect(off.container.querySelector('input[type="text"], textarea')).not.toBeNull();
    off.unmount();

    const on = draw(slider({ options, ...layout }), '6');
    expect(on.container.innerHTML).toBe(expected);
    expect(screen.queryByTestId('scale-slider-q7')).toBeNull();
  });

  it('보기가 14개면 설정을 끈 문항과 똑같이 그려진다 — 열 배치 포함', () => {
    const options = Array.from({ length: 14 }, (_, i) => ({
      id: `o${i + 1}`,
      label: `${i + 1}점`,
      value: String(i + 1),
    }));
    const off = draw(radio({ options, optionsColumns: 4 }));
    const expected = off.container.innerHTML;
    off.unmount();

    const on = draw(slider({ options, optionsColumns: 4 }));
    expect(on.container.innerHTML).toBe(expected);
  });

  it('폴백인 문항도 값은 지금과 같이 쓰인다', () => {
    const { container, onChange } = draw(slider({ options: [...FIVE, OTHER] }));
    fireEvent.click(container.querySelector('label[for="q7-o2"]')!);
    expect(onChange).toHaveBeenCalledWith('2');
  });
});

describe('라디오 문항 슬라이더 — 켜지지 않는 문항', () => {
  it('빌더가 끈 값(null)은 설정이 없는 문항과 똑같이 그려진다', () => {
    const off = draw(radio());
    const expected = off.container.innerHTML;
    off.unmount();
    const { container } = draw(radio({ scaleSlider: null }));
    expect(container.innerHTML).toBe(expected);
  });

  it('체크박스 문항은 값이 실려 있어도 슬라이더로 그리지 않는다', () => {
    draw(radio({ type: 'checkbox', scaleSlider: 'positive-right' } as never), []);
    expect(screen.queryByTestId('scale-slider-q7')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  });
});

describe('라디오 문항 슬라이더 — 프리필 잠금', () => {
  const locked = () =>
    slider({
      defaultValueTemplate: '{{추천}}',
    });

  it('명단 값과 맞는 보기를 마운트 때 한 번 골라 둔다 — 보기 목록과 같은 값', () => {
    const { onChange } = draw(locked(), undefined, { 추천: '있다' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('4');
  });

  it('잠긴 문항은 손잡이가 고른 자리에 서고, 누르거나 끌어도 값이 바뀌지 않는다', () => {
    const { onChange } = draw(locked(), '4', { 추천: '있다' });
    expect(onChange).not.toHaveBeenCalled();
    const track = trackOf();

    press(track, 150);
    fireEvent.pointerDown(track, { pointerId: 2, button: 0, clientX: 450 });
    fireEvent.pointerMove(track, { pointerId: 2, clientX: 300 });
    fireEvent.pointerMove(track, { pointerId: 2, clientX: 160 });
    fireEvent.pointerUp(track, { pointerId: 2, button: 0, clientX: 160 });
    press(track, 450);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('scale-slider-thumb')).toHaveStyle({ left: '70%' });
    expect(tickRadio('있다')).toBeChecked();
  });

  it('명단 값이 없으면 잠그지 않는다', () => {
    const { onChange } = draw(locked(), '4', {});
    press(trackOf(), 150);
    expect(onChange).toHaveBeenCalledWith('1');
  });
});
