import { describe, expect, it } from 'vitest';
import { VariableMeasure, VariableType } from 'sav-writer';

import { buildCodebookValueLabel } from '@/lib/analytics/raw-export-helpers';
import {
  buildDataRows,
  generateSPSSColumns,
  type SPSSExportColumn,
} from '@/lib/analytics/spss-excel-export';
import { buildValueLabels } from '@/lib/spss/sav-builder';
import { buildLabel, resolveMeasure, resolveVarType } from '@/lib/spss/variable-meta';
import type { Question, SurveySubmission } from '@/types/survey';

function q(overrides: Record<string, unknown>): Question {
  return {
    id: 'q1',
    title: '창업 기업명',
    required: false,
    order: 1,
    questionCode: 'Q1',
    type: 'text',
    ...overrides,
  } as unknown as Question;
}

const priorQuestion = q({});
const plainQuestion = q({ id: 'q2', questionCode: 'Q2', title: '올해 신규 문항' });
const questions = [priorQuestion, plainQuestion];

function columnsWithChangeConfirm(): SPSSExportColumn[] {
  return generateSPSSColumns(questions, { changeConfirmQuestionIds: new Set(['q1']) });
}

function submission(questionResponses: Record<string, unknown>): SurveySubmission {
  return { id: 'r1', surveyId: 's1', questionResponses } as unknown as SurveySubmission;
}

describe('변동 확인 변수 생성', () => {
  it('변동 확인이 붙는 문항마다 대응 변수가 생긴다', () => {
    const col = columnsWithChangeConfirm().find((c) => c.type === 'change-confirm');
    expect(col?.spssVarName).toBe('Q1_CHG');
    expect(col?.questionId).toBe('q1');
  });

  it('변동 확인이 붙지 않는 문항에는 변수가 생기지 않는다', () => {
    const names = columnsWithChangeConfirm()
      .filter((c) => c.type === 'change-confirm')
      .map((c) => c.spssVarName);
    expect(names).toEqual(['Q1_CHG']);
  });

  it('이월 응답이 없는 설문은 이 티켓 전과 완전히 같은 컬럼을 낸다', () => {
    expect(generateSPSSColumns(questions)).toEqual(
      generateSPSSColumns(questions, { changeConfirmQuestionIds: new Set() }),
    );
  });

  it('기존 문항 변수의 이름과 순서가 바뀌지 않는다', () => {
    const before = generateSPSSColumns(questions).map((c) => c.spssVarName);
    const after = columnsWithChangeConfirm()
      .filter((c) => c.type !== 'change-confirm')
      .map((c) => c.spssVarName);
    expect(after).toEqual(before);
  });

  it('문항 변수 바로 뒤에 놓인다 — 코딩북에서 짝이 붙어 읽힌다', () => {
    const names = columnsWithChangeConfirm().map((c) => c.spssVarName);
    expect(names).toEqual(['Q1', 'Q1_CHG', 'Q2']);
  });

  it('한 문항에 변수를 두 번 만들지 않는다', () => {
    // 여러 컬럼을 내는 문항(복수응답 펼침)에서도 _CHG 는 하나여야 한다 —
    // 두 개면 변수명 중복으로 내보내기 전체가 막힌다.
    const checkbox = q({
      id: 'q3',
      questionCode: 'Q3',
      type: 'checkbox',
      options: [
        { id: 'o1', label: '보기1', value: 'o1', spssNumericCode: 1 },
        { id: 'o2', label: '보기2', value: 'o2', spssNumericCode: 2 },
      ],
    });
    const columns = generateSPSSColumns([checkbox], {
      changeConfirmQuestionIds: new Set(['q3']),
    });
    expect(columns.filter((c) => c.type === 'change-confirm')).toHaveLength(1);
  });

  it('안내문과 본문 프리필 템플릿 문항에는 변수를 만들지 않는다', () => {
    // 응답 화면에도 컨트롤이 뜨지 않는 문항들이다 — 규칙이 갈라지면 유령 변수가 된다.
    const notice = q({ id: 'n1', questionCode: 'N1', type: 'notice', requiresAcknowledgment: true });
    const templated = q({ id: 't1', questionCode: 'T1', defaultValueTemplate: '{{회사명}}' });
    const columns = generateSPSSColumns([notice, templated], {
      changeConfirmQuestionIds: new Set(['n1', 't1']),
    });
    expect(columns.filter((c) => c.type === 'change-confirm')).toEqual([]);
  });
});

describe('변동 확인 변수 메타', () => {
  const col = () => columnsWithChangeConfirm().find((c) => c.type === 'change-confirm')!;

  it('숫자형 명목척도다', () => {
    expect(resolveVarType(col(), priorQuestion)).toBe(VariableType.Numeric);
    expect(resolveMeasure(col(), priorQuestion)).toBe(VariableMeasure.Nominal);
  });

  it('변수 라벨이 문항 제목에서 파생된다', () => {
    expect(buildLabel(col())).toBe('창업 기업명 - 변동 확인');
  });

  it('값 라벨이 같음과 달라짐을 구분한다', () => {
    expect(buildValueLabels(col(), priorQuestion)).toEqual([
      { value: 1, label: '지난 회차와 같음' },
      { value: 2, label: '달라짐' },
    ]);
  });

  it('코딩북에 값 라벨과 결측 설명이 함께 나온다', () => {
    const text = buildCodebookValueLabel(col(), new Map([['q1', priorQuestion]]));
    expect(text).toBe('1=지난 회차와 같음, 2=달라짐, 빈값=미확인');
  });

  it('코딩북 셀라벨이 채워져 문항 행과 구분된다', () => {
    // 비어 있으면 Q1 행과 Q1_CHG 행의 설명이 똑같이 보인다.
    expect(col().cellExportLabel).toBe('변동 확인');
  });
});

describe('변동 확인 값 변환', () => {
  function valueFor(questionResponses: Record<string, unknown>): string | number | null {
    const columns = columnsWithChangeConfirm();
    const index = columns.findIndex((c) => c.type === 'change-confirm');
    return buildDataRows(columns, questions, [submission(questionResponses)])[0]![index]!;
  }

  it('"같음"은 1, "달라짐"은 2 로 나간다', () => {
    expect(valueFor({ q1: '작년 답', __changeConfirm__: { q1: 'same' } })).toBe(1);
    expect(valueFor({ q1: '올해 답', __changeConfirm__: { q1: 'changed' } })).toBe(2);
  });

  it('도달하지 못한 문항은 결측이다', () => {
    expect(valueFor({ q2: '올해 답' })).toBeNull();
    expect(valueFor({ __changeConfirm__: {} })).toBeNull();
  });

  it('형태가 깨진 사이드카는 결측으로 흡수한다', () => {
    expect(valueFor({ __changeConfirm__: 'same' })).toBeNull();
    expect(valueFor({ __changeConfirm__: { q1: 'maybe' } })).toBeNull();
  });
});
