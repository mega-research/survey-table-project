import { describe, expect, it } from 'vitest';

import { PERSISTED_QUESTION_FIELDS } from '@/db/schema/question-persisted-fields';
import { mapQuestionRow } from '@/data/surveys';

/**
 * 읽기 매퍼 전수 대조 — 쓰기 채널 SSOT(PERSISTED_QUESTION_FIELDS)의 읽기 방향 거울.
 *
 * mapQuestionRow 는 발행 스냅샷과 빌더 로드가 공유하는 유일한 DB행→Question 매퍼인데,
 * 필드를 명시 나열하므로 신규 컬럼 누락이 조용히 값을 떨어뜨린다 — noticeBgColor 가
 * 발행 스냅샷에서 증발해 응답 페이지에만 옛 색이 남던 실사고의 재발 방지망.
 * 모든 영속 필드를 non-null 로 채운 행을 넣고, 매핑 결과에 각 키가 존재해야 한다.
 */

// 각 필드에 매퍼의 != null 가드를 통과하는 최소 유효값을 준다.
const SENTINEL_ROW: Record<string, unknown> = {
  id: 'q1',
  surveyId: 's1',
  createdAt: new Date(),
  updatedAt: new Date(),
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
  tableHeaderGrid: { rows: [] },
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
  hideColumnLabels: true,
  mobileOriginalTable: true,
  mobileTableDisplayMode: 'drilldown',
  mobileDrilldownOmitLeadingColumns: 1,
  mobileDrilldownRepeatHeaderStartRow: 0,
  mobileDrilldownRepeatHeaderEndRow: 0,
  hideTitle: true,
  pageBreakBefore: true,
  rankingConfig: { optionsSource: 'manual', rankCount: 2 },
  choiceGroups: [{ id: 'cg1', groupKey: 'rad1', type: 'radio', label: '그룹' }],
  displayCondition: { logicType: 'AND', conditions: [] },
  questionCode: 'Q1',
  isCustomSpssVarName: true,
  exportLabel: '라벨',
  spssVarType: 'Numeric',
  spssMeasure: 'Nominal',
  exportCellOrder: 'row',
  answerQuoteEnabled: true,
  answerQuoteName: '인용',
  answerQuoteText: '{{Q1}}',
};

describe('mapQuestionRow — 영속 필드 전수 매핑', () => {
  it('PERSISTED_QUESTION_FIELDS 의 모든 필드가 매핑 결과에 존재한다', () => {
    const mapped = mapQuestionRow(SENTINEL_ROW as never) as unknown as Record<string, unknown>;
    const missing = PERSISTED_QUESTION_FIELDS.filter((field) => !(field in mapped));
    expect(missing).toEqual([]);
  });

  it('sentinel 행 자체가 모든 영속 필드를 덮는다 (테스트 자기 검증)', () => {
    const uncovered = PERSISTED_QUESTION_FIELDS.filter(
      (field) => SENTINEL_ROW[field] === undefined || SENTINEL_ROW[field] === null,
    );
    expect(uncovered).toEqual([]);
  });
});
