import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalizedTextFields } from '@/features/survey-builder/localized-text-fields';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { LocalizedSurveyTexts } from '@/shared/contracts/survey';
import type { Question, QuestionOption } from '@/types/survey';

/**
 * 언어별 설문 글자 입력칸은 그 설문이 제공하는 언어(언어 문항 보기의 언어)만 보인다 —
 * 한·중·영 설문의 빌더에 베트남어 칸이, 한·영·베트남어 설문에 중국어 칸이 끼지 않는다.
 */
function seed(options: QuestionOption[]) {
  const lang = {
    id: 'lang',
    type: 'radio',
    title: '언어',
    required: true,
    order: 0,
    options,
  } as unknown as Question;
  useSurveyBuilderStore.setState((s) => ({
    currentSurvey: { ...s.currentSurvey, questions: [lang], groups: [] },
  }));
}

function renderFields(texts: LocalizedSurveyTexts | null = null) {
  return render(
    <LocalizedTextFields field="title" label="제목" texts={texts} onChange={() => {}} />,
  );
}

describe('LocalizedTextFields — 제공하는 언어의 칸만', () => {
  afterEach(() => cleanup());

  it('한·중·영 설문은 中文·English 칸만 보인다', () => {
    seed([
      { id: 'a', label: '한국어', value: '1', locale: 'ko' },
      { id: 'b', label: '中文', value: '2', locale: 'zh' },
      { id: 'c', label: 'English', value: '3', locale: 'en' },
    ]);
    renderFields();
    expect(screen.getByLabelText('제목 (中文)')).toBeInTheDocument();
    expect(screen.getByLabelText('제목 (English)')).toBeInTheDocument();
    expect(screen.queryByLabelText('제목 (Tiếng Việt)')).toBeNull();
  });

  it('한·영·베트남어 설문은 English·Tiếng Việt 칸만 보인다', () => {
    seed([
      { id: 'a', label: '한국어', value: '1', locale: 'ko' },
      { id: 'b', label: 'English', value: '2', locale: 'en' },
      { id: 'c', label: 'Tiếng Việt', value: '3', locale: 'vi' },
    ]);
    renderFields();
    expect(screen.getByLabelText('제목 (English)')).toBeInTheDocument();
    expect(screen.getByLabelText('제목 (Tiếng Việt)')).toBeInTheDocument();
    expect(screen.queryByLabelText('제목 (中文)')).toBeNull();
  });

  it('이미 글자가 든 언어의 칸은 보기에 그 언어가 없어도 남는다', () => {
    seed([
      { id: 'a', label: '한국어', value: '1', locale: 'ko' },
      { id: 'b', label: 'English', value: '2', locale: 'en' },
    ]);
    renderFields({ zh: { title: '问卷' } });
    expect(screen.getByLabelText('제목 (中文)')).toHaveValue('问卷');
    expect(screen.queryByLabelText('제목 (Tiếng Việt)')).toBeNull();
  });
});
