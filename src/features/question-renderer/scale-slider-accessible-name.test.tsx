import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScaleSlider, type ScaleSliderProps } from '@/features/question-renderer/scale-slider';
import type { ScaleSliderModel } from '@/features/question-renderer/utils/scale-slider';

import { ariaReferenceTexts } from '../../../tests/helpers/aria-references';

/**
 * 척도 슬라이더 컴포넌트 — 라디오 묶음의 낭독 이름과 설명(CONTEXT.md 「척도 슬라이더」).
 *
 * 호스트가 화면에 보이는 제목 요소의 id 를 주면 라디오 묶음이 그 요소를 이름으로 삼고(`aria-labelledby`),
 * 오류 문구 요소의 id 를 주면 설명으로 잇는다(`aria-describedby`). 둘 다 안 주면 지금과 같다 — 그 경우의
 * 마크업은 scale-slider.test.tsx 가 지킨다.
 */

vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));

afterEach(cleanup);

const NAMES = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
const model: ScaleSliderModel = {
  tileKind: 'point',
  ticks: NAMES.map((name, n) => ({
    choiceId: `c${n}`,
    text: name,
    name,
    side: n < 2 ? 'negative' : n === 2 ? 'neutral' : 'positive',
    bandIndex: null,
  })),
  bands: [],
  offScale: [],
  showsSelectionLabel: false,
  bandsCoverAllTicks: false,
};

/** 호스트가 그리는 행 제목과 낭독용 오류 문구 옆에 슬라이더를 둔다 */
function draw(props: Partial<ScaleSliderProps> = {}, host: { title?: boolean; error?: boolean } = {}) {
  render(
    <div>
      {host.title === false ? null : <h5 id="row-title">1) 주차/접근성</h5>}
      {host.error ? <p id="row-error">1) 주차/접근성의 응답을 확인해 주세요.</p> : null}
      <ScaleSlider
        questionId="q1"
        sliderId="g1"
        model={model}
        label=""
        selectedChoiceId={undefined}
        onToggleChoice={vi.fn()}
        {...props}
      />
    </div>,
  );
  return screen.getByRole('radiogroup');
}

describe('척도 슬라이더의 낭독 이름', () => {
  it('아무것도 주지 않으면 이름은 낭독용 글자이고 이어 가리키는 속성이 없다', () => {
    const group = draw({ ariaLabel: '주차/접근성' });
    expect(group).toHaveAttribute('aria-label', '주차/접근성');
    expect(group).not.toHaveAttribute('aria-labelledby');
    expect(group).not.toHaveAttribute('aria-describedby');
  });

  it('머리 줄 제목만 주면 그 글자가 이름이고 제목 글자에 id 를 달지 않는다', () => {
    const group = draw({ label: '만족도' });
    expect(group).toHaveAttribute('aria-label', '만족도');
    expect(group).not.toHaveAttribute('aria-labelledby');
    expect(screen.getByText('만족도')).not.toHaveAttribute('id');
  });

  it('보이는 제목의 id 를 주면 그 요소가 이름이고 낭독용 글자는 쓰지 않는다', () => {
    const group = draw({ ariaLabelledBy: 'row-title', ariaLabel: '다른 글자' });
    expect(ariaReferenceTexts(group, 'aria-labelledby')).toEqual(['1) 주차/접근성']);
    expect(group).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('radiogroup', { name: '1) 주차/접근성' })).toBe(group);
  });

  it('보이는 제목의 id 와 머리 줄 제목을 함께 주면 「제목, 머리 줄 제목」 순서로 가리킨다', () => {
    const group = draw({ ariaLabelledBy: 'row-title', label: '만족도' });
    expect(ariaReferenceTexts(group, 'aria-labelledby')).toEqual(['1) 주차/접근성', '만족도']);
    expect(group).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('radiogroup', { name: '1) 주차/접근성 만족도' })).toBe(group);
  });

  it('한 문서에 슬라이더가 여럿이어도 머리 줄 제목의 id 가 겹치지 않는다', () => {
    render(
      <div>
        <h5 id="row-title">1) 주차/접근성</h5>
        {['g1', 'g2'].map((sliderId) => (
          <ScaleSlider
            key={sliderId}
            questionId="q1"
            sliderId={sliderId}
            model={model}
            label={sliderId === 'g1' ? '활용 여부' : '만족도'}
            ariaLabelledBy="row-title"
            selectedChoiceId={undefined}
            onToggleChoice={vi.fn()}
          />
        ))}
      </div>,
    );
    const [first, second] = screen.getAllByRole('radiogroup');
    // 겹치면 가리킨 id 가 문서에 둘이라 헬퍼가 던진다
    expect(ariaReferenceTexts(first!, 'aria-labelledby')).toEqual(['1) 주차/접근성', '활용 여부']);
    expect(ariaReferenceTexts(second!, 'aria-labelledby')).toEqual(['1) 주차/접근성', '만족도']);
  });

  it('빈 id 를 주면 주지 않은 것과 같다', () => {
    const group = draw({ ariaLabelledBy: '', ariaDescribedBy: '', ariaLabel: '주차/접근성' });
    expect(group).toHaveAttribute('aria-label', '주차/접근성');
    expect(group).not.toHaveAttribute('aria-labelledby');
    expect(group).not.toHaveAttribute('aria-describedby');
  });
});

describe('척도 슬라이더의 오류 문구 잇기', () => {
  it('오류 문구의 id 를 주면 라디오 묶음의 설명으로 이어진다', () => {
    const group = draw(
      { ariaLabelledBy: 'row-title', ariaDescribedBy: 'row-error', invalid: true },
      { error: true },
    );
    expect(ariaReferenceTexts(group, 'aria-describedby')).toEqual([
      '1) 주차/접근성의 응답을 확인해 주세요.',
    ]);
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription('1) 주차/접근성의 응답을 확인해 주세요.');
  });

  it('안 주면 설명 속성이 없다 — 필수 강조만으로는 잇지 않는다', () => {
    const group = draw({ ariaLabelledBy: 'row-title', invalid: true });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).not.toHaveAttribute('aria-describedby');
  });

  it('이름을 글자로 받는 자리에서도 오류 문구는 이어진다', () => {
    const group = draw(
      { ariaLabel: '주차/접근성', ariaDescribedBy: 'row-error', invalid: true },
      { title: false, error: true },
    );
    expect(group).toHaveAttribute('aria-label', '주차/접근성');
    expect(ariaReferenceTexts(group, 'aria-describedby')).toHaveLength(1);
  });
});
