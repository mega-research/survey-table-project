import {
  BranchRule,
  DynamicRowGroupConfig,
  ConditionLogicType,
  ExpressionClause,
  ExpressionComparison,
  ExpressionConditionConfig,
  ExpressionOperand,
  NumericComparison,
  Question,
  QuestionCondition,
  QuestionGroup,
  TableColumn,
  TableRow,
  TableValidationRule,
} from '@/types/survey';
import { evaluateRightOperand } from '@/lib/lookup/evaluate-lookup';
import { resolveStepBranch, type RenderStep } from '@/lib/group-ordering';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { isGroupedChoiceQuestion } from '@/utils/choice-group-helpers';
import { emptyBranchEvalCtx, type BranchEvalCtx } from '@/utils/branch-eval';
import {
  collectAnsweredRows,
  collectMatchedRows,
  collectSelectedValues,
  quantifyRows,
  someRowMatches,
} from '@/utils/table-cell-semantics';

// BranchEvalCtx / emptyBranchEvalCtx / evaluateNumericComparisonV2 는 branch-eval.ts 로 이동
// (table-cell-semantics 와의 순환 import 차단). 기존 import 사이트 호환을 위해 re-export 한다.
export { evaluateNumericComparisonV2, type BranchEvalCtx } from '@/utils/branch-eval';

/**
 * 질문과 응답을 기반으로 적용할 분기 규칙을 찾습니다
 */
export function getBranchRuleForResponse(question: Question, response: unknown): BranchRule | null {
  if (!response) return null;

  // 테이블 질문인 경우 먼저 검증 규칙 확인
  if (question.type === 'table') {
    const validationRule = getTableValidationBranchRule(question, response);
    if (validationRule) {
      return validationRule;
    }
  }

  switch (question.type) {
    case 'radio':
      return getBranchRuleForRadio(question, response);
    case 'checkbox':
      return getBranchRuleForCheckbox(question, response);
    case 'select':
      return getBranchRuleForSelect(question, response);
    case 'table':
      return getBranchRuleForTable(question, response);
    case 'ranking':
      return getBranchRuleForRanking(question, response);
    default:
      return null;
  }
}

/**
 * 순위형(ranking) 응답의 분기 규칙 찾기.
 * - rankingConfig.branchRankPosition (기본 1) 에 해당하는 순위의 optionValue 를 찾음
 * - 그 옵션의 branchRule 반환 (기타/orphan 은 null)
 * - Case 2 는 optionValue 가 cell.id 이므로 question.options 로는 찾지 못함 → 현재는 Case 1 만 지원
 */
function getBranchRuleForRanking(question: Question, response: unknown): BranchRule | null {
  if (!Array.isArray(response)) return null;
  if (!question.options || question.options.length === 0) return null;

  const branchRank = question.rankingConfig?.branchRankPosition ?? 1;
  const entry = (response as Array<{ rank?: unknown; optionValue?: unknown }>).find(
    (a) =>
      !!a
      && typeof a === 'object'
      && a.rank === branchRank
      && typeof a.optionValue === 'string',
  );
  if (!entry || typeof entry.optionValue !== 'string') return null;

  // Case 2 (optionsSource='table') 는 optionValue 가 cell.id 라 question.options 와 매칭 안됨 → 미지원
  if (question.rankingConfig?.optionsSource === 'table') return null;

  const selected = question.options.find((opt) => opt.value === entry.optionValue);
  return selected?.branchRule ?? null;
}

/**
 * 라디오 버튼 응답의 분기 규칙 찾기.
 * 그룹별 선택(GroupedChoiceAnswer) 응답 맵도 지원한다.
 * 맵의 경우 선택된 모든 cell.id 중 branchRule 이 있는 첫 번째 옵션을 반환한다.
 */
function getBranchRuleForRadio(question: Question, response: unknown): BranchRule | null {
  // manual: question.options 그대로 / table-source: choice_opt 셀에서 변환된 옵션
  const options = resolveChoiceOptions(question);
  if (!options.length) return null;

  // 그룹별 선택 모드: 응답 맵의 값들을 flat 해서 선택된 모든 cell.id 를 추출.
  // radio 그룹 값 = string, checkbox 그룹 값 = string[] — .flat() 으로 통합.
  if (
    isGroupedChoiceQuestion(question) &&
    typeof response === 'object' &&
    response !== null &&
    !Array.isArray(response)
  ) {
    const selectedValues = Object.values(response as Record<string, string | string[]>)
      .flatMap((v): string[] => {
        if (typeof v === 'string' && v !== '') return [v];
        if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string');
        return [];
      });
    const selectedOption = options.find(
      (opt) => selectedValues.includes(opt.value as string) && opt.branchRule,
    );
    return selectedOption?.branchRule ?? null;
  }

  // 응답이 객체인 경우 (기타 옵션)
  const selectedValue =
    typeof response === 'object' && response !== null && 'selectedValue' in response
      ? (response as { selectedValue: string }).selectedValue
      : response;

  // 선택된 값과 일치하는 옵션의 branchRule 찾기
  const selectedOption = options.find((opt) => opt.value === selectedValue);
  return selectedOption?.branchRule || null;
}

/**
 * 체크박스 응답의 분기 규칙 찾기.
 * 여러 옵션이 선택된 경우 첫 번째 branchRule 을 우선 적용.
 * grouped 응답 맵(checkbox 질문에 choiceGroups 존재) 도 지원한다.
 */
function getBranchRuleForCheckbox(question: Question, response: unknown): BranchRule | null {
  // manual: question.options 그대로 / table-source: choice_opt 셀에서 변환된 옵션
  const options = resolveChoiceOptions(question);
  if (!options.length) return null;

  // 그룹별 선택 모드: checkbox 질문도 choiceGroups 가 있으면 grouped 맵일 수 있다.
  if (
    isGroupedChoiceQuestion(question) &&
    typeof response === 'object' &&
    response !== null &&
    !Array.isArray(response)
  ) {
    // 맵 값 flat — checkbox 그룹 값은 string[], radio 그룹 값은 string
    const selectedValues = Object.values(response as Record<string, string | string[]>)
      .flatMap((v): string[] => {
        if (typeof v === 'string' && v !== '') return [v];
        if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string');
        return [];
      });
    for (const option of options) {
      if (selectedValues.includes(option.value as string) && option.branchRule) {
        return option.branchRule;
      }
    }
    return null;
  }

  if (!Array.isArray(response)) return null;

  // 체크된 값들 추출 (비그룹 checkbox 경로)
  const checkedValues = response.map((val: unknown) =>
    typeof val === 'object' && val !== null && 'selectedValue' in val
      ? (val as { selectedValue: string }).selectedValue
      : val,
  );

  // 체크된 옵션 중 branchRule이 있는 첫 번째 옵션 찾기
  for (const option of options) {
    if (checkedValues.includes(option.value) && option.branchRule) {
      return option.branchRule;
    }
  }

  return null;
}

/**
 * 셀렉트 응답의 분기 규칙 찾기
 */
function getBranchRuleForSelect(question: Question, response: unknown): BranchRule | null {
  if (!question.options) return null;

  const selectedValue =
    typeof response === 'object' && response !== null && 'selectedValue' in response
      ? (response as { selectedValue: string }).selectedValue
      : response;

  const selectedOption = question.options.find((opt) => opt.value === selectedValue);
  return selectedOption?.branchRule || null;
}

/**
 * 테이블 응답의 분기 규칙 찾기
 * 테이블의 각 셀에서 선택된 값의 branchRule 확인
 */
function getBranchRuleForTable(question: Question, response: unknown): BranchRule | null {
  if (!question.tableRowsData || typeof response !== 'object' || response === null) return null;

  // 테이블 응답은 평면 구조: { "cell-id": value, ... }
  const tableResponse = response as Record<string, unknown>;

  for (const row of question.tableRowsData) {
    for (const cell of row.cells) {
      // isHidden 셀은 렌더되지 않아 응답이 불가능 — 잔존 값이 분기를 결정하지 않도록 제외
      // (table-cell-semantics 의 isEvaluableCell 게이트와 동일 정책)
      if (cell.isHidden) continue;

      const cellValue = tableResponse[cell.id];
      if (!cellValue) continue;

      // 인터랙티브 셀은 응답값으로 option.value ?? option.id 를 저장한다
      // (radio/select/checkbox-cell.tsx). id 매칭은 value 미지정 레거시 호환용.
      const matchesOption = (opt: { id: string; value?: string }, v: unknown) =>
        opt.id === v || (opt.value != null && opt.value === v);

      // Select 타입 셀 처리
      if (cell.type === 'select' && cell.selectOptions) {
        const selectedOptionId =
          typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
            ? (cellValue as { optionId: string }).optionId
            : cellValue;

        const selectedOption = cell.selectOptions.find((opt) => matchesOption(opt, selectedOptionId));
        if (selectedOption?.branchRule) {
          return selectedOption.branchRule;
        }
      }

      // Radio 타입 셀 처리
      if (cell.type === 'radio' && cell.radioOptions) {
        const selectedOptionId =
          typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
            ? (cellValue as { optionId: string }).optionId
            : cellValue;

        const selectedOption = cell.radioOptions.find((opt) => matchesOption(opt, selectedOptionId));
        if (selectedOption?.branchRule) {
          return selectedOption.branchRule;
        }
      }

      // Checkbox 타입 셀 처리 (첫 번째 체크된 옵션의 branchRule 사용)
      if (cell.type === 'checkbox' && cell.checkboxOptions && Array.isArray(cellValue)) {
        const checkedValues = cellValue.map((val: unknown) =>
          typeof val === 'object' && val !== null && 'optionId' in val
            ? (val as { optionId: string }).optionId
            : val,
        );

        for (const option of cell.checkboxOptions) {
          if (option.branchRule && checkedValues.some((v) => matchesOption(option, v))) {
            return option.branchRule;
          }
        }
      }
    }
  }

  return null;
}

/**
 * 질문 ID로 질문 배열에서 인덱스 찾기
 */
export function findQuestionIndexById(questions: Question[], questionId: string): number {
  return questions.findIndex((q) => q.id === questionId);
}

/**
 * 다음 질문 인덱스 결정 (분기 규칙 고려)
 * @returns 다음 질문 인덱스, 또는 -1 (설문 종료)
 */
export function getNextQuestionIndex(
  questions: Question[],
  currentIndex: number,
  currentResponse: unknown,
): number {
  const currentQuestion = questions[currentIndex];
  if (!currentQuestion) return -1;

  // 분기 규칙 확인
  const branchRule = getBranchRuleForResponse(currentQuestion, currentResponse);

  if (branchRule) {
    if (branchRule.action === 'end') {
      // 설문 종료
      return -1;
    } else if (branchRule.action === 'goto' && branchRule.targetQuestionId) {
      // 특정 질문으로 이동
      const targetIndex = findQuestionIndexById(questions, branchRule.targetQuestionId);
      return targetIndex !== -1 ? targetIndex : currentIndex + 1;
    }
  }

  // 분기 규칙이 없으면 순차적으로 다음 질문
  return currentIndex + 1 < questions.length ? currentIndex + 1 : -1;
}

/**
 * 질문 번호를 ID로 변환 (예: 10번 → question-10)
 */
export function questionNumberToId(questionNumber: number): string {
  return `question-${questionNumber}`;
}

/**
 * 질문 ID를 번호로 변환 (예: question-10 → 10)
 */
export function questionIdToNumber(questionId: string): number | null {
  const match = questionId.match(/question-(\d+)/);
  return match && match[1] !== undefined ? parseInt(match[1], 10) : null;
}

/**
 * 테이블 검증 규칙 확인
 * 테이블 응답이 특정 검증 규칙을 만족하는지 확인
 */
export function checkTableValidationRule(
  question: Question,
  response: unknown,
  rule: TableValidationRule,
): boolean {
  if (!question.tableRowsData || typeof response !== 'object' || response === null) {
    return false;
  }

  // 응답 데이터는 평면 구조: { "cell-id": value, ... }
  const tableResponse = response as Record<string, unknown>;
  const { conditions, type } = rule;
  const { rowIds, cellColumnIndex, expectedValues } = conditions;

  // 메인 조건: 지정된 행(rowIds)에서 기대값 매칭 행을 수집.
  // 셀 값 해석(optionId 언랩·옵션 value 변환·input trim)은 table-cell-semantics 소유.
  // 규칙의 checkType 대신 실제 셀 타입 기준으로 판단하는 기존 결정도 그 모듈이 보존한다.
  const checkedRowsInTarget = collectMatchedRows(question.tableRowsData, tableResponse, {
    rowIds,
    columnIndex: cellColumnIndex,
    fallbackToFirstInteractive: true,
    criteria: { expectedValues },
  });

  // 검증 타입에 따라 조건 확인
  let mainConditionResult: boolean;
  switch (type) {
    case 'exclusive-check': {
      // 독점 체크: 전체 행에서 값 존재(셀 타입 불문) 행을 수집해, 지정 행만 체크됐는지 확인
      const allCheckedRowsInTable = collectAnsweredRows(question.tableRowsData, tableResponse, {
        columnIndex: cellColumnIndex,
        fallbackToFirstInteractive: true,
      });
      mainConditionResult =
        allCheckedRowsInTable.length > 0 &&
        allCheckedRowsInTable.every((id) => rowIds.includes(id));
      break;
    }

    case 'any-of':
      // 여러 행 중 하나라도 체크된 경우
      mainConditionResult = quantifyRows(checkedRowsInTarget, rowIds, 'any');
      break;

    case 'all-of':
    case 'required-combination':
      // 특정 행들이 모두 체크된 경우
      mainConditionResult = quantifyRows(checkedRowsInTarget, rowIds, 'all');
      break;

    case 'none-of':
      // 특정 행들이 모두 체크 안된 경우
      mainConditionResult = quantifyRows(checkedRowsInTarget, rowIds, 'none');
      break;

    default:
      return false;
  }

  // 추가 조건이 없으면 메인 조건 결과만 반환
  if (!rule.additionalConditions) {
    return mainConditionResult;
  }

  // 추가 조건에서 확인할 행들 결정 — rowIds 지정 시 그 제한된 행만, 아니면 메인 통과 행.
  // (같은-행 교집합 의미론은 검증 규칙 소유 — 셀 의미론으로 내리지 않는다.)
  const additionalConditions = rule.additionalConditions;

  // legacy JSONB 에서 cellColumnIndex 누락 시 구버전과 동일하게 불충족 처리.
  // (미지정을 모듈에 넘기면 "행의 모든 셀 스캔" 의미가 되어 fail-closed 가 fail-open 으로 반전)
  if (typeof additionalConditions.cellColumnIndex !== 'number') {
    return false;
  }

  const rowsToCheckForAdditional =
    additionalConditions.rowIds && additionalConditions.rowIds.length > 0
      ? additionalConditions.rowIds
      : checkedRowsInTarget;

  if (rowsToCheckForAdditional.length === 0) {
    return false;
  }

  // 추가 조건 평가: 제한된 행의 지정 열에서 하나라도 매칭 (any-of 의미)
  const additionalConditionResult = someRowMatches(question.tableRowsData, tableResponse, {
    rowIds: rowsToCheckForAdditional,
    columnIndex: additionalConditions.cellColumnIndex,
    criteria: { expectedValues: additionalConditions.expectedValues },
  });

  // 최종 결과: 메인 조건과 추가 조건을 모두 만족해야 함
  return mainConditionResult && additionalConditionResult;
}

/**
 * 테이블 검증 규칙들을 확인하고 적용할 분기 규칙 반환
 */
export function getTableValidationBranchRule(
  question: Question,
  response: unknown,
): BranchRule | null {
  if (!question.tableValidationRules || question.tableValidationRules.length === 0) {
    return null;
  }

  // 모든 검증 규칙을 순서대로 확인
  for (const rule of question.tableValidationRules) {
    if (checkTableValidationRule(question, response, rule)) {
      // 조건을 만족하면 해당 분기 규칙 반환
      let targetQuestionId = rule.targetQuestionId;

      // 동적 분기: targetQuestionMap이 있고 추가 조건이 있으면 값에 따라 질문 선택.
      // legacy JSONB 에서 cellColumnIndex 누락 시 구버전과 동일하게 추출 생략(기본 타겟 유지).
      if (
        rule.targetQuestionMap &&
        rule.additionalConditions &&
        typeof rule.additionalConditions.cellColumnIndex === 'number'
      ) {
        const tableResponse = response as Record<string, unknown>;
        const rowsToCheck =
          rule.additionalConditions.rowIds && rule.additionalConditions.rowIds.length > 0
            ? rule.additionalConditions.rowIds
            : question.tableRowsData?.map((r) => r.id) || [];

        // 행 순서대로 대표 선택값을 추출해 첫 매핑 히트로 분기.
        // 셀 값 해석(checkbox 는 첫 체크 optionId, input 은 trim)은 table-cell-semantics 소유.
        const candidateValues = collectSelectedValues(question.tableRowsData ?? [], tableResponse, {
          rowIds: rowsToCheck,
          columnIndex: rule.additionalConditions.cellColumnIndex,
        });
        // 빈 문자열 대표값('' value 옵션)은 매핑 후보에서 제외 — find 가 ''를 히트로 소비하면
        // 바깥 falsy 가드가 폐기해 후속 행의 유효 매핑이 무시된다 (구버전 행별 truthy 가드 보존)
        const mappedValue = candidateValues.find(
          (value) => value && rule.targetQuestionMap?.[value],
        );
        if (mappedValue) {
          targetQuestionId = rule.targetQuestionMap[mappedValue];
        }
      }

      return {
        id: rule.id,
        value: 'table-validation',
        action: rule.action,
        ...(targetQuestionId !== undefined ? { targetQuestionId } : {}),
      };
    }
  }

  return null;
}

/**
 * 그룹 표시 조건 확인
 * 그룹의 표시 조건을 재귀적으로 평가 (상위 그룹 조건 포함)
 */
export function shouldDisplayGroup(
  group: QuestionGroup,
  allResponses: Record<string, unknown>,
  allQuestions: Question[],
  allGroups: QuestionGroup[],
  ctx?: BranchEvalCtx,
): boolean {
  const evalCtx = ctx ?? emptyBranchEvalCtx();
  // 1. 상위 그룹 조건 확인 (재귀)
  if (group.parentGroupId) {
    const parentGroup = allGroups.find((g) => g.id === group.parentGroupId);
    if (parentGroup) {
      if (!shouldDisplayGroup(parentGroup, allResponses, allQuestions, allGroups, evalCtx)) {
        return false; // 상위 그룹이 숨겨지면 하위 그룹도 숨김
      }
    }
  }

  // 2. 현재 그룹 조건 확인
  if (!group.displayCondition) {
    return true; // 조건이 없으면 표시
  }

  return evaluateConditionGroup(group.displayCondition, allResponses, allQuestions, evalCtx);
}

/**
 * 테이블 행 표시 조건 확인
 */
export function shouldDisplayRow(
  row: TableRow,
  allResponses: Record<string, unknown>,
  allQuestions: Question[],
  ctx?: BranchEvalCtx,
): boolean {
  if (!row.displayCondition) {
    return true; // 조건이 없으면 표시
  }
  const evalCtx = ctx ?? emptyBranchEvalCtx();

  return evaluateConditionGroup(row.displayCondition, allResponses, allQuestions, evalCtx);
}

/**
 * 테이블 열 표시 조건 확인
 */
export function shouldDisplayColumn(
  column: TableColumn,
  allResponses: Record<string, unknown>,
  allQuestions: Question[],
  ctx?: BranchEvalCtx,
): boolean {
  if (!column.displayCondition) {
    return true;
  }
  const evalCtx = ctx ?? emptyBranchEvalCtx();

  return evaluateConditionGroup(column.displayCondition, allResponses, allQuestions, evalCtx);
}

/**
 * 동적 행 그룹 표시 조건 확인
 */
export function shouldDisplayDynamicGroup(
  group: DynamicRowGroupConfig,
  allResponses: Record<string, unknown>,
  allQuestions: Question[],
  ctx?: BranchEvalCtx,
): boolean {
  if (!group.displayCondition) {
    return true;
  }
  const evalCtx = ctx ?? emptyBranchEvalCtx();

  return evaluateConditionGroup(group.displayCondition, allResponses, allQuestions, evalCtx);
}

/**
 * 질문 표시 조건 확인
 * 이전 응답들을 기반으로 현재 질문을 표시해야 하는지 판단
 * 그룹 조건과 개별 질문 조건을 모두 확인
 */
export function shouldDisplayQuestion(
  question: Question,
  allResponses: Record<string, unknown>,
  allQuestions: Question[],
  allGroups?: QuestionGroup[],
  ctx?: BranchEvalCtx,
): boolean {
  const evalCtx = ctx ?? emptyBranchEvalCtx();
  // 1. 그룹 조건 확인
  if (allGroups && question.groupId) {
    const group = allGroups.find((g) => g.id === question.groupId);
    if (group) {
      if (!shouldDisplayGroup(group, allResponses, allQuestions, allGroups, evalCtx)) {
        return false; // 그룹이 숨겨지면 질문도 숨김
      }
    }
  }

  // 2. 개별 질문 조건 확인
  if (!question.displayCondition) {
    return true; // 조건이 없으면 표시
  }

  return evaluateConditionGroup(question.displayCondition, allResponses, allQuestions, evalCtx);
}

/**
 * 조건 그룹 결합 — enabled !== false 인 조건들의 평가 결과를 logicType 으로 조합.
 * shouldDisplay{Group,Row,Column,DynamicGroup,Question} 5곳에 복제돼 있던 조합 로직의 단일 거처.
 * (조건 그룹은 표시조건 어휘 — 셀 의미론(table-cell-semantics) 범위 밖이라 이 파일에 둔다.)
 */
function evaluateConditionGroup(
  displayCondition: { conditions: QuestionCondition[]; logicType: ConditionLogicType },
  allResponses: Record<string, unknown>,
  allQuestions: Question[],
  ctx: BranchEvalCtx,
): boolean {
  // 조건들을 평가 (enabled가 false인 조건은 제외)
  const results = displayCondition.conditions
    .filter((condition) => condition.enabled !== false)
    .map((condition) => evaluateQuestionCondition(condition, allResponses, allQuestions, ctx));

  // 논리 타입에 따라 결과 결합
  switch (displayCondition.logicType) {
    case 'AND':
      return results.every((result) => result);
    case 'OR':
      return results.some((result) => result);
    case 'NOT':
      return !results.some((result) => result);
    default:
      return true;
  }
}


// ─── Expression conditionType evaluators ────────────────────────────────────

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function evaluateExpressionOperand(
  operand: ExpressionOperand,
  responses: Record<string, unknown>,
  ctx: BranchEvalCtx,
): number | string | undefined {
  switch (operand.kind) {
    case 'literal':
      return operand.value;
    case 'cell': {
      // 실제 응답 구조: question_responses[questionId] = { cellId: value }
      // (다른 evaluator 들 — 예: checkTableCellCondition 의 tableResponse[cell.id] — 와 동일 패턴)
      const qr = responses[operand.questionId];
      if (!qr || typeof qr !== 'object') return undefined;
      const v = (qr as Record<string, unknown>)[operand.cellId];
      if (v === undefined || v === null || v === '') return undefined;
      return typeof v === 'string' || typeof v === 'number' ? v : undefined;
    }
    case 'question': {
      // 일반 질문 응답 형태가 다양함 (checkValueMatch 와 동일 패턴):
      //   text/textarea  → string
      //   radio/select   → string | { selectedValue: string } | { optionId: string }
      //   checkbox/multi → string[] | object[]   (expression 단일 operand 와 호환 안됨 → undefined)
      const qr = responses[operand.questionId];
      if (qr === undefined || qr === null || qr === '') return undefined;
      if (typeof qr === 'string' || typeof qr === 'number') return qr;
      if (typeof qr === 'object' && !Array.isArray(qr)) {
        const o = qr as { selectedValue?: unknown; optionId?: unknown };
        if (typeof o.selectedValue === 'string' || typeof o.selectedValue === 'number') {
          return o.selectedValue;
        }
        if (typeof o.optionId === 'string') return o.optionId;
      }
      // array (checkbox) 등은 expression 단일 값과 비교 불가 → undefined (fail-safe SHOW)
      return undefined;
    }
    case 'lookup': {
      // ExpressionOperand 'lookup' 은 RightOperand 'lookup' 과 동일한 구조
      const result = evaluateRightOperand(operand, ctx);
      if (result.ok) return result.value;
      return undefined; // fail-safe SHOW
    }
    case 'attr': {
      return ctx.contactAttrs?.[operand.attrsKey];
    }
    case 'binop': {
      const L = toNumber(evaluateExpressionOperand(operand.left, responses, ctx));
      const R = toNumber(evaluateExpressionOperand(operand.right, responses, ctx));
      if (L === undefined || R === undefined) return undefined;
      switch (operand.op) {
        case '+': return L + R;
        case '-': return L - R;
        case '*': return L * R;
        case '/': return R === 0 ? undefined : L / R;
      }
    }
  }
}

/**
 * operand 서브트리가 응답자 입력(cell/question)을 참조하는지 여부.
 * 미해결 비교의 fail 방향을 가른다:
 * - 응답 참조 → fail-closed(미충족). 미응답은 "아직 조건 미충족"이며, legacy 조건 타입
 *   (value-match/table-cell-check 의 !sourceResponse → false)과 동일 정책.
 * - 환경 전용(lookup/attr) → fail-safe SHOW. ctx 미주입 미리보기·익명 진입에서
 *   질문이 사라지지 않도록 하는 기존 안전 기본값 유지.
 */
function operandDependsOnResponse(operand: ExpressionOperand): boolean {
  switch (operand.kind) {
    case 'cell':
    case 'question':
      return true;
    case 'binop':
      return operandDependsOnResponse(operand.left) || operandDependsOnResponse(operand.right);
    default:
      return false;
  }
}

/** 미해결 operand 들의 fail 방향 결정 — 하나라도 응답 참조면 미충족(false), 아니면 SHOW(true) */
function unresolvedComparisonResult(unresolved: ExpressionOperand[]): boolean {
  return !unresolved.some(operandDependsOnResponse);
}

function evaluateExpressionComparison(
  comparison: ExpressionComparison,
  responses: Record<string, unknown>,
  ctx: BranchEvalCtx,
): boolean {
  const L = evaluateExpressionOperand(comparison.left, responses, ctx);
  const R = evaluateExpressionOperand(comparison.right, responses, ctx);
  if (L === undefined || R === undefined) {
    return unresolvedComparisonResult([
      ...(L === undefined ? [comparison.left] : []),
      ...(R === undefined ? [comparison.right] : []),
    ]);
  }

  if (comparison.op === '==' || comparison.op === '!=') {
    const eq = String(L) === String(R);
    return comparison.op === '==' ? eq : !eq;
  }
  const ln = toNumber(L);
  const rn = toNumber(R);
  if (ln === undefined || rn === undefined) {
    return unresolvedComparisonResult([
      ...(ln === undefined ? [comparison.left] : []),
      ...(rn === undefined ? [comparison.right] : []),
    ]);
  }
  switch (comparison.op) {
    case '>': return ln > rn;
    case '<': return ln < rn;
    case '>=': return ln >= rn;
    case '<=': return ln <= rn;
  }
}

function evaluateExpressionClause(
  clause: ExpressionClause,
  responses: Record<string, unknown>,
  ctx: BranchEvalCtx,
): boolean {
  if (clause.kind === 'comparison') return evaluateExpressionComparison(clause.comparison, responses, ctx);
  return evaluateExpressionConfig(clause.group, responses, ctx);
}

function evaluateExpressionConfig(
  config: ExpressionConditionConfig,
  responses: Record<string, unknown>,
  ctx: BranchEvalCtx,
): boolean {
  if (config.clauses.length === 0) return true;
  const firstClause = config.clauses[0];
  if (!firstClause) return true;
  // 좌결합 폴드 — 연산자 우선순위 없이 왼쪽부터 누적.
  // 혼합 AND/OR 에서는 단락 평가로 break 하면 뒤 절이 결과를 뒤집을 수 있어
  // (예: true OR true AND false = false) 폐기하지 않고 끝까지 폴드한다.
  let acc = evaluateExpressionClause(firstClause, responses, ctx);
  for (let i = 1; i < config.clauses.length; i++) {
    const op = config.joinOps[i - 1] ?? 'AND';
    const clause = config.clauses[i];
    if (!clause) break;
    const next = evaluateExpressionClause(clause, responses, ctx);
    acc = op === 'AND' ? acc && next : acc || next;
  }
  return acc;
}

// ─── End expression evaluators ──────────────────────────────────────────────

/**
 * 개별 질문 조건 평가
 */
function evaluateQuestionCondition(
  condition: QuestionCondition,
  allResponses: Record<string, unknown>,
  allQuestions: Question[],
  ctx: BranchEvalCtx,
): boolean {
  // enabled가 false면 false 반환
  if (condition.enabled === false) {
    return false;
  }

  // expression 조건 타입: 응답 전체를 expression evaluator 에 위임 (fail-safe SHOW 자체 처리)
  if (condition.conditionType === 'expression') {
    if (condition.expressionConfig) {
      return evaluateExpressionConfig(condition.expressionConfig, allResponses, ctx);
    }
    return true;
  }

  const sourceResponse = allResponses[condition.sourceQuestionId];
  if (!sourceResponse) {
    return false;
  }

  const sourceQuestion = allQuestions.find((q) => q.id === condition.sourceQuestionId);
  if (!sourceQuestion) {
    return false;
  }

  let mainConditionResult: boolean;

  switch (condition.conditionType) {
    case 'value-match':
      mainConditionResult = checkValueMatch(sourceResponse, condition.requiredValues || []);
      break;

    case 'table-cell-check':
      const result = checkTableCellCondition(
        sourceQuestion,
        sourceResponse,
        condition.tableConditions,
        ctx,
      );
      mainConditionResult = result.satisfied;
      break;

    case 'custom':
      // 커스텀 조건은 확장 가능하도록 남겨둠
      mainConditionResult = true;
      break;

    default:
      return false;
  }

  // 추가 조건이 없으면 메인 조건 결과만 반환
  if (!condition.additionalConditions) {
    return mainConditionResult;
  }

  // 추가 조건 평가
  if (condition.conditionType !== 'table-cell-check' || !sourceQuestion.tableRowsData) {
    // 테이블이 아니면 추가 조건 평가 불가
    return mainConditionResult;
  }

  const tableResponse = sourceResponse as Record<string, unknown>;
  const additionalConditions = condition.additionalConditions;
  const additionalColIndex = additionalConditions.cellColumnIndex;

  // legacy JSONB 에서 cellColumnIndex 누락 시 구버전과 동일하게 불충족 처리 (fail-closed 유지)
  if (typeof additionalColIndex !== 'number') {
    return false;
  }

  // 메인 조건에서 체크된 행들 가져오기
  let checkedRowsInTarget: string[] = [];
  if (condition.conditionType === 'table-cell-check' && condition.tableConditions) {
    const result = checkTableCellCondition(
      sourceQuestion,
      sourceResponse,
      condition.tableConditions,
      ctx,
    );
    checkedRowsInTarget = result.checkedRows;
  }

  // 'none' 메인 조건 특수 처리.
  // 'none' 은 satisfied 일 때 정의상 메인 통과 행이 없어 checkedRowsInTarget 이 비어 있다.
  // 이 경우 아래 같은-행 교집합 루프가 0회 반복 → 과거에는 mainConditionResult 가 true 여도
  // 무조건 false 를 반환해 'none'+추가 조건이 절대 매칭되지 않는 버그가 있었다.
  // 빌더(additional-conditions-editor)가 추가 조건의 행 범위를 tableConditions.rowIds 로
  // 잡는 것과 동일하게, 'none' 일 때는 메인이 검사한 행들에 대해 추가 조건을 평가한다.
  // (any/all 경로는 기존 동작 그대로 checkedRowsInTarget 을 사용한다.)
  const isNoneMainCheck =
    condition.conditionType === 'table-cell-check' &&
    condition.tableConditions?.checkType === 'none';
  const rowsForAdditionalEval = isNoneMainCheck
    ? (condition.tableConditions?.rowIds ?? [])
    : checkedRowsInTarget;

  // 추가 조건에서 확인할 행들 결정 (빈 행 가드용)
  // rowIds가 지정되어 있으면 해당 행만, 없으면 평가 행 집합 사용
  const rowsToCheckForAdditional =
    additionalConditions.rowIds && additionalConditions.rowIds.length > 0
      ? additionalConditions.rowIds
      : rowsForAdditionalEval;

  if (rowsToCheckForAdditional.length === 0) {
    return false;
  }

  // 추가 조건 평가: 같은 행에서 메인 조건과 추가 조건을 모두 만족하는지 확인.
  // (rowsToCheckForAdditional = rowIds 지정 시 그것, 아니면 rowsForAdditionalEval:
  //  any/all 은 메인 통과 행, 'none' 은 메인 검사 대상 행. 셀 값 해석은 table-cell-semantics 소유.)
  const additionalConditionResult = someRowMatches(sourceQuestion.tableRowsData, tableResponse, {
    rowIds: rowsToCheckForAdditional,
    columnIndex: additionalColIndex,
    criteria: {
      expectedValues: additionalConditions.expectedValues,
      numericComparison: additionalConditions.numericComparison,
      ctx,
    },
  });

  // 메인 조건 AND 추가 조건 (같은 행에서 두 조건을 모두 만족하는 행이 있어야 함)
  return mainConditionResult && additionalConditionResult;

}

/**
 * 값 일치 확인
 */
function checkValueMatch(response: unknown, requiredValues: string[]): boolean {
  if (requiredValues.length === 0) {
    return false;
  }

  // 단일 값 (radio, select 등)
  if (typeof response === 'string') {
    return requiredValues.includes(response);
  }

  // 객체 형태 (기타 옵션 포함)
  if (typeof response === 'object' && response !== null) {
    if ('selectedValue' in response) {
      return requiredValues.includes((response as { selectedValue: string }).selectedValue);
    }
    if ('optionId' in response) {
      return requiredValues.includes((response as { optionId: string }).optionId);
    }
  }

  // 배열 (checkbox 등)
  if (Array.isArray(response)) {
    return response.some((val) => {
      if (typeof val === 'string') {
        return requiredValues.includes(val);
      }
      if (typeof val === 'object' && val !== null) {
        if ('selectedValue' in val) {
          return requiredValues.includes((val as { selectedValue: string }).selectedValue);
        }
        if ('optionId' in val) {
          return requiredValues.includes((val as { optionId: string }).optionId);
        }
      }
      return false;
    });
  }

  return false;
}

/**
 * 테이블 셀 조건 확인
 * @returns { satisfied: boolean, checkedRows: string[] } - 조건 만족 여부와 체크된 행 목록
 */
function checkTableCellCondition(
  question: Question,
  response: unknown,
  tableConditions:
    | {
        rowIds: string[];
        cellColumnIndex?: number;
        checkType: 'any' | 'all' | 'none';
        expectedValues?: string[];
        numericComparison?: NumericComparison;
      }
    | undefined,
  ctx: BranchEvalCtx,
): { satisfied: boolean; checkedRows: string[] } {
  if (!tableConditions || !question.tableRowsData) {
    return { satisfied: false, checkedRows: [] };
  }

  if (typeof response !== 'object' || response === null) {
    return { satisfied: false, checkedRows: [] };
  }

  // 응답 데이터는 평면 구조: { "cell-id": value, ... }
  const tableResponse = response as Record<string, unknown>;
  const { rowIds, cellColumnIndex, checkType, expectedValues, numericComparison } = tableConditions;

  // 체크된 행 수집 — 셀 값 해석은 table-cell-semantics 소유.
  // (표시조건 경로는 비인터랙티브 폴백 없음 — 검증 규칙 경로와의 현행 비대칭 보존.)
  const checkedRows = collectMatchedRows(question.tableRowsData, tableResponse, {
    rowIds,
    columnIndex: cellColumnIndex,
    criteria: { expectedValues, numericComparison, ctx },
  });

  // checkType에 따라 조건 확인
  return { satisfied: quantifyRows(checkedRows, rowIds, checkType), checkedRows };
}

/**
 * 현재 응답 기준으로 응답자가 실제 밟게 되는 step 경로를 첫 step 부터 시뮬레이션해,
 * 경로상에 표시되는 질문 id 집합을 반환한다.
 *
 * 제출 검증은 이 집합만 대상으로 해야 한다 — 분기 규칙(end/전진 goto)으로 건너뛴
 * 스텝의 질문은 displayCondition 상 표시 가능해도 응답자가 도달할 수 없으므로
 * 필수·숫자 검증 대상이 아니다. step 히스토리 대신 시뮬레이션을 쓰는 이유는
 * 새로고침 복구(재개) 시 히스토리가 비어 있어도 동일한 결과를 내기 위함이다.
 *
 * 순회 규칙은 응답 흐름(handleNext)과 동일하다:
 *   - 표시 질문이 없는 step 은 건너뛴다.
 *   - 분기 규칙은 step 내 표시 질문 순서대로 평가한다 (resolveStepBranch).
 *   - end → 종료, 전진 goto → 해당 step 으로 점프, 그 외 → 다음 step.
 */
export function collectTraversedQuestionIds(
  steps: RenderStep[],
  allResponses: Record<string, unknown>,
  allQuestions: Question[],
  allGroups?: QuestionGroup[],
  ctx?: BranchEvalCtx,
): Set<string> {
  const ids = new Set<string>();
  const visited = new Set<number>();
  let i = 0;
  while (i >= 0 && i < steps.length && !visited.has(i)) {
    visited.add(i);
    const step = steps[i];
    if (!step) break;

    const displayable = step.items
      .map((item) => item.question)
      .filter((q) => shouldDisplayQuestion(q, allResponses, allQuestions, allGroups, ctx));
    if (displayable.length === 0) {
      i += 1;
      continue;
    }
    for (const q of displayable) ids.add(q.id);

    const rules = displayable.map((q) => getBranchRuleForResponse(q, allResponses[q.id]));
    const outcome = resolveStepBranch(steps, i, rules);
    if (outcome.kind === 'end') break;
    i = outcome.kind === 'goto' ? outcome.stepIndex : i + 1;
  }
  return ids;
}
