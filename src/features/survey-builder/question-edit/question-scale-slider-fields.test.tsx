import { useState } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { QuestionScaleSliderFields } from '@/features/survey-builder/question-edit/question-scale-slider-fields';
import type { Question } from '@/types/survey';

/**
 * 문항 설정의 「척도 슬라이더로 그리기」 스위치와 긍정 방향 — 문항의 슬라이더 방향 한 필드를 적고 지운다
 * (CONTEXT.md 「척도 슬라이더」). 값이 있으면 켜진 것이고 그 값이 방향이다.
 */

function Harness({ initial }: { initial: Partial<Question> }) {
  const [formData, setFormData] = useState<Partial<Question>>(initial);
  return (
    <>
      <QuestionScaleSliderFields formData={formData} setFormData={setFormData} />
      <output data-testid="form">{JSON.stringify(formData)}</output>
    </>
  );
}

const form = () => JSON.parse(screen.getByTestId('form').textContent ?? '{}') as Partial<Question>;
const toggle = () => screen.getByRole('switch', { name: '척도 슬라이더로 그리기' });

describe('QuestionScaleSliderFields', () => {
  afterEach(cleanup);

  it('값이 없으면 스위치가 꺼져 있고 방향을 고르는 자리가 없다', () => {
    render(<Harness initial={{ title: '추천 의향' }} />);
    expect(toggle()).not.toBeChecked();
    expect(screen.queryByRole('group', { name: '긍정 방향' })).toBeNull();
  });

  it('빌더가 끈 값(null)도 꺼진 것으로 보인다', () => {
    render(<Harness initial={{ scaleSlider: null }} />);
    expect(toggle()).not.toBeChecked();
  });

  it('켜면 기본 방향(오른쪽이 긍정)이 적히고 방향을 고르는 자리가 나온다', () => {
    render(<Harness initial={{ title: '추천 의향' }} />);
    fireEvent.click(toggle());
    expect(form().scaleSlider).toBe('positive-right');
    expect(toggle()).toBeChecked();
    expect(screen.getByRole('radio', { name: '오른쪽이 긍정' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '왼쪽이 긍정' })).not.toBeChecked();
  });

  it('방향을 바꾸면 그 방향이 적힌다', () => {
    render(<Harness initial={{ scaleSlider: 'positive-right' }} />);
    fireEvent.click(screen.getByRole('radio', { name: '왼쪽이 긍정' }));
    expect(form().scaleSlider).toBe('positive-left');
    expect(screen.getByRole('radio', { name: '왼쪽이 긍정' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: '오른쪽이 긍정' }));
    expect(form().scaleSlider).toBe('positive-right');
  });

  it('저장본의 방향이 왼쪽이면 왼쪽이 골라져 보인다', () => {
    render(<Harness initial={{ scaleSlider: 'positive-left' }} />);
    expect(toggle()).toBeChecked();
    expect(screen.getByRole('radio', { name: '왼쪽이 긍정' })).toBeChecked();
  });

  it('끄면 키를 지우지 않고 null 을 적는다 — 부분 수정은 키가 없으면 그대로 둔다', () => {
    render(<Harness initial={{ scaleSlider: 'positive-left' }} />);
    fireEvent.click(toggle());
    expect(form()).toHaveProperty('scaleSlider', null);
    expect(screen.queryByRole('group', { name: '긍정 방향' })).toBeNull();
  });

  it('켜고 끄는 동안 다른 폼 값은 그대로다 — 보기 열 배치를 지우지 않는다', () => {
    render(
      <Harness initial={{ title: '추천 의향', optionsColumns: 3, mobileOptionsColumns: 2 }} />,
    );
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(form()).toMatchObject({ title: '추천 의향', optionsColumns: 3, mobileOptionsColumns: 2 });
  });

  it('방향을 고르는 자리는 이름 있는 묶음이고 설명이 이어져 있다', () => {
    render(<Harness initial={{ scaleSlider: 'positive-right' }} />);
    const group = screen.getByRole('group', { name: '긍정 방향' });
    expect(group).toHaveAccessibleDescription(/붉은색/);
    expect(toggle()).toHaveAccessibleDescription(/웹과 모바일/);
  });
});
