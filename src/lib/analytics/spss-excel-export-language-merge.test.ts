import { describe, expect, it } from 'vitest';

import { buildMrsetEntries } from '@/lib/spss/mrsets-syntax';
import { assertValidSpssVarNames } from '@/lib/spss/variable-name-guard';
import type { Question, QuestionOption, SurveySubmission } from '@/types/survey';
import type { SurveyLocale } from '@/types/survey-locale';

import { detectSplitCandidates } from './split-export';
import { buildDataRows, generateSPSSColumns } from './spss-excel-export';

/**
 * 공유 변수명 (CONTEXT.md 「공유 변수명」, ADR 0034) — 서로 다른 언어 묶음의 문항이 직접 지정한
 * 같은 변수명을 가지면 내보내기가 한 열로 합친다. 대표는 한국어판, 합칠 수 없는 중복은 그대로 둬서
 * 기존 변수명 검사가 막게 한다.
 */

const OPT = (value: string, label: string): QuestionOption => ({ id: `o-${label}`, label, value });

const radio = (id: string, code: string, labels: string[], order: number): Question => ({
  id,
  type: 'radio',
  title: id,
  required: false,
  order,
  questionCode: code,
  isCustomSpssVarName: true,
  options: labels.map((l, i) => OPT(String(i + 1), l)),
});

const text = (id: string, code: string, order: number): Question => ({
  id,
  type: 'text',
  title: id,
  required: false,
  order,
  questionCode: code,
  isCustomSpssVarName: true,
});

/** 한·중·영 세 묶음 — Q1(단답), Q2(단일선택)는 공유, Q9 는 한국어판에만 */
const QUESTIONS: Question[] = [
  text('ko-q1', 'Q1', 1),
  radio('ko-q2', 'Q2', ['활용함', '활용하지 않음'], 2),
  text('ko-q9', 'Q9', 3),
  text('zh-q1', 'Q1', 11),
  radio('zh-q2', 'Q2', ['是', '否'], 12),
  text('en-q1', 'Q1', 21),
  radio('en-q2', 'Q2', ['Yes', 'No'], 22),
];

const LOCALES = new Map<string, SurveyLocale>([
  ['ko-q1', 'ko'],
  ['ko-q2', 'ko'],
  ['ko-q9', 'ko'],
  ['zh-q1', 'zh'],
  ['zh-q2', 'zh'],
  ['en-q1', 'en'],
  ['en-q2', 'en'],
]);

describe('generateSPSSColumns — 공유 변수명 합치기', () => {
  it('서로 다른 언어 묶음의 같은 변수명은 한국어판 열 하나가 된다', () => {
    const columns = generateSPSSColumns(QUESTIONS, { languageSetLocales: LOCALES });
    expect(columns.map((c) => c.spssVarName)).toEqual(['Q1', 'Q2', 'Q9']);
    expect(columns.map((c) => c.questionId)).toEqual(['ko-q1', 'ko-q2', 'ko-q9']);
    expect(() => assertValidSpssVarNames(columns)).not.toThrow();
  });

  it('언어 묶음 정보가 없으면 지금과 같은 열이 나온다 (합치지 않는다)', () => {
    const withEmpty = generateSPSSColumns(QUESTIONS, { languageSetLocales: new Map() });
    const without = generateSPSSColumns(QUESTIONS);
    expect(withEmpty).toEqual(without);
    expect(without).toHaveLength(7);
  });

  it('같은 언어 묶음 안의 중복은 합치지 않아 변수명 검사가 막는다', () => {
    const questions = [...QUESTIONS, text('ko-q1-dup', 'Q1', 4)];
    const locales = new Map(LOCALES).set('ko-q1-dup', 'ko');
    const columns = generateSPSSColumns(questions, { languageSetLocales: locales });
    expect(columns.filter((c) => c.spssVarName === 'Q1')).toHaveLength(4);
    expect(() => assertValidSpssVarNames(columns)).toThrow();
  });

  it('언어 묶음 밖 문항과의 중복은 합치지 않는다', () => {
    const questions = [...QUESTIONS, text('common-q1', 'Q1', 0)];
    const columns = generateSPSSColumns(questions, { languageSetLocales: LOCALES });
    expect(columns.filter((c) => c.spssVarName === 'Q1').length).toBeGreaterThan(1);
    expect(() => assertValidSpssVarNames(columns)).toThrow();
  });

  it('변수명을 직접 지정하지 않은 문항끼리 우연히 같으면 합치지 않는다', () => {
    const auto = QUESTIONS.map((q) =>
      q.id === 'zh-q1' ? { ...q, isCustomSpssVarName: false } : q,
    );
    const columns = generateSPSSColumns(auto, { languageSetLocales: LOCALES });
    expect(columns.filter((c) => c.spssVarName === 'Q1').length).toBeGreaterThan(1);
    expect(() => assertValidSpssVarNames(columns)).toThrow();
  });

  it('한국어판이 없는 변수는 그 언어판 열이 대표다', () => {
    const questions = [...QUESTIONS, text('zh-q8', 'Q8', 13), text('en-q8', 'Q8', 23)];
    const locales = new Map(LOCALES).set('zh-q8', 'zh').set('en-q8', 'en');
    const columns = generateSPSSColumns(questions, { languageSetLocales: locales });
    expect(columns.find((c) => c.spssVarName === 'Q8')?.questionId).toBe('zh-q8');
  });
});

describe('buildDataRows — 합친 열의 값', () => {
  const sub = (id: string, questionResponses: Record<string, unknown>) =>
    ({ id, surveyId: 's', questionResponses }) as unknown as SurveySubmission;

  it('언어판마다 다른 문항에 답해도 같은 열에 값이 들어간다 (보기 코드는 그 언어판 보기로)', () => {
    const columns = generateSPSSColumns(QUESTIONS, { languageSetLocales: LOCALES });
    const rows = buildDataRows(columns, QUESTIONS, [
      sub('r-ko', { 'ko-q1': '10', 'ko-q2': '1', 'ko-q9': '메모' }),
      sub('r-zh', { 'zh-q1': '20', 'zh-q2': '2' }),
      sub('r-en', { 'en-q1': '30', 'en-q2': '1' }),
    ]);
    expect(rows).toEqual([
      ['10', 1, '메모'],
      ['20', 2, null],
      ['30', 1, null],
    ]);
  });
});

describe('복수응답 세트 — 보기 수가 다른 언어판', () => {
  const checkbox = (id: string, labels: string[], order: number): Question => ({
    id,
    type: 'checkbox',
    title: id,
    required: false,
    order,
    questionCode: 'Q3',
    isCustomSpssVarName: true,
    options: labels.map((l, i) => OPT(String(i + 1), l)),
  });
  const questions = [
    checkbox('ko-q3', ['부스임차', '부스설치'], 1),
    checkbox('zh-q3', ['展位搭建', '展位装修', '运输'], 11),
  ];
  const locales = new Map<string, SurveyLocale>([
    ['ko-q3', 'ko'],
    ['zh-q3', 'zh'],
  ]);

  it('한 언어판에만 있는 보기 열까지 세트 하나로 묶인다 (세트 이름이 겹치지 않는다)', () => {
    const columns = generateSPSSColumns(questions, { languageSetLocales: locales });
    const entries = buildMrsetEntries(columns, questions);
    expect(entries.map((e) => e.name)).toEqual(['Q3']);
    expect(entries[0]?.variables).toEqual(columns.map((c) => c.spssVarName));
    expect(entries[0]?.variables).toHaveLength(3);
  });
});

describe('분할 후보 — 공유 변수명', () => {
  it('공통 시트에 섞인 언어판 문항도 합친 열로 센다', () => {
    const when = (value: string) => ({
      logicType: 'AND' as const,
      conditions: [
        {
          id: `c${value}`,
          sourceQuestionId: 'ko-q2',
          conditionType: 'value-match' as const,
          requiredValues: [value],
          logicType: 'AND' as const,
        },
      ],
    });
    // ko-q2 로 나누면 Q1·Q2 세 언어판은 공통 시트에 함께 남는다
    const questions = [
      ...QUESTIONS.filter((q) => q.id !== 'ko-q9'),
      { ...text('ko-q7', 'Q7', 4), displayCondition: when('1') },
      { ...text('ko-q8', 'Q8', 5), displayCondition: when('2') },
    ];
    const locales = new Map(LOCALES).set('ko-q7', 'ko').set('ko-q8', 'ko');
    const merged = detectSplitCandidates(questions, { languageSetLocales: locales });
    const plain = detectSplitCandidates(questions);
    expect(plain[0]?.maxVars).toBeGreaterThan(merged[0]?.maxVars ?? Infinity);
  });
});
