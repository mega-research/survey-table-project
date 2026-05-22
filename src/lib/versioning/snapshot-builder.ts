/**
 * 설문 스냅샷 빌더
 *
 * 설문 데이터를 불변 스냅샷 구조로 변환하는 순수 함수
 */

import type { Question, QuestionGroup, Survey, SurveyLookup } from '@/types/survey';
import { stripTableRowsData } from '@/utils/table-cell-optimizer';

export interface SurveySnapshot {
  title: string;
  description?: string;
  questions: SnapshotQuestion[];
  groups: SnapshotGroup[];
  settings: {
    isPublic: boolean;
    allowMultipleResponses: boolean;
    showProgressBar: boolean;
    shuffleQuestions: boolean;
    requireLogin: boolean;
    endDate?: string;
    maxResponses?: number;
    thankYouMessage: string;
  };
  // 외부 데이터 LUT 사본 — publish 시점 freeze. 응답 페이지가 분기 조건 우변 룩업을 평가할 때 사용.
  lookups: SurveyLookup[];
}

interface SnapshotQuestion {
  id: string;
  type: string;
  title: string;
  description?: string;
  required: boolean;
  groupId?: string;
  options?: Question['options'];
  selectLevels?: Question['selectLevels'];
  tableTitle?: string;
  tableColumns?: Question['tableColumns'];
  tableRowsData?: Question['tableRowsData'];
  tableHeaderGrid?: Question['tableHeaderGrid'];
  imageUrl?: string;
  videoUrl?: string;
  order: number;
  allowOtherOption?: boolean;
  optionsColumns?: number;
  rankingConfig?: Question['rankingConfig'];
  minSelections?: number;
  maxSelections?: number;
  noticeContent?: string;
  requiresAcknowledgment?: boolean;
  placeholder?: string;
  tableValidationRules?: Question['tableValidationRules'];
  dynamicRowConfigs?: Question['dynamicRowConfigs'];
  hideColumnLabels?: boolean;
  displayCondition?: Question['displayCondition'];
  questionCode?: string;
  defaultValueTemplate?: string | null;
}

interface SnapshotGroup {
  id: string;
  surveyId: string;
  name: string;
  description?: string;
  order: number;
  parentGroupId?: string;
  color?: string;
  collapsed?: boolean;
  displayCondition?: QuestionGroup['displayCondition'];
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
      imageUrl: q.imageUrl,
      videoUrl: q.videoUrl,
      order: q.order,
      allowOtherOption: q.allowOtherOption,
      optionsColumns: q.optionsColumns,
      rankingConfig: q.rankingConfig,
      minSelections: q.minSelections,
      maxSelections: q.maxSelections,
      noticeContent: q.noticeContent,
      requiresAcknowledgment: q.requiresAcknowledgment,
      placeholder: q.placeholder,
      tableValidationRules: q.tableValidationRules,
      dynamicRowConfigs: q.dynamicRowConfigs,
      hideColumnLabels: q.hideColumnLabels,
      displayCondition: q.displayCondition,
      questionCode: q.questionCode,
      defaultValueTemplate: q.defaultValueTemplate,
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
    },
    lookups: survey.lookups ?? [],
  };
}
