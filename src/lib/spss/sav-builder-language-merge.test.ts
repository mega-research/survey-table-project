import { describe, expect, it } from 'vitest';

import { generateSavBuffer } from '@/lib/spss/sav-builder';
import { isSpssVarNameError } from '@/lib/spss/variable-name-guard';
import type { Question, SurveySubmission } from '@/types/survey';
import type { SurveyLocale } from '@/types/survey-locale';

/**
 * .sav 의 공유 변수명 (CONTEXT.md 「공유 변수명」, ADR 0034) — 언어 묶음 정보가 있으면 같은 변수명이
 * 한 변수가 되어 변수명 가드를 통과하고, 없으면 지금처럼 중복으로 막힌다.
 */

const text = (id: string, order: number): Question => ({
  id,
  type: 'text',
  title: id,
  required: false,
  order,
  questionCode: 'Q1',
  isCustomSpssVarName: true,
});

const QUESTIONS = [text('ko-q1', 1), text('zh-q1', 11)];
const LOCALES = new Map<string, SurveyLocale>([
  ['ko-q1', 'ko'],
  ['zh-q1', 'zh'],
]);

const SUBMISSIONS = [
  { id: 'r-ko', questionResponses: { 'ko-q1': '가' } },
  { id: 'r-zh', questionResponses: { 'zh-q1': '甲' } },
].map(
  (s) =>
    ({
      ...s,
      surveyId: 's',
      isCompleted: true,
      startedAt: new Date('2026-10-27T00:00:00Z'),
      updatedAt: new Date('2026-10-27T00:00:00Z'),
    }) as SurveySubmission,
);

describe('generateSavBuffer — 공유 변수명', () => {
  it('언어 묶음 정보가 있으면 같은 변수명이 한 변수로 만들어진다', async () => {
    const buffer = await generateSavBuffer(QUESTIONS, SUBMISSIONS, { languageSetLocales: LOCALES });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('언어 묶음 정보가 없으면 중복 변수명으로 막힌다', async () => {
    const error = await generateSavBuffer(QUESTIONS, SUBMISSIONS).catch((e: unknown) => e);
    expect(isSpssVarNameError(error)).toBe(true);
  });
});
