import { useRef, useState } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 무거운 자식(TipTap 에디터 / 표 에디터)은 대체한다 — 검증 대상은 응답 인용 컨트롤이다.
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

/** 실제 옵션 헬퍼로 formData 를 굴리는 하네스 — 저장 경로와 같은 갱신 함수를 쓴다. */
function Harness({ question, initial }: { question: Question; initial: Partial<Question> }) {
  const [formData, setFormData] = useState<Partial<Question>>(initial);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showBranchSettings, setShowBranchSettings] = useState(false);
  const [localTitle, setLocalTitle] = useState(question.title);
  const [localExportLabel, setLocalExportLabel] = useState('');
  const debouncedTitleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedExportLabelRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
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
      addSelectLevel={createAddSelectLevel(setFormData)}
      updateSelectLevel={createUpdateSelectLevel(setFormData)}
      removeSelectLevel={createRemoveSelectLevel(setFormData)}
      addLevelOption={createAddLevelOption(setFormData)}
      updateOptionWithParent={createUpdateOptionWithParent(setFormData)}
      updateLevelOption={createUpdateLevelOption(setFormData)}
      removeLevelOption={createRemoveLevelOption(setFormData)}
    />
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
    { id: 'o1', label: '전기차', value: '1' },
    { id: 'o2', label: '기타', value: '2', allowTextInput: true },
  ],
};

const textQuestion = {
  id: 'q2',
  type: 'text',
  title: '거주 지역',
  required: false,
  order: 2,
} as unknown as Question;

describe('빌더 응답 인용 컨트롤', () => {
  afterEach(() => cleanup());

  it('토글이 꺼져 있으면 인용 이름·문구 입력칸이 전혀 없다', () => {
    render(<Harness question={radioQuestion} initial={radioFormData} />);

    expect(screen.getByLabelText('응답 인용')).not.toBeChecked();
    expect(screen.queryByLabelText('인용 이름')).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText('인용 문구')).toHaveLength(0);
  });

  it('토글을 켜면 인용 이름·안내·옵션별 인용 문구 입력칸이 등장한다', () => {
    render(<Harness question={radioQuestion} initial={radioFormData} />);

    fireEvent.click(screen.getByLabelText('응답 인용'));

    expect(screen.getByLabelText('인용 이름')).toBeInTheDocument();
    // 인용 결과 없음 안내 — 빈 인용과 유령 인용을 한 문단으로 다룬다
    expect(screen.getByText(/인용 결과가 비면 문장이 깨집니다/)).toBeInTheDocument();
    expect(screen.getByText(/이 질문이 조건으로 숨겨진 경우에도/)).toBeInTheDocument();
    // 옵션 2개 각각에 인용 문구 입력칸
    expect(screen.getAllByLabelText('인용 문구')).toHaveLength(2);
  });

  it('인용 이름을 입력하면 참조 토큰이 실시간으로 갱신된다', () => {
    render(<Harness question={radioQuestion} initial={radioFormData} />);
    fireEvent.click(screen.getByLabelText('응답 인용'));

    // 이름을 입력하기 전에는 자리표시 토큰
    expect(screen.getByText('{{{인용이름}}}')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('인용 이름'), { target: { value: '마케팅유형' } });

    expect(screen.getByRole('button', { name: '{{{마케팅유형}}}' })).toBeInTheDocument();
  });

  it('주관식 옵션에만 {{입력}} 힌트를 붙인다', () => {
    render(<Harness question={radioQuestion} initial={radioFormData} />);
    fireEvent.click(screen.getByLabelText('응답 인용'));

    // 옵션 2개 중 allowTextInput 인 하나만 힌트를 갖는다
    expect(screen.getAllByText(/\{\{입력\}\} 을 쓰면/)).toHaveLength(1);
  });

  it('옵션 인용 문구 입력이 옵션 객체의 answerQuoteText 로 반영된다', () => {
    render(<Harness question={radioQuestion} initial={radioFormData} />);
    fireEvent.click(screen.getByLabelText('응답 인용'));

    const inputs = screen.getAllByLabelText('인용 문구');
    fireEvent.change(inputs[0] as HTMLElement, { target: { value: '전기차를' } });

    expect(screen.getAllByLabelText('인용 문구')[0]).toHaveValue('전기차를');
  });

  it('토글을 껐다 다시 켜도 옵션 인용 문구가 남아 있다', () => {
    render(<Harness question={radioQuestion} initial={radioFormData} />);
    const toggle = screen.getByLabelText('응답 인용');

    fireEvent.click(toggle);
    fireEvent.change(screen.getAllByLabelText('인용 문구')[0] as HTMLElement, {
      target: { value: '전기차를' },
    });

    fireEvent.click(toggle);
    expect(screen.queryAllByLabelText('인용 문구')).toHaveLength(0);

    fireEvent.click(toggle);
    expect(screen.getAllByLabelText('인용 문구')[0]).toHaveValue('전기차를');
  });

  it('단답형은 옵션이 없어 질문 자체에 인용 문구 입력칸이 붙는다', () => {
    render(<Harness question={textQuestion} initial={{ title: '거주 지역' }} />);

    fireEvent.click(screen.getByLabelText('응답 인용'));

    const field = screen.getByLabelText('인용 문구');
    expect(field).toBeInTheDocument();
    expect(screen.getByText(/\{\{입력\}\} 을 쓰면/)).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '{{입력}} 지역' } });
    expect(screen.getByLabelText('인용 문구')).toHaveValue('{{입력}} 지역');
  });

  it('장문형에는 응답 인용 컨트롤이 나타나지 않는다', () => {
    const textarea = { ...textQuestion, id: 'q3', type: 'textarea' } as unknown as Question;
    render(<Harness question={textarea} initial={{ title: '자유 의견' }} />);

    expect(screen.queryByLabelText('응답 인용')).not.toBeInTheDocument();
  });

  it('표 질문에는 질문 레벨 컨트롤이 나타나지 않는다 — 인용 이름은 셀이 소유한다', () => {
    const table = { ...textQuestion, id: 'q4', type: 'table' } as unknown as Question;
    render(<Harness question={table} initial={{ title: '항목별 인원' }} />);

    expect(screen.queryByLabelText('응답 인용')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('인용 이름')).not.toBeInTheDocument();
  });
});
