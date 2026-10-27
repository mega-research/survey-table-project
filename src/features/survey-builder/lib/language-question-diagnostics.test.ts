import { describe, expect, it } from 'vitest';

import type { Question, QuestionOption } from '@/types/survey';

import { diagnoseLanguageQuestion } from './language-question-diagnostics';

/**
 * 언어 문항 빌더 경고 (CONTEXT.md 「언어 문항」) — 배포를 막지 않고 질문 편집 모달이 알린다.
 */

const LANG_OPTIONS: QuestionOption[] = [
  { id: 'o1', label: '한국어', value: '1', locale: 'ko' },
  { id: 'o2', label: '中文', value: '2', locale: 'zh' },
];

const Q = (id: string, order: number, extra: Partial<Question> = {}): Question =>
  ({ id, type: 'radio', title: id, order, required: false, ...extra }) as Question;

describe('diagnoseLanguageQuestion', () => {
  it('첫 페이지에 있는 유일한 언어 문항이면 경고가 없다', () => {
    const questions = [
      Q('lang', 1, { options: LANG_OPTIONS }),
      Q('q2', 2, { pageBreakBefore: true }),
    ];
    expect(diagnoseLanguageQuestion({ questionId: 'lang', questions, groups: [] })).toEqual([]);
  });

  it('언어 보기가 없는 문항은 진단하지 않는다', () => {
    const questions = [Q('q1', 1), Q('q2', 2, { pageBreakBefore: true })];
    expect(diagnoseLanguageQuestion({ questionId: 'q2', questions, groups: [] })).toEqual([]);
  });

  it('앞에 다른 언어 문항이 있으면 이 문항은 쓰이지 않는다고 알린다', () => {
    const questions = [
      Q('first', 1, { options: LANG_OPTIONS }),
      Q('second', 2, { options: LANG_OPTIONS }),
    ];
    expect(diagnoseLanguageQuestion({ questionId: 'second', questions, groups: [] })).toEqual([
      'not-primary',
    ]);
  });

  it('언어 문항이 첫 페이지에 없으면 알린다', () => {
    const questions = [
      Q('intro', 1, { type: 'notice' }),
      Q('lang', 2, { options: LANG_OPTIONS, pageBreakBefore: true }),
    ];
    expect(diagnoseLanguageQuestion({ questionId: 'lang', questions, groups: [] })).toEqual([
      'not-first-page',
    ]);
  });
});
