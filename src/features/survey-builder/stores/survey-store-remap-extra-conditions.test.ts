import { beforeEach, describe, expect, it } from 'vitest';

import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { Question, QuestionConditionGroup, Survey } from '@/types/survey';

/**
 * 문항 표시 조건과 같은 모양의 「다른 자리 조건」도 리매핑한다 (2026-11-06 리뷰 지적).
 * 행 반복 블록 표시 조건(rowRepeatConfig.displayCondition)·펼쳐 둘 조건(expandWhen)·표 제약의 다른 문항
 * 적용 조건(sumConstraints[].whenQuestion). 빠뜨리면 보기 값을 바꾼 뒤 블록이 숨어 그 값이 저장 경계에서 지워지고,
 * 새 문항의 임시 id 를 계속 가리켜 조건이 영영 거짓이 된다.
 */
const cond = (sourceQuestionId: string, value: string): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [{ id: 'c', sourceQuestionId, conditionType: 'value-match', requiredValues: [value], logicType: 'AND' }],
});

function makeSurvey(questions: Question[]): Survey {
  return {
    id: 's',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'token',
    groups: [],
    questions,
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const table = (source: string, value: string): Question =>
  ({
    id: 'q-table',
    type: 'table',
    title: '표',
    required: false,
    order: 2,
    tableRowsData: [],
    rowRepeatConfig: {
      enabled: true,
      templateRowIds: ['tpl'],
      maxRepeats: 3,
      displayCondition: cond(source, value),
      startCollapsed: true,
      expandWhen: cond(source, value),
    },
    sumConstraints: [{ id: 'w', cellIds: [], operator: 'gte', target: 1, whenQuestion: cond(source, value) }],
  }) as Question;

const read = () => useSurveyBuilderStore.getState().currentSurvey.questions.find((q) => q.id === 'q-table')!;

describe('다른 자리 조건 리매핑', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });

  it('보기 value 를 바꾸면 블록 표시·펼쳐 둘·제약 적용 조건의 값도 바뀌고 그 문항이 저장 대상이 된다', () => {
    useSurveyBuilderStore.getState().setSurvey(makeSurvey([table('q-src', 'old')]));
    const scope = useSurveyBuilderStore.getState().remapOptionValueInConditions('q-src', 'old', 'new');
    const q = read();
    expect(q.rowRepeatConfig?.displayCondition?.conditions[0]?.requiredValues).toEqual(['new']);
    expect(q.rowRepeatConfig?.expandWhen?.conditions[0]?.requiredValues).toEqual(['new']);
    expect(q.sumConstraints?.[0]?.whenQuestion?.conditions[0]?.requiredValues).toEqual(['new']);
    expect(scope.questionIds).toContain('q-table');
    expect(useSurveyBuilderStore.getState().questionChanges.updated['q-table']).toBe(true);
  });

  it('새 문항의 임시 id 가 실제 id 로 바뀌면 세 조건의 문항 참조도 바뀐다', () => {
    useSurveyBuilderStore.getState().setSurvey(makeSurvey([table('q-temp', '1')]));
    const scope = useSurveyBuilderStore.getState().remapQuestionRefs('q-temp', 'q-db');
    const q = read();
    expect(q.rowRepeatConfig?.displayCondition?.conditions[0]?.sourceQuestionId).toBe('q-db');
    expect(q.rowRepeatConfig?.expandWhen?.conditions[0]?.sourceQuestionId).toBe('q-db');
    expect(q.sumConstraints?.[0]?.whenQuestion?.conditions[0]?.sourceQuestionId).toBe('q-db');
    expect(scope.questionIds).toContain('q-table');
  });
});

describe('이월값 불러오기 조건 · 동적 행 그룹 표시 조건도 리매핑한다 (2026-11-06 타입 전수 테스트가 찾음)', () => {
  // 둘 다 손으로 나열하던 리매핑 목록에 없었다 — 보기 value 를 바꾸면 이월값을 영영 안 불러오고,
  // 새 문항의 임시 id 를 계속 가리켜 동적 행 고르기 버튼이 영영 숨었다.
  const withPriorAndDynamic = (source: string, value: string): Question =>
    ({
      id: 'q-table',
      type: 'table',
      title: '표',
      required: false,
      order: 2,
      tableRowsData: [],
      priorAnswerCondition: cond(source, value),
      dynamicRowConfigs: [{ groupId: 'g', enabled: true, displayCondition: cond(source, value) }],
    }) as Question;

  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });

  it('보기 value 를 바꾸면 두 조건의 값도 바뀌고 그 문항이 저장 대상이 된다', () => {
    useSurveyBuilderStore.getState().setSurvey(makeSurvey([withPriorAndDynamic('q-src', 'old')]));
    const scope = useSurveyBuilderStore.getState().remapOptionValueInConditions('q-src', 'old', 'new');
    const q = read();
    expect(q.priorAnswerCondition?.conditions[0]?.requiredValues).toEqual(['new']);
    expect(q.dynamicRowConfigs?.[0]?.displayCondition?.conditions[0]?.requiredValues).toEqual(['new']);
    expect(scope.questionIds).toContain('q-table');
    expect(useSurveyBuilderStore.getState().questionChanges.updated['q-table']).toBe(true);
  });

  it('새 문항의 임시 id 가 실제 id 로 바뀌면 두 조건의 문항 참조도 바뀐다', () => {
    useSurveyBuilderStore.getState().setSurvey(makeSurvey([withPriorAndDynamic('q-temp', '1')]));
    const scope = useSurveyBuilderStore.getState().remapQuestionRefs('q-temp', 'q-db');
    const q = read();
    expect(q.priorAnswerCondition?.conditions[0]?.sourceQuestionId).toBe('q-db');
    expect(q.dynamicRowConfigs?.[0]?.displayCondition?.conditions[0]?.sourceQuestionId).toBe('q-db');
    expect(scope.questionIds).toContain('q-table');
  });
});
