import { describe, expect, it } from 'vitest';

import type { LocalizedSurveyTexts } from '@/shared/contracts/survey';

import {
  pickLocalizedText,
  resolveHeaderDescriptions,
  resolveHeaderTitle,
} from './localized-survey-texts';

/**
 * 언어별 설문 글자 (CONTEXT.md 「다국어 설문」) — 현재 언어의 글자를 고르고 비면 한국어로 폴백한다.
 * 언어가 정해지기 전(미정)에는 머리 제목을 등록된 언어마다 한 줄씩 쌓는다.
 */

const LOCALIZED: LocalizedSurveyTexts = {
  zh: { title: '绩效评估调查', thankYou: '非常感谢您参与本次问卷调查。', description: '   ' },
  en: { title: 'Performance Evaluation Survey' },
};

describe('pickLocalizedText', () => {
  it('한국어(또는 미정)는 기존 칸 그대로다', () => {
    expect(pickLocalizedText('한국어 제목', LOCALIZED, 'ko', 'title')).toBe('한국어 제목');
    expect(pickLocalizedText('한국어 제목', LOCALIZED, null, 'title')).toBe('한국어 제목');
  });

  it('다른 언어는 그 언어 글자를 쓴다', () => {
    expect(pickLocalizedText('한국어 제목', LOCALIZED, 'zh', 'title')).toBe('绩效评估调查');
    expect(pickLocalizedText('감사합니다', LOCALIZED, 'zh', 'thankYou')).toBe(
      '非常感谢您参与本次问卷调查。',
    );
  });

  it('그 언어 칸이 없거나 공백뿐이면 한국어로 폴백한다', () => {
    expect(pickLocalizedText('감사합니다', LOCALIZED, 'en', 'thankYou')).toBe('감사합니다');
    expect(pickLocalizedText('설명', LOCALIZED, 'zh', 'description')).toBe('설명');
    expect(pickLocalizedText('설명', null, 'zh', 'description')).toBe('설명');
  });
});

describe('resolveHeaderTitle', () => {
  it('언어가 정해지면 그 언어 제목 하나다', () => {
    expect(resolveHeaderTitle('한국어 제목', LOCALIZED, 'en')).toBe(
      'Performance Evaluation Survey',
    );
  });

  it('미정이면 등록된 제목을 한국어 · 中文 · English 순으로 한 줄씩 쌓는다', () => {
    expect(resolveHeaderTitle('한국어 제목', LOCALIZED, null)).toBe(
      '한국어 제목\n绩效评估调查\nPerformance Evaluation Survey',
    );
  });

  it('미정이어도 다른 언어 제목이 없으면 한국어 제목 하나다', () => {
    expect(resolveHeaderTitle('한국어 제목', { zh: { thankYou: 'x' } }, null)).toBe('한국어 제목');
  });
});

describe('resolveHeaderTitle — 같은 제목', () => {
  it('미정일 때 다른 언어 제목이 한국어와 같으면 한 번만 쌓는다', () => {
    expect(
      resolveHeaderTitle('Expo 2026', { zh: { title: 'Expo 2026' }, en: { title: 'Expo' } }, null),
    ).toBe('Expo 2026\nExpo');
  });
});

describe('resolveHeaderDescriptions', () => {
  const localized: LocalizedSurveyTexts = {
    zh: { description: '中文说明' },
    en: { description: 'English description' },
  };

  it('언어가 정해지면 그 언어 설명 하나다 (없으면 한국어)', () => {
    expect(resolveHeaderDescriptions('한국어 설명', localized, 'zh')).toEqual(['中文说明']);
    expect(resolveHeaderDescriptions('한국어 설명', { zh: {} }, 'zh')).toEqual(['한국어 설명']);
  });

  it('미정이면 등록된 설명을 언어 순서대로 문단마다 하나씩 보인다', () => {
    expect(resolveHeaderDescriptions('한국어 설명', localized, null)).toEqual([
      '한국어 설명',
      '中文说明',
      'English description',
    ]);
  });

  it('설명이 하나도 없으면 빈 목록이다', () => {
    expect(resolveHeaderDescriptions('', null, null)).toEqual([]);
    expect(resolveHeaderDescriptions('', null, 'ko')).toEqual([]);
  });
});
