import { type Dispatch, type SetStateAction, useState } from 'react';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createQuestionMock = vi.hoisted(() => vi.fn());
const updateQuestionMock = vi.hoisted(() => vi.fn());

/**
 * 문항 편집 모달의 이중 상태(폼 값 ↔ 스토어)에서 문항의 슬라이더 방향이 초기화 · 취소 복원 · 저장에 모두
 * 실리는지 본다(반복 손실 사고가 있던 자리). 기본 탭은 무거워 비우되, **실제 스위치 조각**을 모달의 폼 값에
 * 그대로 이어 붙인다 — 스위치가 기본 탭의 어디에 보이는지는 question-basic-tab-scale-slider 테스트가 본다.
 */
vi.mock('@/features/survey-builder/question-edit/question-basic-tab', async () => {
  const { QuestionScaleSliderFields } = await import(
    '@/features/survey-builder/question-edit/question-scale-slider-fields'
  );
  return {
    QuestionBasicTab: ({
      formData,
      setFormData,
    }: {
      formData: Partial<Question>;
      setFormData: Dispatch<SetStateAction<Partial<Question>>>;
    }) => <QuestionScaleSliderFields formData={formData} setFormData={setFormData} />,
  };
});
vi.mock('@/features/survey-builder/condition/question-condition-editor', () => ({
  QuestionConditionEditor: () => null,
}));
vi.mock('@/features/survey-builder/question-edit/table-validation-editor', () => ({
  TableValidationEditor: () => null,
}));
vi.mock('@/features/survey-builder/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/features/survey-builder/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: {
        create: createQuestionMock,
        update: updateQuestionMock,
      },
    },
  },
}));
vi.mock('@/lib/image-extractor', () => ({ extractImageUrlsFromQuestion: () => [] }));
vi.mock('@/shared/lib/image-utils', () => ({ deleteImagesFromR2: async () => {} }));

import { QuestionEditModal } from '@/features/survey-builder/question-edit/question-edit-modal';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { Question } from '@/types/survey';

function radioQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '문 5. 추천 의향',
    required: true,
    order: 1,
    options: [
      { id: 'o1', label: '전혀 추천하지 않는다', value: '1' },
      { id: 'o2', label: '보통이다', value: '2' },
      { id: 'o3', label: '매우 추천한다', value: '3' },
    ],
    ...overrides,
  } as unknown as Question;
}

function seed(question: Question, opts: { added: boolean } = { added: false }) {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [question],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (opts.added) {
    useSurveyBuilderStore.setState((state) => ({
      ...state,
      questionChanges: { ...state.questionChanges, added: { q1: true } },
    }));
  }
}

/** 모달을 닫았다 다시 열 수 있는 자리 — 저장·취소 뒤의 다시 열기를 본다 */
function ModalHost() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        다시 열기
      </button>
      <QuestionEditModal questionId="q1" isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

const storeDirection = () =>
  useSurveyBuilderStore.getState().currentSurvey.questions.find((q) => q.id === 'q1')?.scaleSlider;
const sliderSwitch = () => screen.getByRole('switch', { name: '척도 슬라이더로 그리기' });
const updateData = (call = 0) =>
  updateQuestionMock.mock.calls[call]![0].data as Partial<Question>;
const save = () => fireEvent.click(screen.getByRole('button', { name: '저장' }));
const closed = () => waitFor(() => expect(screen.queryByRole('switch')).toBeNull());

describe('QuestionEditModal — 「척도 슬라이더로 그리기」 스위치의 폼 왕복', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    createQuestionMock.mockResolvedValue({ id: 'q1' });
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('켜진 문항을 열면 스위치가 켜져 있고 저장본의 방향이 골라져 있다', () => {
    seed(radioQuestion({ scaleSlider: 'positive-left' }));
    render(<ModalHost />);
    expect(sliderSwitch()).toBeChecked();
    expect(screen.getByRole('radio', { name: '왼쪽이 긍정' })).toBeChecked();
  });

  it('꺼진 문항을 열면 스위치가 꺼져 있다 — 빌더가 끈 null 도', () => {
    seed(radioQuestion({ scaleSlider: null }));
    render(<ModalHost />);
    expect(sliderSwitch()).not.toBeChecked();
  });

  it('켜고 저장하면 방향이 수정 요청과 스토어에 적힌다', async () => {
    seed(radioQuestion());
    render(<ModalHost />);
    fireEvent.click(sliderSwitch());
    save();

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateData().scaleSlider).toBe('positive-right');
    expect(storeDirection()).toBe('positive-right');
  });

  it('방향을 바꿔 저장하면 바꾼 방향이 적힌다', async () => {
    seed(radioQuestion({ scaleSlider: 'positive-right' }));
    render(<ModalHost />);
    fireEvent.click(screen.getByRole('radio', { name: '왼쪽이 긍정' }));
    save();

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateData().scaleSlider).toBe('positive-left');
    expect(storeDirection()).toBe('positive-left');
  });

  it('끄고 저장하면 null 이 실린다 — 키가 빠지면 서버가 방향을 그대로 둔다', async () => {
    seed(radioQuestion({ scaleSlider: 'positive-left' }));
    render(<ModalHost />);
    fireEvent.click(sliderSwitch());
    save();

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateData()).toHaveProperty('scaleSlider', null);
    expect(storeDirection()).toBeNull();
  });

  it('켜고 취소하면 저장되지 않고, 다시 열면 원래대로 꺼져 있다', async () => {
    seed(radioQuestion());
    render(<ModalHost />);
    fireEvent.click(sliderSwitch());
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await closed();

    expect(updateQuestionMock).not.toHaveBeenCalled();
    expect(storeDirection()).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: '다시 열기' }));
    expect(sliderSwitch()).not.toBeChecked();
  });

  it('방향을 바꾸고 취소하면 다시 열었을 때 저장본의 방향이다', async () => {
    seed(radioQuestion({ scaleSlider: 'positive-left' }));
    render(<ModalHost />);
    fireEvent.click(screen.getByRole('radio', { name: '오른쪽이 긍정' }));
    fireEvent.click(sliderSwitch());
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await closed();

    expect(storeDirection()).toBe('positive-left');
    fireEvent.click(screen.getByRole('button', { name: '다시 열기' }));
    expect(sliderSwitch()).toBeChecked();
    expect(screen.getByRole('radio', { name: '왼쪽이 긍정' })).toBeChecked();
  });

  it('저장 뒤 다시 열면 같은 값이다 — 켠 것도, 끈 것도', async () => {
    seed(radioQuestion());
    render(<ModalHost />);
    fireEvent.click(sliderSwitch());
    fireEvent.click(screen.getByRole('radio', { name: '왼쪽이 긍정' }));
    save();
    await closed();

    fireEvent.click(screen.getByRole('button', { name: '다시 열기' }));
    expect(sliderSwitch()).toBeChecked();
    expect(screen.getByRole('radio', { name: '왼쪽이 긍정' })).toBeChecked();

    fireEvent.click(sliderSwitch());
    save();
    await closed();
    expect(updateData(1)).toHaveProperty('scaleSlider', null);

    fireEvent.click(screen.getByRole('button', { name: '다시 열기' }));
    expect(sliderSwitch()).not.toBeChecked();
  });

  it('끈 뒤 다른 것만 고쳐 다시 저장해도 방향이 되살아나지 않는다', async () => {
    seed(radioQuestion({ scaleSlider: 'positive-right' }));
    render(<ModalHost />);
    fireEvent.click(sliderSwitch());
    save();
    await closed();

    fireEvent.click(screen.getByRole('button', { name: '다시 열기' }));
    save();
    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalledTimes(2));
    expect(updateData(1).scaleSlider ?? null).toBeNull();
    expect(storeDirection() ?? null).toBeNull();
  });

  it('아직 저장되지 않은 문항에서 켜면 CREATE 에 방향이, 끄면 null 이 실린다', async () => {
    seed(radioQuestion(), { added: true });
    const first = render(<ModalHost />);
    fireEvent.click(sliderSwitch());
    save();
    await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
    expect(createQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({ scaleSlider: 'positive-right' }),
    );
    first.unmount();
    createQuestionMock.mockClear();

    useSurveyBuilderStore.getState().resetSurvey();
    seed(radioQuestion({ scaleSlider: 'positive-left' }), { added: true });
    render(<ModalHost />);
    fireEvent.click(sliderSwitch());
    save();
    await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
    expect(createQuestionMock.mock.calls[0]![0]).toHaveProperty('scaleSlider', null);
  });
});
