import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CellChoiceEditor } from '@/components/survey-builder/table-editor/cell-editor/cell-choice-editor';
import type { RadioOption } from '@/types/survey';

/**
 * blur 커밋 배선 검증 — CellChoiceEditor 는 controlled 컴포넌트라 실제 blur 동작을
 * 재현하려면 부모가 state 를 들고 있어야 한다 (radioOptions prop 은 항상 최신이어야
 * onBlur 클로저가 최신 코드를 읽는다).
 */
function Harness({ onOptionValueChange }: { onOptionValueChange?: (c: { oldValue: string; newValue: string }) => void }) {
  const [radioOptions, setRadioOptions] = useState<RadioOption[]>([
    { id: 'a', label: '옵션 A', value: 'option-1', optionCode: '1', isCustomOptionCode: true },
    { id: 'b', label: '옵션 B', value: 'option-2' },
  ]);

  return (
    <CellChoiceEditor
      cellType="radio"
      textContent=""
      currentQuestionId="q1"
      questions={[]}
      checkboxOptions={[]}
      onCheckboxOptionsChange={() => {}}
      radioOptions={radioOptions}
      onRadioOptionsChange={setRadioOptions}
      radioGroupName="g1"
      onRadioGroupNameChange={() => {}}
      selectOptions={[]}
      onSelectOptionsChange={() => {}}
      minSelections={undefined}
      onMinSelectionsChange={() => {}}
      maxSelections={undefined}
      onMaxSelectionsChange={() => {}}
      {...(onOptionValueChange ? { onOptionValueChange } : {})}
    />
  );
}

describe('CellChoiceEditor 응답값(변수번호) 입력 배선', () => {
  it('타이핑 중에는 onOptionValueChange 가 호출되지 않고, blur 시점에만 호출된다', async () => {
    const onOptionValueChange = vi.fn();
    render(<Harness onOptionValueChange={onOptionValueChange} />);

    const codeInputs = screen.getAllByPlaceholderText('코드');
    const secondCode = codeInputs[1]!; // 옵션 B (value: option-2, optionCode 없음)

    await userEvent.type(secondCode, '5');
    expect(onOptionValueChange).not.toHaveBeenCalled();

    await userEvent.tab(); // blur
    expect(onOptionValueChange).toHaveBeenCalledTimes(1);
    expect(onOptionValueChange).toHaveBeenCalledWith({ oldValue: 'option-2', newValue: '5' });
  });

  it('다른 옵션의 코드와 중복되면 blur 후 경고가 뜨고 onOptionValueChange 는 호출되지 않는다', async () => {
    const onOptionValueChange = vi.fn();
    render(<Harness onOptionValueChange={onOptionValueChange} />);

    const codeInputs = screen.getAllByPlaceholderText('코드');
    const secondCode = codeInputs[1]!; // 옵션 B

    await userEvent.type(secondCode, '1'); // 옵션 A 의 optionCode 와 충돌
    await userEvent.tab();

    expect(onOptionValueChange).not.toHaveBeenCalled();
    expect(await screen.findByText('응답값이 다른 옵션과 중복됩니다')).toBeInTheDocument();
    expect(secondCode).toHaveAttribute('aria-invalid', 'true');
  });

  it('충돌 없이 재입력하면 경고가 사라진다', async () => {
    render(<Harness />);

    const codeInputs = screen.getAllByPlaceholderText('코드');
    const secondCode = codeInputs[1]!;

    await userEvent.type(secondCode, '1');
    await userEvent.tab();
    expect(await screen.findByText('응답값이 다른 옵션과 중복됩니다')).toBeInTheDocument();

    await userEvent.clear(secondCode);
    await userEvent.type(secondCode, '9');
    await userEvent.tab();

    expect(screen.queryByText('응답값이 다른 옵션과 중복됩니다')).not.toBeInTheDocument();
  });
});
