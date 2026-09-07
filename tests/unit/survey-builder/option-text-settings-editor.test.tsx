import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CellChoiceEditor } from '@/components/survey-builder/cell-choice-editor';
import type { CheckboxOption, QuestionOption, RadioOption } from '@/types/survey';

/**
 * 옵션 텍스트 설정 편집기의 배선 검증.
 *
 * 응답 렌더(`option-text-input`)·범위 검증·SPSS 내보내기는 이미 옵션의
 * `textInputType='number'` 를 읽고 있었고, 빌더에서 켤 자리만 없었다. 여기서 보는 것은
 * "체크하면 옵션 객체에 그 필드가 실제로 실리는가" 하나다.
 */
type Options = { radio: RadioOption[]; checkbox: CheckboxOption[]; select: QuestionOption[] };

function Harness({
  cellType,
  onChange,
}: {
  cellType: 'radio' | 'checkbox' | 'select';
  onChange?: (options: Options) => void;
}) {
  const [options, setOptions] = useState<Options>({
    radio: [{ id: 'a', label: '매출액', value: '1', allowTextInput: true }],
    checkbox: [{ id: 'b', label: '매출액', value: '1', allowTextInput: true }],
    select: [{ id: 'c', label: '매출액', value: '1', allowTextInput: true }],
  });
  const update = (next: Options) => {
    setOptions(next);
    onChange?.(next);
  };

  return (
    <CellChoiceEditor
      cellType={cellType}
      textContent=""
      currentQuestionId="q1"
      questions={[]}
      checkboxOptions={options.checkbox}
      onCheckboxOptionsChange={(checkbox) => update({ ...options, checkbox })}
      radioOptions={options.radio}
      onRadioOptionsChange={(radio) => update({ ...options, radio })}
      radioGroupName="g1"
      onRadioGroupNameChange={() => {}}
      selectOptions={options.select}
      onSelectOptionsChange={(select) => update({ ...options, select })}
      minSelections={undefined}
      onMinSelectionsChange={() => {}}
      maxSelections={undefined}
      onMaxSelectionsChange={() => {}}
    />
  );
}

describe('옵션 텍스트 설정 편집기 — 숫자만 입력', () => {
  it('주관식 옵션 아래에 "숫자만 입력" 체크박스가 뜬다', () => {
    render(<Harness cellType="radio" />);
    expect(screen.getByLabelText(/숫자만 입력/)).toBeInTheDocument();
  });

  it('체크하면 라디오 옵션에 textInputType=number 가 실린다', async () => {
    let latest: Options | undefined;
    render(<Harness cellType="radio" onChange={(o) => (latest = o)} />);

    await userEvent.click(screen.getByLabelText(/숫자만 입력/));

    expect(latest?.radio[0]?.textInputType).toBe('number');
  });

  it('체크하면 숫자 형식 설정(단위 등)이 함께 나타난다', async () => {
    render(<Harness cellType="radio" />);
    expect(screen.queryByLabelText('단위')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/숫자만 입력/));

    expect(screen.getByLabelText('단위')).toBeInTheDocument();
  });

  it('체크를 해제하면 textInputType 키가 사라진다', async () => {
    let latest: Options | undefined;
    render(<Harness cellType="radio" onChange={(o) => (latest = o)} />);

    const toggle = screen.getByLabelText(/숫자만 입력/);
    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(latest?.radio[0] && 'textInputType' in latest.radio[0]).toBe(false);
  });

  it('체크박스 셀 옵션에도 같은 설정이 붙는다', async () => {
    let latest: Options | undefined;
    render(<Harness cellType="checkbox" onChange={(o) => (latest = o)} />);

    await userEvent.click(screen.getByLabelText(/숫자만 입력/));

    expect(latest?.checkbox[0]?.textInputType).toBe('number');
  });

  it('드롭다운 셀 옵션에도 같은 설정이 붙는다', async () => {
    let latest: Options | undefined;
    render(<Harness cellType="select" onChange={(o) => (latest = o)} />);

    await userEvent.click(screen.getByLabelText(/숫자만 입력/));

    expect(latest?.select[0]?.textInputType).toBe('number');
  });
});
