import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CellChoiceEditor } from '@/features/survey-builder/table-editor/cell-editor/cell-choice-editor';

/**
 * 선택 칸 설정의 「중복 불가 묶음」 — 이름을 적고, 같은 열의 다른 선택 칸에도 한 번에 건다.
 * 값의 저장·일괄 적용은 직렬화·커밋 테스트가 지키고 여기는 입력 배선과 안내만 본다.
 */
function Harness({
  cellType = 'select',
  columnApplyCount = 3,
  warning,
}: {
  cellType?: 'select' | 'radio';
  columnApplyCount?: number;
  warning?: string;
}) {
  const [name, setName] = useState('');
  const [applyToColumn, setApplyToColumn] = useState(false);
  return (
    <>
      <CellChoiceEditor
        cellType={cellType}
        textContent=""
        currentQuestionId="q1"
        questions={[]}
        checkboxOptions={[]}
        onCheckboxOptionsChange={() => {}}
        radioOptions={[]}
        onRadioOptionsChange={() => {}}
        radioGroupName=""
        onRadioGroupNameChange={() => {}}
        selectOptions={[]}
        onSelectOptionsChange={() => {}}
        minSelections={undefined}
        onMinSelectionsChange={() => {}}
        maxSelections={undefined}
        onMaxSelectionsChange={() => {}}
        distinctGroup={{
          name,
          onNameChange: setName,
          applyToColumn,
          onApplyToColumnChange: setApplyToColumn,
          columnApplyCount,
          warning,
        }}
      />
      <output data-testid="state">{JSON.stringify({ name, applyToColumn })}</output>
    </>
  );
}

function state() {
  return JSON.parse(screen.getByTestId('state').textContent!);
}

describe('CellChoiceEditor — 중복 불가 묶음', () => {
  it('선택 칸 설정에서 묶음 이름을 적는다', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('중복 불가 묶음 이름'), {
      target: { value: '수출국가-2025' },
    });
    expect(state().name).toBe('수출국가-2025');
  });

  it('같은 열의 다른 선택 칸 수를 보이고 체크하면 일괄 적용을 켠다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText('같은 열의 다른 선택 칸에도 적용 (3개)'));
    expect(state().applyToColumn).toBe(true);
  });

  it('같은 열에 다른 선택 칸이 없으면 일괄 적용 체크를 보이지 않는다', () => {
    render(<Harness columnApplyCount={0} />);
    expect(screen.queryByLabelText(/같은 열의 다른 선택 칸에도 적용/)).not.toBeInTheDocument();
  });

  it('경고가 있으면 보인다', () => {
    render(<Harness warning="이 이름을 쓰는 다른 선택 칸이 아직 없습니다." />);
    expect(screen.getByText('이 이름을 쓰는 다른 선택 칸이 아직 없습니다.')).toBeInTheDocument();
  });

  it('선택 칸이 아닌 유형에는 묶음 이름 칸이 없다', () => {
    render(<Harness cellType="radio" />);
    expect(screen.queryByLabelText('중복 불가 묶음 이름')).not.toBeInTheDocument();
  });
});
