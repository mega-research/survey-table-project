import { collectSelectedOptionIds } from '@/lib/option-text-migration';
import type { Question, QuestionOption, RankingAnswer, TableCell } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import {
  collectRankingGroups,
  isGroupedRankingQuestion,
} from '@/utils/choice-group-helpers';
import { resolveRankingOptions } from '@/utils/ranking-source';
import { parseRankingAnswers } from '@/utils/ranking-shared';

import { collectVisibleTableCells as collectNumericVisibleTableCells } from './numeric-validation';

export interface RequiredOptionTextIssues {
  questionMissing: boolean;
  cellIds: string[];
}

export interface RequiredOptionTextValidationContext {
  visibleCellIds?: ReadonlySet<string>;
}

type OptionTextsByQuestion = Record<string, Record<string, string>>;

function readOptionTextsRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

/**
 * 저장된 루트 __optTexts__와 현재 Zustand 편집값을 합친 검증용 뷰.
 * 현재 편집값은 빈 문자열도 명시적인 삭제 의사이므로 저장값보다 우선한다.
 */
export function resolveEffectiveOptionTextsByQuestion(
  responses: Record<string, unknown>,
  currentOptionTexts: OptionTextsByQuestion,
): OptionTextsByQuestion {
  const persistedRoot =
    responses['__optTexts__']
    && typeof responses['__optTexts__'] === 'object'
    && !Array.isArray(responses['__optTexts__'])
      ? responses['__optTexts__'] as Record<string, unknown>
      : {};
  const questionIds = new Set([
    ...Object.keys(persistedRoot),
    ...Object.keys(currentOptionTexts),
  ]);
  const effective: OptionTextsByQuestion = {};

  for (const questionId of questionIds) {
    const merged = {
      ...readOptionTextsRecord(persistedRoot[questionId]),
      ...readOptionTextsRecord(currentOptionTexts[questionId]),
    };
    if (Object.keys(merged).length > 0) effective[questionId] = merged;
  }

  return effective;
}

export function collectVisibleTableCells(
  question: Question,
  response: unknown,
  context?: RequiredOptionTextValidationContext,
): TableCell[] {
  const cellValues =
    response && typeof response === 'object' ? response as Record<string, unknown> : {};
  const visible = collectNumericVisibleTableCells(question, cellValues, undefined);
  return context?.visibleCellIds
    ? visible.filter((cell) => context.visibleCellIds?.has(cell.id))
    : visible;
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasMissingSelectedOptionText(
  value: unknown,
  options: QuestionOption[],
  optionTexts: Record<string, string> | undefined,
): boolean {
  const selectedIds = collectSelectedOptionIds(value, options);
  return options.some(
    (option) => option.allowTextInput === true
      && selectedIds.has(option.id)
      && !hasText(optionTexts?.[option.id]),
  );
}

function hasMissingSelectedRankingOptionText(
  value: unknown,
  options: QuestionOption[],
): boolean {
  const answers = parseRankingAnswers(value);
  return answers.some((answer) => {
    const option = options.find((candidate) => candidate.value === answer.optionValue);
    return option?.allowTextInput === true && !hasText(answer.optionText);
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

function hasMissingQuestionRankingOptionText(
  question: Question,
  value: unknown,
): boolean {
  const options = rankingOptions(question);
  if (!isGroupedRankingQuestion(question)) {
    return hasMissingSelectedRankingOptionText(value, options);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const groupedValue = value as Record<string, unknown>;
  return collectRankingGroups(question).some((group) => {
    const groupOptionIds = new Set(group.cells.map((cell) => cell.id));
    const groupOptions = options.filter((option) => groupOptionIds.has(option.id));
    return hasMissingSelectedRankingOptionText(groupedValue[group.groupKey], groupOptions);
  });
}

function cellOptions(cell: TableCell): QuestionOption[] {
  if (cell.type === 'radio') return cell.radioOptions ?? [];
  if (cell.type === 'checkbox') return cell.checkboxOptions ?? [];
  if (cell.type === 'select') return cell.selectOptions ?? [];
  if (cell.type === 'ranking') return cell.rankingOptions ?? [];
  return [];
}

function hasMissingCellOptionText(
  cell: TableCell,
  value: unknown,
  optionTexts: Record<string, string> | undefined,
): boolean {
  const options = cellOptions(cell);
  return cell.type === 'ranking'
    ? hasMissingSelectedRankingOptionText(value, options)
    : hasMissingSelectedOptionText(value, options, optionTexts);
}

function tableOptionTextIssues(
  question: Question,
  response: Record<string, unknown>,
  optionTexts: Record<string, string> | undefined,
  context: RequiredOptionTextValidationContext | undefined,
): Array<{ cell: TableCell; missing: boolean }> {
  return collectVisibleTableCells(question, response, context).map((cell) => ({
    cell,
    missing: hasMissingCellOptionText(cell, response[cell.id], optionTexts),
  }));
}

export function collectRequiredOptionTextIssues(
  question: Question,
  response: unknown,
  optionTexts: Record<string, string> | undefined,
  context?: RequiredOptionTextValidationContext,
): RequiredOptionTextIssues {
  const tableResponse =
    response && typeof response === 'object' ? response as Record<string, unknown> : {};
  const resolvedOptionTexts = optionTexts ?? (
    typeof tableResponse['__optTexts__'] === 'object' && tableResponse['__optTexts__'] !== null
      ? tableResponse['__optTexts__'] as Record<string, string>
      : undefined
  );

  let questionMissing = false;
  let cellIds: string[] = [];

  if (question.type === 'table') {
    const issues = tableOptionTextIssues(question, tableResponse, resolvedOptionTexts, context);
    questionMissing = question.required === true && issues.some((issue) => issue.missing);
    cellIds = issues
      .filter((issue) => issue.cell.required === true && issue.missing)
      .map((issue) => issue.cell.id);
  } else if (question.required === true) {
    if (question.type === 'ranking') {
      questionMissing = hasMissingQuestionRankingOptionText(question, response);
    } else if (question.type === 'radio' || question.type === 'checkbox') {
      questionMissing = hasMissingSelectedOptionText(response, resolveChoiceOptions(question), resolvedOptionTexts);
    } else if (question.type === 'select') {
      questionMissing = hasMissingSelectedOptionText(response, question.options ?? [], resolvedOptionTexts);
    }
  }

  return { questionMissing, cellIds };
}

export type { RankingAnswer };
