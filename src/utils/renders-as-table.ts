import type { RankingConfig, TableColumn, TableRow } from '@/types/survey';

import { collectChoiceOptCells } from './choice-source';

/**
 * "이 문항이 응답 화면에 표로 그려지는가" 판정에 필요한 최소 형태.
 * Question 전체를 요구하지 않아 스냅샷/부분 객체에도 쓸 수 있다.
 */
export interface TableRenderableQuestion {
  type: string;
  tableColumns?: TableColumn[] | undefined;
  tableRowsData?: TableRow[] | undefined;
  rankingConfig?: RankingConfig | undefined;
}

/**
 * 응답 화면에 표가 그려지는 문항인지.
 * - type='table'
 * - 표-소스 radio/checkbox: choice_opt 셀이 1개 이상 (question-input 의 ChoiceTableResponse 분기와 동일 기준)
 * - 표-소스 ranking: optionsSource='table' + 내장 표(컬럼/행) 존재 (ranking-question 의 hasEmbeddedTable 과 동일 기준)
 *
 * tableColumns 존재만으로 판정하지 않는다. 표로 옵션을 만들다 수동 옵션으로 되돌린 문항에는
 * tableColumns 잔재가 남을 수 있고, 그 문항은 화면에 표가 그려지지 않는다.
 */
export function rendersAsTable(question: TableRenderableQuestion): boolean {
  if (question.type === 'table') return true;

  if (question.type === 'radio' || question.type === 'checkbox') {
    return collectChoiceOptCells(question.tableRowsData).length > 0;
  }

  if (question.type === 'ranking') {
    return (
      question.rankingConfig?.optionsSource === 'table'
      && (question.tableColumns?.length ?? 0) > 0
      && (question.tableRowsData?.length ?? 0) > 0
    );
  }

  return false;
}
