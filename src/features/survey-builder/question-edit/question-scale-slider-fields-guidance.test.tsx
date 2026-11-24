import { useState } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { QuestionScaleSliderDiagnosis } from '@/features/survey-builder/lib/scale-slider-diagnostics';
import { QuestionScaleSliderFields } from '@/features/survey-builder/question-edit/question-scale-slider-fields';
import type { Question } from '@/types/survey';

/**
 * 문항 설정의 「척도 슬라이더로 그리기」 안내 — 표에서 켜면 무엇이 달라지는지, 슬라이더로 못 그리는 이유,
 * 눈금이 많은 라디오 문항과 행이 여럿인 그룹 없는 표의 주의를 스위치 아래에 보인다.
 */

const CLEAN: QuestionScaleSliderDiagnosis = {
  target: 'radio-options',
  issues: [],
  drawsNothing: false,
  crampedNarrowTiles: false,
  sharedAnswerRows: false,
};

function Harness({
  initial = { scaleSlider: 'positive-right' },
  tableMode,
  diagnosis,
}: {
  initial?: Partial<Question>;
  tableMode?: boolean;
  diagnosis?: QuestionScaleSliderDiagnosis;
}) {
  const [formData, setFormData] = useState<Partial<Question>>(initial);
  return (
    <QuestionScaleSliderFields
      formData={formData}
      setFormData={setFormData}
      tableMode={tableMode}
      diagnosis={diagnosis}
    />
  );
}

const toggle = () => screen.getByRole('switch', { name: '척도 슬라이더로 그리기' });

describe('QuestionScaleSliderFields — 스위치 설명', () => {
  afterEach(cleanup);

  it('보통 라디오 문항에서는 표 이야기를 하지 않는다', () => {
    render(<Harness initial={{}} />);
    expect(toggle()).toHaveAccessibleDescription(/웹과 모바일 둘 다에 적용됩니다/);
    expect(toggle()).not.toHaveAccessibleDescription(/행 단위/);
  });

  it('설명 테이블에서는 표가 웹에서도 행 단위로 그려진다고 알린다 — 켜기 전에도 보인다', () => {
    render(<Harness initial={{}} tableMode />);
    expect(toggle()).toHaveAccessibleDescription(/웹과 모바일 둘 다에 적용/);
    expect(toggle()).toHaveAccessibleDescription(/행 단위로 그려집니다/);
  });
});

describe('QuestionScaleSliderFields — 폴백 경고', () => {
  afterEach(cleanup);

  it('문제가 없으면 경고도 안내도 없다', () => {
    render(<Harness diagnosis={CLEAN} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/휴대폰에서/)).toBeNull();
    expect(screen.queryByText(/행마다 따로/)).toBeNull();
  });

  it('보통 라디오 문항 — 못 그리는 이유와 화면이 바뀌지 않음을 알린다', () => {
    render(
      <Harness
        diagnosis={{
          ...CLEAN,
          issues: [{ reason: 'text-input', message: '주관식 선택지가 있습니다.', rowLabels: [] }],
          drawsNothing: true,
        }}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('주관식 선택지가 있습니다.');
    expect(alert).toHaveTextContent('화면이 바뀌지 않습니다');
    expect(alert).not.toHaveTextContent('행:');
  });

  it('그룹 없는 설명 테이블 — 이유와 행 이름을 알린다', () => {
    render(
      <Harness
        tableMode
        diagnosis={{
          ...CLEAN,
          target: 'choice-table',
          issues: [
            { reason: 'missing-text', message: '글자가 없는 보기 칸이 있습니다.', rowLabels: ['2행'] },
          ],
        }}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('글자가 없는 보기 칸이 있습니다.');
    expect(alert).toHaveTextContent('행: 2행');
    expect(alert).toHaveTextContent('원본 표 조각으로 보입니다');
  });

  it('그룹 없는 설명 테이블 — 모든 행이 폴백이면 화면이 바뀌지 않는다는 한 줄이 보인다', () => {
    render(
      <Harness
        tableMode
        diagnosis={{
          ...CLEAN,
          target: 'choice-table',
          issues: [
            { reason: 'missing-text', message: '글자가 없는 보기 칸이 있습니다.', rowLabels: ['1행'] },
          ],
          drawsNothing: true,
        }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('이 표의 화면은 바뀌지 않습니다');
  });

  it('꺼진 문항에는 진단이 넘어와도 아무것도 보이지 않는다', () => {
    render(
      <Harness
        initial={{ scaleSlider: null }}
        diagnosis={{ ...CLEAN, crampedNarrowTiles: true, sharedAnswerRows: true, drawsNothing: true }}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/휴대폰에서/)).toBeNull();
    expect(screen.queryByText(/행마다 따로/)).toBeNull();
  });
});

describe('QuestionScaleSliderFields — 막지 않는 안내', () => {
  afterEach(cleanup);

  it('눈금이 8개 이상인 라디오 문항은 휴대폰에서 타일 글자가 잘게 끊긴다고 알린다', () => {
    render(<Harness diagnosis={{ ...CLEAN, crampedNarrowTiles: true }} />);
    expect(screen.getByText(/휴대폰에서는 타일 글자가 잘게 끊깁니다/)).toBeInTheDocument();
    // 막는 일이 아니다 — 경고 상자가 아니고 스위치는 켜진 채다
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toggle()).toBeChecked();
  });

  it('슬라이더가 서는 행이 둘 이상인 그룹 없는 표는 답이 문항에 하나임과 고치는 길을 알린다', () => {
    render(
      <Harness
        tableMode
        diagnosis={{ ...CLEAN, target: 'choice-table', sharedAnswerRows: true }}
      />,
    );
    const note = screen.getByText(/답이 문항에 하나/);
    expect(note).toHaveTextContent('한 행을 답하면 다른 행의 손잡이가 사라집니다');
    expect(note).toHaveTextContent('행마다 따로 답받으려면 행마다 보기 그룹을 만들고');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
