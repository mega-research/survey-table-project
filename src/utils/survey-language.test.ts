import { describe, expect, it } from 'vitest';

import type { Question, QuestionCondition, QuestionGroup, QuestionOption } from '@/types/survey';

import {
  findLanguageQuestion,
  resolveCurrentLocale,
  resolveLanguageSetLocales,
} from './survey-language';

/**
 * 다국어 설문의 언어 판정 (CONTEXT.md 「언어 문항」·「언어 묶음」).
 * 언어 문항 = 보기에 locale 이 붙은 radio 문항, 현재 언어 = 고른 보기의 locale.
 */

const OPT = (value: string, extra: Partial<QuestionOption> = {}): QuestionOption => ({
  id: `opt-${value}`,
  label: value,
  value,
  ...extra,
});

const LANG_OPTIONS: QuestionOption[] = [
  OPT('1', { label: '한국어', locale: 'ko' }),
  OPT('2', { label: '中文', locale: 'zh' }),
  OPT('3', { label: 'English', locale: 'en' }),
];

const Q = (id: string, order: number, extra: Partial<Question> = {}): Question =>
  ({ id, type: 'radio', title: id.toUpperCase(), order, required: false, ...extra }) as Question;

describe('findLanguageQuestion', () => {
  it('보기에 언어가 붙은 radio 문항이 없으면 다국어 설문이 아니다', () => {
    const questions = [Q('q1', 1, { options: [OPT('1'), OPT('2')] }), Q('q2', 2, { type: 'text' })];
    expect(findLanguageQuestion(questions, [])).toBeNull();
  });

  it('보기에 언어가 붙은 radio 문항을 언어 문항으로 찾는다', () => {
    const questions = [
      Q('q0', 1, { options: [OPT('1')] }),
      Q('lang', 2, { options: LANG_OPTIONS }),
    ];
    expect(findLanguageQuestion(questions, [])?.id).toBe('lang');
  });

  it('언어 문항이 둘 이상이면 순서상 맨 앞 것을 쓴다', () => {
    const questions = [
      Q('later', 5, { options: LANG_OPTIONS }),
      Q('first', 1, { options: LANG_OPTIONS }),
    ];
    expect(findLanguageQuestion(questions, [])?.id).toBe('first');
  });

  it('맨 앞은 order 값이 아니라 응답 화면에 나오는 순서다 (그룹 순서가 먼저)', () => {
    const groups = [
      { id: 'g-late', surveyId: 's', name: 'late', order: 2 },
      { id: 'g-early', surveyId: 's', name: 'early', order: 1 },
    ];
    const questions = [
      Q('low-order', 1, { options: LANG_OPTIONS, groupId: 'g-late' }),
      Q('high-order', 9, { options: LANG_OPTIONS, groupId: 'g-early' }),
    ];
    expect(findLanguageQuestion(questions, groups)?.id).toBe('high-order');
  });

  it('어휘 밖 언어 값(null·없는 언어)은 언어 보기가 아니다', () => {
    const bogus = [OPT('1', { locale: null as never }), OPT('2', { locale: 'fr' as never })];
    expect(findLanguageQuestion([Q('q', 1, { options: bogus })], [])).toBeNull();
  });

  it('radio 가 아닌 문항의 보기에 언어가 붙어 있어도 언어 문항이 아니다', () => {
    const questions = [Q('cb', 1, { type: 'checkbox', options: LANG_OPTIONS })];
    expect(findLanguageQuestion(questions, [])).toBeNull();
  });
});

describe('resolveCurrentLocale', () => {
  const questions = [Q('lang', 1, { options: LANG_OPTIONS }), Q('q1', 2, { type: 'text' })];

  it('다국어 설문이 아니면 늘 한국어다', () => {
    expect(resolveCurrentLocale([Q('q1', 1, { type: 'text' })], [], {})).toBe('ko');
  });

  it('언어 문항에 아직 답이 없으면 미정(null)이다', () => {
    expect(resolveCurrentLocale(questions, [], {})).toBeNull();
    expect(resolveCurrentLocale(questions, [], { lang: '' })).toBeNull();
  });

  it('고른 보기의 언어가 현재 언어다', () => {
    expect(resolveCurrentLocale(questions, [], { lang: '2' })).toBe('zh');
    expect(resolveCurrentLocale(questions, [], { lang: '3' })).toBe('en');
  });

  it('언어가 붙지 않은 보기를 고르면 미정이다', () => {
    const mixed = [Q('lang', 1, { options: [...LANG_OPTIONS, OPT('9', { label: '기타' })] })];
    expect(resolveCurrentLocale(mixed, [], { lang: '9' })).toBeNull();
  });

  it('보기 id 로 저장된 응답도 읽는다', () => {
    expect(resolveCurrentLocale(questions, [], { lang: 'opt-2' })).toBe('zh');
  });
});

describe('resolveLanguageSetLocales', () => {
  const langMatch = (
    values: string[],
    extra: Partial<QuestionCondition> = {},
  ): QuestionCondition => ({
    id: `c-${values.join('-')}`,
    sourceQuestionId: 'lang',
    conditionType: 'value-match',
    requiredValues: values,
    logicType: 'AND',
    ...extra,
  });
  const G = (id: string, extra: Partial<QuestionGroup> = {}): QuestionGroup => ({
    id,
    surveyId: 's',
    name: id,
    order: 1,
    ...extra,
  });
  const lang = Q('lang', 0, { options: LANG_OPTIONS });

  it('표시 조건이 「언어 문항 = 한 언어」 하나뿐인 그룹의 문항은 그 언어 묶음이다', () => {
    const groups = [
      G('ko', { displayCondition: { conditions: [langMatch(['1'])], logicType: 'AND' } }),
      G('zh', { displayCondition: { conditions: [langMatch(['2'])], logicType: 'AND' } }),
    ];
    const questions = [lang, Q('k1', 1, { groupId: 'ko' }), Q('z1', 2, { groupId: 'zh' })];
    const result = resolveLanguageSetLocales(questions, groups);
    expect(result.get('k1')).toBe('ko');
    expect(result.get('z1')).toBe('zh');
    expect(result.has('lang')).toBe(false);
  });

  it('하위 그룹의 문항은 언어 묶음인 상위 그룹의 언어를 물려받는다', () => {
    const groups = [
      G('en', { displayCondition: { conditions: [langMatch(['3'])], logicType: 'AND' } }),
      G('en-sub', { parentGroupId: 'en' }),
    ];
    const questions = [lang, Q('e1', 1, { groupId: 'en-sub' })];
    expect(resolveLanguageSetLocales(questions, groups).get('e1')).toBe('en');
  });

  it('조건이 다른 것과 섞이거나 두 언어를 함께 받으면 언어 묶음이 아니다', () => {
    const other: QuestionCondition = { ...langMatch(['1']), sourceQuestionId: 'q9' };
    const groups = [
      G('mixed', { displayCondition: { conditions: [langMatch(['1']), other], logicType: 'AND' } }),
      G('both', { displayCondition: { conditions: [langMatch(['2', '3'])], logicType: 'AND' } }),
      G('plain'),
    ];
    const questions = [
      lang,
      Q('m1', 1, { groupId: 'mixed' }),
      Q('b1', 2, { groupId: 'both' }),
      Q('p1', 3, { groupId: 'plain' }),
      Q('n1', 4),
    ];
    expect(resolveLanguageSetLocales(questions, groups).size).toBe(0);
  });

  it('NOT 으로 묶인 조건은 그 언어가 아닌 응답자에게 보이므로 언어 묶음이 아니다', () => {
    const groups = [
      G('not-ko', { displayCondition: { conditions: [langMatch(['1'])], logicType: 'NOT' } }),
    ];
    expect(resolveLanguageSetLocales([lang, Q('n1', 1, { groupId: 'not-ko' })], groups).size).toBe(
      0,
    );
  });

  it('조건 하나에 NOT 이 붙어도 언어 묶음이 아니다', () => {
    const groups = [
      G('not-zh', {
        displayCondition: { conditions: [langMatch(['2'], { logicType: 'NOT' })], logicType: 'AND' },
      }),
    ];
    expect(resolveLanguageSetLocales([lang, Q('n1', 1, { groupId: 'not-zh' })], groups).size).toBe(0);
  });

  it('꺼 둔 조건은 세지 않는다', () => {
    const disabled = { ...langMatch(['2']), sourceQuestionId: 'q9', enabled: false };
    const groups = [
      G('ko', { displayCondition: { conditions: [langMatch(['1']), disabled], logicType: 'AND' } }),
    ];
    expect(resolveLanguageSetLocales([lang, Q('k1', 1, { groupId: 'ko' })], groups).get('k1')).toBe(
      'ko',
    );
  });

  it('다국어 설문이 아니면 빈 결과다', () => {
    const groups = [
      G('g', { displayCondition: { conditions: [langMatch(['1'])], logicType: 'AND' } }),
    ];
    expect(resolveLanguageSetLocales([Q('x', 1, { groupId: 'g' })], groups).size).toBe(0);
  });
});
