import { useRef, useState } from 'react';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 무거운 자식(TipTap 에디터 / 표 에디터)은 대체한다 — 보려는 것은 문항 설정의 「척도 슬라이더로 그리기」가
// 어느 문항에 보이는지와, 켰을 때 보기 설정(평균에서 제외 · 옵션 배치)이 어떻게 달라지는지다.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => null,
}));
vi.mock('@/features/survey-builder/table-editor/dynamic-table-editor', () => ({
  DynamicTableEditor: () => null,
}));

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
import type { Question } from '@/types/survey';

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

const optionsForm = (extra: Partial<Question> = {}): Partial<Question> => ({
  title: '추천 의향',
  options: [
    { id: 'o1', label: '전혀 없다', value: '1' },
    { id: 'o2', label: '매우 있다', value: '2' },
    { id: 'o9', label: '잘 모르겠다', value: '9' },
  ],
  ...extra,
});

/** 보기를 설명 테이블로 구성한 문항의 폼 — 보기 칸이 이어진 한 행(그룹 없음) */
const tableForm = (extra: Partial<Question> = {}): Partial<Question> => ({
  title: '추천 의향',
  options: [],
  tableColumns: [
    { id: 'c1', label: '항목' },
    { id: 'c2', label: '없다' },
    { id: 'c3', label: '있다' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '추천 의향',
      cells: [
        { id: 'r1-item', type: 'text', content: '추천 의향' },
        { id: 'r1-o1', type: 'choice_opt', content: '①', choiceLabel: '없다' },
        { id: 'r1-o2', type: 'choice_opt', content: '②', choiceLabel: '있다' },
      ],
    },
  ],
  ...extra,
});

const form = () => JSON.parse(screen.getByTestId('form').textContent ?? '{}') as Partial<Question>;
const sliderSwitch = () => screen.queryByRole('switch', { name: '척도 슬라이더로 그리기' });
const layoutNote = () => screen.queryByText(/척도 슬라이더로 그리는 동안/);

describe('QuestionBasicTab — 문항 설정의 「척도 슬라이더로 그리기」', () => {
  afterEach(() => {
    cleanup();
    useSurveyBuilderStore.setState((state) => ({
      currentSurvey: { ...state.currentSurvey, questions: [] },
    }));
  });

  it('보통 라디오 문항(보기 목록)에서 스위치가 보인다', () => {
    render(<Harness question={question('radio')} initial={optionsForm()} />);
    expect(sliderSwitch()).not.toBeNull();
    expect(sliderSwitch()).not.toBeChecked();
  });

  it('체크박스·드롭다운·단답형 문항에는 스위치가 없다', () => {
    for (const type of ['checkbox', 'select', 'text'] as const) {
      render(<Harness question={question(type)} initial={optionsForm()} />);
      expect(sliderSwitch()).toBeNull();
      cleanup();
    }
  });

  it('보기를 설명 테이블로 구성한 라디오 문항도 보기 그룹이 없으면 스위치가 보인다', () => {
    render(<Harness question={question('radio')} initial={tableForm()} />);
    expect(sliderSwitch()).not.toBeNull();
    fireEvent.click(sliderSwitch()!);
    expect(form().scaleSlider).toBe('positive-right');
  });

  it('설명 테이블에 라디오 보기 그룹이 있으면 스위치가 없다 — 그 표는 그룹의 보기 모양으로 켠다', () => {
    render(
      <Harness
        question={question('radio')}
        initial={tableForm({
          choiceGroups: [{ id: 'g1', groupKey: 'rad1', type: 'radio', label: '만족도' }],
        })}
      />,
    );
    expect(sliderSwitch()).toBeNull();
  });

  it('체크박스 보기 그룹만 있어도 스위치가 없다 — 응답 화면이 문항 설정을 읽지 않는 표다', () => {
    render(
      <Harness
        question={question('radio')}
        initial={tableForm({
          choiceGroups: [{ id: 'g1', groupKey: 'chk1', type: 'checkbox', label: '경험' }],
        })}
      />,
    );
    expect(sliderSwitch()).toBeNull();
  });

  it('보기 그룹은 스토어의 값이 먼저다 — 셀 편집이 스토어에만 쓴 그룹이 생기면 스위치가 사라진다', () => {
    const stored = { ...question('radio'), ...tableForm() } as Question;
    useSurveyBuilderStore.setState((state) => ({
      currentSurvey: { ...state.currentSurvey, questions: [stored] },
    }));
    render(<Harness question={question('radio')} initial={tableForm()} />);
    expect(sliderSwitch()).not.toBeNull();

    act(() => {
      useSurveyBuilderStore.setState((state) => ({
        currentSurvey: {
          ...state.currentSurvey,
          questions: [
            {
              ...stored,
              choiceGroups: [{ id: 'g1', groupKey: 'rad1', type: 'radio', label: '만족도' }],
            } as Question,
          ],
        },
      }));
    });
    expect(sliderSwitch()).toBeNull();
  });

  it('설명 테이블로 구성한 체크박스 문항에는 스위치가 없다', () => {
    render(<Harness question={question('checkbox')} initial={tableForm()} />);
    expect(sliderSwitch()).toBeNull();
  });

  it('스위치를 켜고 끄면 폼의 슬라이더 방향이 적히고 지워진다', () => {
    render(<Harness question={question('radio')} initial={optionsForm()} />);
    fireEvent.click(sliderSwitch()!);
    expect(form().scaleSlider).toBe('positive-right');

    fireEvent.click(screen.getByRole('radio', { name: '왼쪽이 긍정' }));
    expect(form().scaleSlider).toBe('positive-left');

    fireEvent.click(sliderSwitch()!);
    expect(form()).toHaveProperty('scaleSlider', null);
  });
});

describe('QuestionBasicTab — 슬라이더를 켠 문항의 「평균에서 제외」', () => {
  afterEach(cleanup);

  it('척도 평균이 꺼져 있어도 슬라이더를 켜면 보기마다 「평균에서 제외」가 보인다', () => {
    render(<Harness question={question('radio')} initial={optionsForm()} />);
    expect(screen.queryAllByLabelText('평균에서 제외')).toHaveLength(0);

    fireEvent.click(sliderSwitch()!);
    expect(screen.getAllByLabelText('평균에서 제외')).toHaveLength(3);
  });

  it('체크한 보기에 표시가 적히고, 슬라이더를 꺼도 그 표시는 지워지지 않는다', () => {
    render(
      <Harness question={question('radio')} initial={optionsForm({ scaleSlider: 'positive-right' })} />,
    );
    fireEvent.click(screen.getAllByLabelText('평균에서 제외')[2]!);
    expect(form().options?.map((option) => option.excludeFromMean)).toEqual([
      undefined,
      undefined,
      true,
    ]);

    fireEvent.click(sliderSwitch()!);
    expect(screen.queryAllByLabelText('평균에서 제외')).toHaveLength(0);
    expect(form().options?.[2]?.excludeFromMean).toBe(true);
  });

  it('척도 평균에 들어간 문항은 슬라이더와 무관하게 지금처럼 보인다', () => {
    render(
      <Harness question={question('radio')} initial={optionsForm({ scaleMeanEnabled: true })} />,
    );
    expect(screen.getAllByLabelText('평균에서 제외')).toHaveLength(3);
  });

  it('체크박스 문항은 방향 값이 실려 와도 「평균에서 제외」가 보이지 않는다', () => {
    render(
      <Harness
        question={question('checkbox')}
        initial={optionsForm({ scaleSlider: 'positive-right' })}
      />,
    );
    expect(screen.queryAllByLabelText('평균에서 제외')).toHaveLength(0);
    expect(layoutNote()).toBeNull();
  });
});

describe('QuestionBasicTab — 슬라이더를 켠 문항의 옵션 배치', () => {
  afterEach(cleanup);

  it('꺼진 문항에는 안내가 없다', () => {
    render(<Harness question={question('radio')} initial={optionsForm({ optionsColumns: 3 })} />);
    expect(layoutNote()).toBeNull();
  });

  it('켠 동안 「슬라이더에서는 쓰이지 않는다」는 안내가 보이고 배치 값은 지워지지 않는다', () => {
    render(
      <Harness
        question={question('radio')}
        initial={optionsForm({ optionsColumns: 3, mobileOptionsColumns: 2 })}
      />,
    );
    fireEvent.click(sliderSwitch()!);
    expect(layoutNote()).not.toBeNull();
    expect(form()).toMatchObject({ optionsColumns: 3, mobileOptionsColumns: 2 });
    expect(screen.getByLabelText('모바일 배치')).toHaveValue('2');

    fireEvent.click(sliderSwitch()!);
    expect(layoutNote()).toBeNull();
    expect(form()).toMatchObject({ optionsColumns: 3, mobileOptionsColumns: 2 });
  });

  it('켠 동안에도 배치는 고칠 수 있다 — 슬라이더로 그릴 수 없는 문항은 이 배치로 그려진다', () => {
    render(
      <Harness
        question={question('radio')}
        initial={optionsForm({ scaleSlider: 'positive-right', mobileOptionsColumns: 2 })}
      />,
    );
    const mobile = screen.getByLabelText('모바일 배치');
    expect(mobile).not.toBeDisabled();
    fireEvent.change(mobile, { target: { value: '1' } });
    expect(form().mobileOptionsColumns).toBe(1);
  });
});
