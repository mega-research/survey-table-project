import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ScaleSliderInfoNote,
  ScaleSliderIssueAlert,
} from '@/features/survey-builder/table-editor/scale-slider-guidance';

/**
 * 척도 슬라이더 폴백 경고 — 묶음 편집과 문항 설정 두 자리가 같은 상자·같은 글자를 쓴다. 상자는 척도 막대의
 * 경고 상자 그대로다.
 */

const textInput = {
  reason: 'text-input' as const,
  message: '「선택 시 텍스트 입력 받기」가 켜진 보기가 있습니다.',
  rowLabels: ['회의실 지원', '멘토링'],
};

describe('ScaleSliderIssueAlert', () => {
  afterEach(cleanup);

  it('문제가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <ScaleSliderIssueAlert kind="table" issues={[]} drawsNothing={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('표 — 폴백 행이 있으면 이유와 행 이름을 보이고 그 행이 어떻게 보이는지 적는다', () => {
    render(<ScaleSliderIssueAlert kind="table" issues={[textInput]} drawsNothing={false} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('그 행은 원본 표 조각으로 보입니다');
    expect(alert).toHaveTextContent(textInput.message);
    expect(alert).toHaveTextContent('행: 회의실 지원, 멘토링');
    expect(alert).not.toHaveTextContent('화면은 바뀌지 않습니다');
  });

  it('표 — 모든 행이 폴백이면 화면이 바뀌지 않는다는 한 줄을 따로 보인다', () => {
    render(<ScaleSliderIssueAlert kind="table" issues={[textInput]} drawsNothing />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(textInput.message);
    expect(alert).toHaveTextContent(
      '슬라이더로 그릴 수 있는 행이 없어 이 표의 화면은 바뀌지 않습니다',
    );
  });

  it('표 — 폴백 이유 없이 그릴 행만 없어도 그 한 줄은 보인다', () => {
    render(<ScaleSliderIssueAlert kind="table" issues={[]} drawsNothing />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      '슬라이더로 그릴 수 있는 행이 없어 이 표의 화면은 바뀌지 않습니다',
    );
  });

  it('보통 라디오 문항 — 행 이름 없이 이유만 보이고 보기 목록 그대로라고 적는다', () => {
    render(
      <ScaleSliderIssueAlert
        kind="radio-options"
        issues={[{ reason: 'text-input', message: '주관식 선택지가 있습니다.', rowLabels: [] }]}
        drawsNothing
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('화면이 바뀌지 않습니다');
    expect(alert).toHaveTextContent('보기 목록 그대로');
    expect(alert).toHaveTextContent('주관식 선택지가 있습니다.');
    expect(alert).not.toHaveTextContent('행:');
  });
});

describe('ScaleSliderInfoNote', () => {
  afterEach(cleanup);

  it('안내 글자를 그리고 경고로 읽히지 않는다 — 막는 일이 아니다', () => {
    render(<ScaleSliderInfoNote id="note-1">행 단위로 그려집니다.</ScaleSliderInfoNote>);
    expect(screen.getByText('행 단위로 그려집니다.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.getElementById('note-1')).toHaveTextContent('행 단위로 그려집니다.');
  });
});
