import { collectSelectedOptionIds } from '@/utils/option-text-migration';
import type { Question, QuestionOption, RankingAnswer, TableCell } from '@/types/survey';
import { collectRankingGroups, isGroupedRankingQuestion } from '@/utils/choice-group-helpers';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { RANKING_OTHER_VALUE, parseRankingAnswers } from '@/utils/ranking-shared';
import { resolveRankingOptions } from '@/utils/ranking-source';

import {
  collectVisibleTableCells as collectNumericVisibleTableCells,
  isRequiredCell,
} from './numeric-validation';
import { optionTextTargetId, rankingTextTargetId } from '@/features/question-renderer/utils/option-text-target';

export interface RequiredOptionTextIssues {
  questionMissing: boolean;
  cellIds: string[];
  /** 실제 상세 입력으로 이동하기 위한 안정 DOM 타깃 ID. 누락이 있을 때만 반환한다. */
  detailTargetIds?: string[];
  /** detailTargetIds를 소유한 테이블 셀. 실제 입력 미렌더 시 셀 폴백에 사용한다. */
  detailCellIds?: string[];
}

export interface RequiredOptionTextValidationContext {
  visibleCellIds?: ReadonlySet<string>;
}


export function collectVisibleTableCells(
  question: Question,
  response: unknown,
  context?: RequiredOptionTextValidationContext,
): TableCell[] {
  const cellValues =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const visible = collectNumericVisibleTableCells(question, cellValues, undefined);
  return context?.visibleCellIds
    ? visible.filter((cell) => context.visibleCellIds?.has(cell.id))
    : visible;
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectMissingSelectedOptionTextTargetIds(
  questionId: string,
  value: unknown,
  options: QuestionOption[],
  optionTexts: Record<string, string> | undefined,
): string[] {
  const selectedIds = collectSelectedOptionIds(value, options);
  return options
    .filter(
      (option) =>
        option.allowTextInput === true &&
        selectedIds.has(option.id) &&
        !hasText(optionTexts?.[option.id]),
    )
    .map((option) => optionTextTargetId(questionId, option.id));
}

function collectMissingSelectedRankingTextTargetIds(
  scopeId: string,
  value: unknown,
  options: QuestionOption[],
): string[] {
  const answers = parseRankingAnswers(value);
  return answers.flatMap((answer) => {
    const targetId = rankingTextTargetId(scopeId, answer.rank, answer.optionValue);
    if (answer.optionValue === RANKING_OTHER_VALUE) {
      return hasText(answer.otherText) ? [] : [targetId];
    }
    const option = options.find((candidate) => candidate.value === answer.optionValue);
    return option?.allowTextInput === true && !hasText(answer.optionText) ? [targetId] : [];
  });
}

function rankingOptions(question: Question): QuestionOption[] {
  const textInputByCellId = new Map(
    (question.tableRowsData ?? [])
      .flatMap((row) => row.cells)
      .map((cell) => [cell.id, cell.allowTextInput] as const),
  );
  return resolveRankingOptions(question).map((option) => {
    const allowTextInput = textInputByCellId.get(option.id) ?? option.allowTextInput;
    return allowTextInput === undefined ? option : { ...option, allowTextInput };
  });
}

function collectMissingQuestionRankingTextTargetIds(question: Question, value: unknown): string[] {
  const options = rankingOptions(question);
  if (!isGroupedRankingQuestion(question)) {
    return collectMissingSelectedRankingTextTargetIds(question.id, value, options);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

  const groupedValue = value as Record<string, unknown>;
  return collectRankingGroups(question).flatMap((group) => {
    const groupOptionIds = new Set(group.cells.map((cell) => cell.id));
    const groupOptions = options.filter((option) => groupOptionIds.has(option.id));
    return collectMissingSelectedRankingTextTargetIds(
      `${question.id}:${group.groupKey}`,
      groupedValue[group.groupKey],
      groupOptions,
    );
  });
}

function cellOptions(cell: TableCell): QuestionOption[] {
  if (cell.type === 'radio') return cell.radioOptions ?? [];
  if (cell.type === 'checkbox') return cell.checkboxOptions ?? [];
  if (cell.type === 'select') return cell.selectOptions ?? [];
  if (cell.type === 'ranking') return cell.rankingOptions ?? [];
  return [];
}

function collectMissingCellOptionTextTargetIds(
  questionId: string,
  cell: TableCell,
  value: unknown,
  optionTexts: Record<string, string> | undefined,
): string[] {
  const options = cellOptions(cell);
  return cell.type === 'ranking'
    ? collectMissingSelectedRankingTextTargetIds(cell.id, value, options)
    : collectMissingSelectedOptionTextTargetIds(questionId, value, options, optionTexts);
}

function tableOptionTextIssues(
  questionId: string,
  question: Question,
  response: Record<string, unknown>,
  optionTexts: Record<string, string> | undefined,
  context: RequiredOptionTextValidationContext | undefined,
): Array<{ cell: TableCell; targetIds: string[] }> {
  return collectVisibleTableCells(question, response, context).map((cell) => {
    const targetIds = collectMissingCellOptionTextTargetIds(
      questionId,
      cell,
      response[cell.id],
      optionTexts,
    );
    return { cell, targetIds };
  });
}

export function collectRequiredOptionTextIssues(
  question: Question,
  response: unknown,
  optionTexts: Record<string, string> | undefined,
  context?: RequiredOptionTextValidationContext,
): RequiredOptionTextIssues {
  const tableResponse =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const resolvedOptionTexts =
    optionTexts ??
    (typeof tableResponse['__optTexts__'] === 'object' && tableResponse['__optTexts__'] !== null
      ? (tableResponse['__optTexts__'] as Record<string, string>)
      : undefined);

  let questionMissing = false;
  let cellIds: string[] = [];
  let detailTargetIds: string[] = [];
  let detailCellIds: string[] = [];

  if (question.type === 'table') {
    const issues = tableOptionTextIssues(
      question.id,
      question,
      tableResponse,
      resolvedOptionTexts,
      context,
    );
    questionMissing =
      question.required === true && issues.some((issue) => issue.targetIds.length > 0);
    cellIds = issues
      .filter((issue) => isRequiredCell(issue.cell) && issue.targetIds.length > 0)
      .map((issue) => issue.cell.id);
    const blockingIssues = issues.filter(
      (issue) =>
        issue.targetIds.length > 0 && (question.required === true || isRequiredCell(issue.cell)),
    );
    detailTargetIds = blockingIssues.flatMap((issue) => issue.targetIds);
    detailCellIds = [...new Set(blockingIssues.map((issue) => issue.cell.id))];
  } else if (question.required === true) {
    if (question.type === 'ranking') {
      detailTargetIds = collectMissingQuestionRankingTextTargetIds(question, response);
    } else if (question.type === 'radio' || question.type === 'checkbox') {
      detailTargetIds = collectMissingSelectedOptionTextTargetIds(
        question.id,
        response,
        resolveChoiceOptions(question),
        resolvedOptionTexts,
      );
    } else if (question.type === 'select') {
      detailTargetIds = collectMissingSelectedOptionTextTargetIds(
        question.id,
        response,
        question.options ?? [],
        resolvedOptionTexts,
      );
    }
    questionMissing = detailTargetIds.length > 0;
  }

  return {
    questionMissing,
    cellIds,
    ...(detailTargetIds.length > 0 ? { detailTargetIds } : {}),
    ...(detailCellIds.length > 0 ? { detailCellIds } : {}),
  };
}

export type { RankingAnswer };
