import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RankingOptionsEditor } from '@/components/survey-builder/ranking-options-editor';
import type { QuestionOption } from '@/types/survey';

/**
 * 순위형 셀(Case 3) 옵션의 "변수번호"(optionCode) blur 커밋 배선 검증.
 * cell-choice-editor-option-code.test.tsx 와 동일한 하네스 패턴 — controlled 컴포넌트라
 * 부모가 state 를 들고 있어야 onBlur 클로저가 최신 코드를 읽는다.
 */
function Harness({
  onOptionValueChange,
}: {
  onOptionValueChange?: (c: { oldValue: string; newValue: string }) => void;
}) {
  const [options, setOptions] = useState<QuestionOption[]>([
    { id: 'a', label: '옵션 A', value: 'opt1', optionCode: '1', isCustomOptionCode: true },
    { id: 'b', label: '옵션 B', value: 'opt2' },
  ]);

  return (
    <>
      <RankingOptionsEditor
        options={options}
        onChange={setOptions}
        {...(onOptionValueChange ? { onOptionValueChange } : {})}
      />
      <div data-testid="options-dump">{JSON.stringify(options)}</div>
    </>
  );
}

describe('RankingOptionsEditor 응답값(변수번호) 입력 배선', () => {
  it('타이핑 중에는 value 가 바뀌지 않고, blur 시점에만 value 가 동기화되며 상위에 통보된다', async () => {
    const onOptionValueChange = vi.fn();
    render(<Harness onOptionValueChange={onOptionValueChange} />);

    const codeInputs = screen.getAllByPlaceholderText('코드');
    const secondCode = codeInputs[1]!; // 옵션 B (value: opt2, optionCode 없음)

    await userEvent.type(secondCode, '5');
    expect(onOptionValueChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('options-dump').textContent).toContain('"value":"opt2"');

    await userEvent.tab(); // blur
    expect(onOptionValueChange).toHaveBeenCalledTimes(1);
    expect(onOptionValueChange).toHaveBeenCalledWith({ oldValue: 'opt2', newValue: '5' });

    const dumped = JSON.parse(
      screen.getByTestId('options-dump').textContent ?? '[]',
    ) as QuestionOption[];
    expect(dumped[1]).toMatchObject({
      id: 'b',
      value: '5',
      optionCode: '5',
      isCustomOptionCode: true,
    });
  });

  it('다른 옵션의 코드와 중복되면 blur 후 경고가 뜨고 value 동기화가 보류된다', async () => {
    const onOptionValueChange = vi.fn();
    render(<Harness onOptionValueChange={onOptionValueChange} />);

    const codeInputs = screen.getAllByPlaceholderText('코드');
    const secondCode = codeInputs[1]!;

    await userEvent.type(secondCode, '1'); // 옵션 A 의 optionCode 와 충돌
    await userEvent.tab();

    expect(onOptionValueChange).not.toHaveBeenCalled();
    expect(await screen.findByText('응답값이 다른 옵션과 중복됩니다')).toBeInTheDocument();
    expect(secondCode).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('options-dump').textContent).toContain('"value":"opt2"');
  });
});
