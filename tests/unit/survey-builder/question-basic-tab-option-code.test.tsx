import { useRef, useState } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 무거운 자식(TipTap 에디터 / 표 에디터)은 대체한다 — 검증 대상은 질문 레벨 옵션의
// "변수번호"(optionCode) Input 배선이다. tests/unit/survey/answer-quote-builder-controls.test.tsx
// 와 동일한 하네스 패턴(실제 option 헬퍼로 formData 를 굴림).
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => null,
}));
vi.mock('@/components/survey-builder/table-editor/dynamic-table-editor', () => ({
  DynamicTableEditor: () => null,
}));

import { QuestionBasicTab } from '@/components/survey-builder/question-edit/question-basic-tab';
import {
  createAddLevelOption,
  createAddOption,
  createAddSelectLevel,
  createRemoveLevelOption,
  createRemoveOption,
  createRemoveSelectLevel,
  createUpdateLevelOption,
  createUpdateOption,
  createUpdateOptionWithParent,
  createUpdateSelectLevel,
} from '@/components/survey-builder/question-option-helpers';
import type { Question } from '@/types/survey';

function Harness({
  question,
  initial,
  onOptionValueChange,
}: {
  question: Question;
  initial: Partial<Question>;
  onOptionValueChange?: (change: { oldValue: string; newValue: string }) => void;
}) {
  const [formData, setFormData] = useState<Partial<Question>>(initial);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showBranchSettings, setShowBranchSettings] = useState(false);
  const [localTitle, setLocalTitle] = useState(question.title);
  const [localExportLabel, setLocalExportLabel] = useState('');
  const debouncedTitleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedExportLabelRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <>
      <QuestionBasicTab
        question={question}
        questionId={question.id}
        questions={[question]}
        formData={formData}
        setFormData={setFormData}
        validationErrors={validationErrors}
        setValidationErrors={setValidationErrors}
        showBranchSettings={showBranchSettings}
        setShowBranchSettings={setShowBranchSettings}
        localTitle={localTitle}
        setLocalTitle={setLocalTitle}
        localExportLabel={localExportLabel}
        setLocalExportLabel={setLocalExportLabel}
        debouncedTitleRef={debouncedTitleRef}
        debouncedExportLabelRef={debouncedExportLabelRef}
        addOption={createAddOption(setFormData)}
        updateOption={createUpdateOption(setFormData)}
        removeOption={createRemoveOption(setFormData)}
        {...(onOptionValueChange ? { onOptionValueChange } : {})}
        addSelectLevel={createAddSelectLevel(setFormData)}
        updateSelectLevel={createUpdateSelectLevel(setFormData)}
        removeSelectLevel={createRemoveSelectLevel(setFormData)}
        addLevelOption={createAddLevelOption(setFormData)}
        updateOptionWithParent={createUpdateOptionWithParent(setFormData)}
        updateLevelOption={createUpdateLevelOption(setFormData)}
        removeLevelOption={createRemoveLevelOption(setFormData)}
      />
      {/* 테스트 검증용 — formData.options 를 직렬화해 노출 */}
      <div data-testid="options-dump">{JSON.stringify(formData.options)}</div>
    </>
  );
}

const radioQuestion = {
  id: 'q1',
  type: 'radio',
  title: '어떤 차를 타십니까',
  required: false,
  order: 1,
} as unknown as Question;

const radioFormData: Partial<Question> = {
  title: '어떤 차를 타십니까',
  options: [
    { id: 'o1', label: '전기차', value: 'option-1', optionCode: '1', isCustomOptionCode: true },
    { id: 'o2', label: '기타', value: 'option-2' },
  ],
};

describe('QuestionBasicTab 질문 레벨 옵션 "변수번호"(optionCode) 입력 배선', () => {
  afterEach(() => cleanup());

  it('타이핑 중에는 onOptionValueChange 가 호출되지 않고, blur 시점에만 value 가 동기화된다', async () => {
    const onOptionValueChange = vi.fn();
    render(
      <Harness question={radioQuestion} initial={radioFormData} onOptionValueChange={onOptionValueChange} />,
    );

    const codeInputs = screen.getAllByLabelText('변수번호');
    const secondCode = codeInputs[1]!; // 옵션 "기타" (value: option-2, optionCode 없음)

    // Input 은 controlled — optionCode 미설정 시에도 자동 발번 코드("2")가 표시돼 있으므로
    // 실제 사용자 흐름처럼 지운 뒤 타이핑한다(그렇지 않으면 기존 표시값 뒤에 이어붙는다).
    await userEvent.clear(secondCode);
    await userEvent.type(secondCode, '5');
    expect(onOptionValueChange).not.toHaveBeenCalled();
    // 타이핑 중에는 아직 value 가 그대로다 — dump 에 option-2 가 남아있어야 한다.
    expect(screen.getByTestId('options-dump').textContent).toContain('"value":"option-2"');

    await userEvent.tab(); // blur
    expect(onOptionValueChange).toHaveBeenCalledTimes(1);
    expect(onOptionValueChange).toHaveBeenCalledWith({ oldValue: 'option-2', newValue: '5' });
    expect(screen.getByTestId('options-dump').textContent).toContain('"value":"5"');
  });

  it('다른 옵션의 코드와 중복되면 blur 후 경고가 뜨고 onOptionValueChange 는 호출되지 않으며 value 도 그대로다', async () => {
    const onOptionValueChange = vi.fn();
    render(
      <Harness question={radioQuestion} initial={radioFormData} onOptionValueChange={onOptionValueChange} />,
    );

    const codeInputs = screen.getAllByLabelText('변수번호');
    const secondCode = codeInputs[1]!;

    await userEvent.clear(secondCode);
    await userEvent.type(secondCode, '1'); // 옵션 "전기차"(optionCode: '1')와 충돌
    await userEvent.tab();

    expect(onOptionValueChange).not.toHaveBeenCalled();
    expect(await screen.findByText('응답값이 다른 옵션과 중복됩니다')).toBeInTheDocument();
    expect(secondCode).toHaveAttribute('aria-invalid', 'true');
    // 충돌 시 value 동기화는 보류된다 — 원래 값(option-2) 유지.
    expect(screen.getByTestId('options-dump').textContent).toContain('"value":"option-2"');
  });

  it('충돌 없이 재입력하면 경고가 사라진다', async () => {
    render(<Harness question={radioQuestion} initial={radioFormData} />);

    const codeInputs = screen.getAllByLabelText('변수번호');
    const secondCode = codeInputs[1]!;

    await userEvent.clear(secondCode);
    await userEvent.type(secondCode, '1');
    await userEvent.tab();
    expect(await screen.findByText('응답값이 다른 옵션과 중복됩니다')).toBeInTheDocument();

    await userEvent.clear(secondCode);
    await userEvent.type(secondCode, '9');
    await userEvent.tab();

    expect(screen.queryByText('응답값이 다른 옵션과 중복됩니다')).not.toBeInTheDocument();
  });

  it('편집 없이 blur 만 발생하면(자동 코드 미변경) value 는 바뀌지 않는다', async () => {
    const onOptionValueChange = vi.fn();
    render(
      <Harness question={radioQuestion} initial={radioFormData} onOptionValueChange={onOptionValueChange} />,
    );

    const codeInputs = screen.getAllByLabelText('변수번호');
    const secondCode = codeInputs[1]!;

    // 클릭만 하고(자동 표시 코드는 건드리지 않은 채) 바로 blur.
    await userEvent.click(secondCode);
    await userEvent.tab();

    expect(onOptionValueChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('options-dump').textContent).toContain('"value":"option-2"');
  });
});
