/**
 * 설문 스냅샷 빌더
 *
 * 설문 데이터를 불변 스냅샷 구조로 변환하는 순수 함수
 */

import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import type {
  Question,
  QuestionGroup,
  Survey,
  SurveyLookup,
  SurveyResponseHeaderConfig,
} from '@/types/survey';
import { stripTableRowsData } from '@/utils/table-cell-optimizer';

export interface SurveySnapshot {
  title: string;
  description?: string | undefined;
  questions: SnapshotQuestion[];
  groups: SnapshotGroup[];
  settings: {
    isPublic: boolean;
    allowMultipleResponses: boolean;
    showProgressBar: boolean;
    shuffleQuestions: boolean;
    requireLogin: boolean;
    endDate?: string | undefined;
    maxResponses?: number | undefined;
    thankYouMessage: string;
    // 컨택 attrs invite token 강제 — 스냅샷에 freeze (schema-types.ts SurveyVersionSnapshot.settings 와 정렬)
    requireInviteToken?: boolean | undefined;
    responseHeader?: SurveyResponseHeaderConfig | undefined;
  };
  // 외부 데이터 LUT 사본 — publish 시점 freeze. 응답 페이지가 분기 조건 우변 룩업을 평가할 때 사용.
  lookups: SurveyLookup[];
}

interface SnapshotQuestion {
  id: string;
  type: string;
  title: string;
  description?: string | undefined;
  required: boolean;
  groupId?: string | undefined;
  options?: Question['options'] | undefined;
  selectLevels?: Question['selectLevels'] | undefined;
  tableTitle?: string | undefined;
  tableColumns?: Question['tableColumns'] | undefined;
  tableRowsData?: Question['tableRowsData'] | undefined;
  tableHeaderGrid?: Question['tableHeaderGrid'] | undefined;
  order: number;
  allowOtherOption?: boolean | undefined;
  optionsColumns?: number | undefined;
  optionsAlign?: Question['optionsAlign'] | undefined;
  rankingConfig?: Question['rankingConfig'] | undefined;
  choiceGroups?: Question['choiceGroups'] | undefined;
  minSelections?: number | undefined;
  maxSelections?: number | undefined;
  noticeContent?: string | undefined;
  requiresAcknowledgment?: boolean | undefined;
  placeholder?: string | undefined;
  tableValidationRules?: Question['tableValidationRules'] | undefined;
  dynamicRowConfigs?: Question['dynamicRowConfigs'] | undefined;
  hideColumnLabels?: boolean | undefined;
  mobileOriginalTable?: boolean | undefined;
  mobileTableDisplayMode?: MobileTableDisplayMode | undefined;
  mobileDrilldownOmitLeadingColumns?: number | undefined;
  mobileDrilldownRepeatHeaderStartRow?: number | null | undefined;
  mobileDrilldownRepeatHeaderEndRow?: number | null | undefined;
  hideTitle?: boolean | undefined;
  pageBreakBefore?: boolean | undefined;
  displayCondition?: Question['displayCondition'] | undefined;
  questionCode?: string | undefined;
  defaultValueTemplate?: string | null | undefined;
  inputType?: 'text' | 'number' | undefined;
  emptyDefault?: number | undefined;
  piiEncrypted?: boolean | undefined;
  numberFormat?: Question['numberFormat'] | undefined;
  sumConstraints?: Question['sumConstraints'] | undefined;
}

interface SnapshotGroup {
  id: string;
  surveyId: string;
  name: string;
  description?: string | undefined;
  order: number;
  parentGroupId?: string | undefined;
  color?: string | undefined;
  collapsed?: boolean | undefined;
  hideName?: boolean | undefined;
  nameDesign?: QuestionGroup['nameDesign'] | undefined;
  displayCondition?: QuestionGroup['displayCondition'] | undefined;
}

/**
 * Survey 데이터를 불변 스냅샷으로 변환
 *
 * - 런타임 상태(createdAt, updatedAt) 제거
 * - endDate를 ISO string으로 변환
 * - 질문/그룹 순서대로 정렬
 */
export function buildSurveySnapshot(survey: Survey): SurveySnapshot {
  const sortedQuestions = [...(survey.questions || [])].sort((a, b) => a.order - b.order);
  const sortedGroups = [...(survey.groups || [])].sort((a, b) => a.order - b.order);

  return {
    title: survey.title,
    description: survey.description,
    questions: sortedQuestions.map((q) => ({
      id: q.id,
      type: q.type,
      title: q.title,
      description: q.description,
      required: q.required,
      groupId: q.groupId,
      options: q.options,
      selectLevels: q.selectLevels,
      tableTitle: q.tableTitle,
      tableColumns: q.tableColumns,
      tableRowsData: q.type === 'table' && q.tableRowsData
        ? stripTableRowsData(q.tableRowsData)
        : q.tableRowsData,
      tableHeaderGrid: q.tableHeaderGrid,
      order: q.order,
      allowOtherOption: q.allowOtherOption,
      optionsColumns: q.optionsColumns,
      optionsAlign: q.optionsAlign,
      rankingConfig: q.rankingConfig,
      choiceGroups: q.choiceGroups,
      minSelections: q.minSelections,
      maxSelections: q.maxSelections,
      noticeContent: q.noticeContent,
      requiresAcknowledgment: q.requiresAcknowledgment,
      placeholder: q.placeholder,
      tableValidationRules: q.tableValidationRules,
      dynamicRowConfigs: q.dynamicRowConfigs,
      hideColumnLabels: q.hideColumnLabels,
      mobileOriginalTable: q.mobileOriginalTable,
      mobileTableDisplayMode: q.mobileTableDisplayMode,
      mobileDrilldownOmitLeadingColumns: q.mobileDrilldownOmitLeadingColumns,
      mobileDrilldownRepeatHeaderStartRow: q.mobileDrilldownRepeatHeaderStartRow,
      mobileDrilldownRepeatHeaderEndRow: q.mobileDrilldownRepeatHeaderEndRow,
      hideTitle: q.hideTitle,
      pageBreakBefore: q.pageBreakBefore,
      displayCondition: q.displayCondition,
      questionCode: q.questionCode,
      defaultValueTemplate: q.defaultValueTemplate,
      inputType: q.inputType,
      emptyDefault: q.emptyDefault,
      piiEncrypted: q.piiEncrypted,
      numberFormat: q.numberFormat,
      sumConstraints: q.sumConstraints,
    })),
    groups: sortedGroups.map((g) => ({
      id: g.id,
      surveyId: g.surveyId,
      name: g.name,
      description: g.description,
      order: g.order,
      parentGroupId: g.parentGroupId,
      color: g.color,
      collapsed: g.collapsed,
      hideName: g.hideName,
      nameDesign: g.nameDesign,
      displayCondition: g.displayCondition,
    })),
    settings: {
      isPublic: survey.settings.isPublic,
      allowMultipleResponses: survey.settings.allowMultipleResponses,
      showProgressBar: survey.settings.showProgressBar,
      shuffleQuestions: survey.settings.shuffleQuestions,
      requireLogin: survey.settings.requireLogin,
      endDate: survey.settings.endDate
        ? new Date(survey.settings.endDate).toISOString()
        : undefined,
      maxResponses: survey.settings.maxResponses,
      thankYouMessage: survey.settings.thankYouMessage,
      requireInviteToken: survey.settings.requireInviteToken,
      responseHeader: survey.settings.responseHeader,
    },
    lookups: survey.lookups ?? [],
  };
}
