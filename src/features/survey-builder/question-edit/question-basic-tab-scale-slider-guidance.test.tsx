import { useRef, useState } from 'react';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 무거운 자식(TipTap 에디터 / 표 에디터)은 대체한다 — 보려는 것은 문항 설정의 척도 슬라이더 안내가
// 편집 중인 폼 값(보기 · 표 구조)과 스토어의 보기 그룹으로 진단되어 스위치 아래에 뜨는지다.
// 표 에디터에는 폼의 슬라이더 방향이 넘어가야 한다(모바일 표시 방식 옆 안내의 재료).
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => null,
}));
vi.mock('@/features/survey-builder/table-editor/dynamic-table-editor', () => ({
  DynamicTableEditor: ({ questionScaleSlider }: { questionScaleSlider?: string | null }) => (
    <output data-testid="table-editor-slider">{String(questionScaleSlider)}</output>
  ),
}));

import {
  RADIO_OPTION_SLIDER_FALLBACK_MESSAGES,
  SCALE_SLIDER_FALLBACK_MESSAGES,
} from '@/features/survey-builder/lib/scale-slider-diagnostics';
import { QuestionBasicTab } from '@/features/survey-builder/question-edit/question-basic-tab';
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
} from '@/features/survey-builder/question-option-helpers';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { Question, QuestionOption, TableRow } from '@/types/survey';

function Harness({ question, initial }: { question: Question; initial: Partial<Question> }) {
  const [formData, setFormData] = useState<Partial<Question>>(initial);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showBranchSettings, setShowBranchSettings] = useState(false);
  const [localTitle, setLocalTitle] = useState(question.title);
  const [localTitleHtml, setLocalTitleHtml] = useState('');
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
        localTitleHtml={localTitleHtml}
        setLocalTitleHtml={setLocalTitleHtml}
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
      <output data-testid="form">{JSON.stringify(formData)}</output>
    </>
  );
}

const question = (type: Question['type']) =>
  ({ id: 'q1', type, title: '추천 의향', required: false, order: 1 }) as unknown as Question;

const options = (count: number, extra: Record<number, Partial<QuestionOption>> = {}) =>
  Array.from({ length: count }, (_, n): QuestionOption => ({
    id: `o${n + 1}`,
    label: `보기 ${n + 1}`,
    value: String(n + 1),
    ...extra[n + 1],
  }));

const optionsForm = (count: number, extra: Partial<Question> = {}): Partial<Question> => ({
  title: '추천 의향',
  options: options(count),
  scaleSlider: 'positive-right',
  ...extra,
});

const scaleRow = (id: string, label: string): TableRow => ({
  id,
  label,
  cells: [
    { id: `${id}-item`, type: 'text', content: label },
    { id: `${id}-o1`, type: 'choice_opt', content: '①' },
    { id: `${id}-o2`, type: 'choice_opt', content: '②' },
    { id: `${id}-o3`, type: 'choice_opt', content: '③' },
  ],
});

/** 보기를 설명 테이블로 구성한 문항의 폼 — 보기 칸이 이어진 행(그룹 없음) */
const tableForm = (rows: TableRow[], extra: Partial<Question> = {}): Partial<Question> => ({
  title: '추천 의향',
  options: [],
  tableColumns: [
    { id: 'c1', label: '항목' },
    { id: 'c2', label: '' },
    { id: 'c3', label: '' },
    { id: 'c4', label: '' },
  ],
  tableRowsData: rows,
  scaleSlider: 'positive-right',
  ...extra,
});

const sliderSwitch = () => screen.getByRole('switch', { name: '척도 슬라이더로 그리기' });
const resetStore = () =>
  useSurveyBuilderStore.setState((state) => ({
    currentSurvey: { ...state.currentSurvey, questions: [] },
  }));

describe('QuestionBasicTab — 보통 라디오 문항의 슬라이더 안내', () => {
  afterEach(() => {
    cleanup();
    resetStore();
  });

  it('슬라이더로 그려지는 문항은 경고가 없다', () => {
    render(<Harness question={question('radio')} initial={optionsForm(5)} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/휴대폰에서는 타일 글자가/)).toBeNull();
  });

  it('주관식 선택지를 더하면 그 자리에서 못 그리는 이유가 뜬다', () => {
    render(<Harness question={question('radio')} initial={optionsForm(3)} />);
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '주관식 선택지' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(RADIO_OPTION_SLIDER_FALLBACK_MESSAGES['text-input']);
    expect(alert).toHaveTextContent('화면이 바뀌지 않습니다');
  });

  it('눈금이 8개 이상이면 휴대폰 안내가 스위치 아래에 뜨고, 「평균 제외」로 눈금이 줄면 사라진다', () => {
    render(<Harness question={question('radio')} initial={optionsForm(8)} />);
    expect(screen.getByText(/휴대폰에서는 타일 글자가 잘게 끊깁니다/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText('평균에서 제외')[7]!);
    expect(screen.queryByText(/휴대폰에서는 타일 글자가/)).toBeNull();
  });

  it('스위치를 끄면 경고와 안내가 함께 사라진다', () => {
    render(
      <Harness
        question={question('radio')}
        initial={optionsForm(8, { options: options(9, { 9: { allowTextInput: true } }) })}
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(sliderSwitch());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('QuestionBasicTab — 슬라이더를 켠 문항의 「평균 제외」 문구', () => {
  afterEach(() => {
    cleanup();
    resetStore();
  });

  it('슬라이더를 켠 문항은 「평균 제외」 체크에 체크로 떨어진다는 설명이 이어져 있다', () => {
    render(<Harness question={question('radio')} initial={optionsForm(3)} />);
    for (const checkbox of screen.getAllByLabelText('평균에서 제외')) {
      expect(checkbox).toHaveAccessibleDescription(/척도 슬라이더에서는 .*체크로 떨어집니다/);
    }
    expect(screen.getAllByText(/척도 슬라이더에서는 .*체크로 떨어집니다/)).toHaveLength(1);
  });

  it('슬라이더가 꺼진 척도 평균 문항은 지금 화면 그대로다 — 슬라이더 문구가 없다', () => {
    render(
      <Harness
        question={question('radio')}
        initial={optionsForm(3, { scaleSlider: null, scaleMeanEnabled: true })}
      />,
    );
    expect(screen.getAllByLabelText('평균에서 제외')).toHaveLength(3);
    expect(screen.queryByText(/체크로 떨어집니다/)).toBeNull();
  });
});

describe('QuestionBasicTab — 그룹 없는 설명 테이블의 슬라이더 안내', () => {
  afterEach(() => {
    cleanup();
    resetStore();
  });

  it('스위치 설명이 표가 행 단위로 그려진다고 알린다 — 보통 라디오 문항에는 그 말이 없다', () => {
    render(
      <Harness question={question('radio')} initial={tableForm([scaleRow('r1', '추천 의향')])} />,
    );
    expect(sliderSwitch()).toHaveAccessibleDescription(/행 단위로 그려집니다/);
    cleanup();

    render(<Harness question={question('radio')} initial={optionsForm(3)} />);
    expect(sliderSwitch()).not.toHaveAccessibleDescription(/행 단위/);
  });

  it('행이 하나면 답이 하나라는 안내가 없고, 둘 이상이면 뜬다', () => {
    render(
      <Harness question={question('radio')} initial={tableForm([scaleRow('r1', '추천 의향')])} />,
    );
    expect(screen.queryByText(/답이 문항에 하나/)).toBeNull();
    cleanup();

    render(
      <Harness
        question={question('radio')}
        initial={tableForm([scaleRow('r1', '추천 의향'), scaleRow('r2', '재이용 의향')])}
      />,
    );
    expect(screen.getByText(/답이 문항에 하나/)).toBeInTheDocument();
  });

  it('못 그리는 행이 있으면 이유와 행 이름을 알린다', () => {
    const broken: TableRow = {
      ...scaleRow('r2', '재이용 의향'),
      cells: scaleRow('r2', '재이용 의향').cells.map((cell) =>
        cell.type === 'choice_opt' ? { ...cell, content: '' } : cell,
      ),
    };
    render(
      <Harness
        question={question('radio')}
        initial={tableForm([scaleRow('r1', '추천 의향'), broken])}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(SCALE_SLIDER_FALLBACK_MESSAGES['missing-text']);
    expect(alert).toHaveTextContent('행: 재이용 의향');
    expect(alert).not.toHaveTextContent('화면은 바뀌지 않습니다');
  });

  it('진단은 스토어의 보기 그룹을 본다 — 폼에 없는 순위 그룹은 그룹 없는 표 그대로다', () => {
    const form = tableForm([scaleRow('r1', '추천 의향'), scaleRow('r2', '재이용 의향')]);
    const stored = {
      ...question('radio'),
      ...form,
      choiceGroups: [{ id: 'g9', groupKey: 'rank1', type: 'ranking', label: '순위' }],
    } as Question;
    act(() => {
      useSurveyBuilderStore.setState((state) => ({
        currentSurvey: { ...state.currentSurvey, questions: [stored] },
      }));
    });
    render(<Harness question={question('radio')} initial={form} />);
    expect(screen.getByText(/답이 문항에 하나/)).toBeInTheDocument();
  });

  it('표 에디터에 폼의 슬라이더 방향을 넘긴다 — 끄면 null 이 간다', () => {
    render(
      <Harness question={question('radio')} initial={tableForm([scaleRow('r1', '추천 의향')])} />,
    );
    expect(screen.getByTestId('table-editor-slider')).toHaveTextContent('positive-right');
    fireEvent.click(sliderSwitch());
    expect(screen.getByTestId('table-editor-slider')).toHaveTextContent('null');
  });
});
