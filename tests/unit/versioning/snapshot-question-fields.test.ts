import { describe, expect, it } from 'vitest';

import { buildSurveySnapshot } from '@/lib/versioning/snapshot-builder';
import { PERSISTED_QUESTION_FIELDS } from '@/db/schema/question-persisted-fields';
import type { Question } from '@/types/survey';

/**
 * 발행 스냅샷 전수 대조 — `mapQuestionRow` 와 나란한 **두 번째 읽기 경로**의 그물.
 *
 * 스냅샷 빌더도 필드를 명시 나열하므로 신규 컬럼이 조용히 빠진다. `mapQuestionRow` 만
 * 채우고 여기를 빠뜨리면 빌더에는 값이 보이는데 발행하면 증발한다 — `priorAnswerDisabled`
 * 가 실제로 그렇게 새어 나갔다(2026-09-08: 「이월값 불러오기」를 꺼도 응답 화면은 계속
 * 이월값을 채웠다). 읽기 경로가 둘이라 `map-question-row.test.ts` 만으로는 못 막는다.
 *
 * 스냅샷이 **의도적으로** 담지 않는 필드는 아래 목록에 사유와 함께 등재한다.
 */
const INTENTIONALLY_OMITTED: ReadonlySet<string> = new Set([
  // export 계열은 라이브 설정을 본다 — 내보내기 시점의 코딩북 규칙이 최신이어야 한다.
  'isCustomSpssVarName',
  'spssVarType',
  'spssMeasure',
  'exportCellOrder',
  // 응답 인용 문구는 응답 화면이 라이브 질문에서 읽는다.
  'answerQuoteEnabled',
  'answerQuoteName',
  'answerQuoteText',
  // 표 헤더 격자는 tableColumns/tableRowsData 에서 파생한다.
  'tableHeaderGrid',
  // 응답값 암호화는 저장 경계(라이브 질문)가 판정한다.
  'piiEncrypted',
]);

/** 각 필드에 non-null 최소값을 준 질문 하나. */
const SENTINEL = {
  id: 'q1',
  surveyId: 's1',
  groupId: 'g1',
  type: 'radio',
  title: '질문',
  description: '설명',
  required: true,
  requiredMessage: '답해주세요.',
  order: 1,
  options: [{ id: 'o1', label: '보기 1' }],
  selectLevels: [{ id: 'l1', label: '레벨', options: [] }],
  tableTitle: '표 제목',
  tableColumns: [{ id: 'c1', label: '열' }],
  tableRowsData: [{ id: 'r1', label: '', cells: [] }],
  tableHeaderGrid: [[]],
  allowOtherOption: true,
  optionsColumns: 2,
  optionsAlign: 'left',
  mobileOptionsColumns: 1,
  minSelections: 1,
  maxSelections: 3,
  noticeContent: '<p>공지</p>',
  noticeBgColor: 'none',
  requiresAcknowledgment: true,
  placeholder: '입력',
  defaultValueTemplate: '{{name}}',
  inputType: 'number',
  emptyDefault: 0,
  numberFormat: { thousands: true },
  piiEncrypted: true,
  tableValidationRules: [],
  sumConstraints: [],
  dynamicRowConfigs: [],
  rowRepeatConfig: { enabled: true, templateRowIds: ['r1'], maxRepeats: 20 },
  hideColumnLabels: true,
  mobileOriginalTable: true,
  mobileTableDisplayMode: 'drilldown',
  mobileDrilldownOmitLeadingColumns: 1,
  mobileDrilldownRepeatHeaderStartRow: 0,
  mobileDrilldownRepeatHeaderEndRow: 0,
  hideTitle: true,
  pageBreakBefore: true,
  rankingConfig: { optionsSource: 'manual', positions: 2 },
  choiceGroups: [{ id: 'cg1', groupKey: 'rad1', type: 'radio', label: '그룹' }],
  displayCondition: { logicType: 'AND', conditions: [] },
  priorAnswerCondition: { logicType: 'AND', conditions: [] },
  priorAnswerDisabled: true,
  questionCode: 'Q1',
  isCustomSpssVarName: true,
  exportLabel: '라벨',
  spssVarType: 'Numeric',
  spssMeasure: 'Nominal',
  exportCellOrder: 'row',
  answerQuoteEnabled: true,
  answerQuoteName: '인용',
  answerQuoteText: '{{Q1}}',
} as unknown as Question;

describe('발행 스냅샷 — 영속 필드 전수 대조', () => {
  it('스냅샷이 담아야 할 영속 필드가 결과에 존재한다', () => {
    const snapshot = buildSurveySnapshot({
      id: 's1',
      title: '설문',
      questions: [SENTINEL],
      groups: [],
      settings: { isPublic: true, allowMultipleResponses: false, showProgressBar: true },
      lookups: [],
    } as never);

    const question = snapshot.questions[0] as unknown as Record<string, unknown>;
    const missing = PERSISTED_QUESTION_FIELDS.filter(
      (field) => !INTENTIONALLY_OMITTED.has(field) && question[field] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it('sentinel 이 모든 영속 필드를 덮는다 (테스트 자기 검증)', () => {
    const row = SENTINEL as unknown as Record<string, unknown>;
    const uncovered = PERSISTED_QUESTION_FIELDS.filter((field) => row[field] == null);
    expect(uncovered).toEqual([]);
  });
});
