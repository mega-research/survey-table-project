import {
  BranchRule,
  DynamicRowGroupConfig,
  ExpressionClause,
  ExpressionComparison,
  ExpressionConditionConfig,
  ExpressionOperand,
  NumericComparison,
  Question,
  QuestionCondition,
  QuestionGroup,
  SurveyLookup,
  TableColumn,
  TableRow,
  TableValidationRule,
} from '@/types/survey';
import { evaluateComparisonWithFailSafe, type ComparisonResult } from '@/lib/lookup/evaluate-comparison';
import { evaluateRightOperand } from '@/lib/lookup/evaluate-lookup';
import type { LookupEvalCtx } from '@/lib/lookup/types';
import { resolveChoiceOptions } from '@/utils/choice-source';

// numeric-input 의 parseNumericInput 는 evaluateComparisonWithFailSafe 내부 (evaluate-arith) 에서 사용.

/**
 * 분기 평가 컨텍스트. displayCondition / BranchRule 의 우변에 LUT 룩업이 등장할 때,
 * 응답 페이지나 빌더 미리보기 호출처에서 응답 전체 + 컨택 attrs + LUT 사본을 주입한다.
 *
 * - 응답 페이지: survey snapshot 의 lookups + ContactAttrsProvider 의 attrs + 누적 responses
 * - 빌더 미리보기: currentSurvey.lookups + sample 컨택 attrs + testResponses
 * - 미주입(undefined): lookup 우변이 평가 불가능 → fail-safe SHOW 동작 (의도된 안전 기본값)
 */
export type BranchEvalCtx = {
  responses: Record<string, Record<string, string | undefined>>;
  contactAttrs: Record<string, string | undefined>;
  lookups: SurveyLookup[];
};

const emptyBranchEvalCtx = (): BranchEvalCtx => ({
  responses: {},
  contactAttrs: {},
  lookups: [],
});

/**
 * NumericComparison 평가 진입점 (T16~).
 * - `cmp.left` 미존재(legacy 데이터) 시 cellValue 를 "현재 평가 중인 셀" 로 wrap 하여 cell-impersonation.
 * - fail-safe 적용된 ComparisonResult 반환. 단순 boolean 이 필요한 곳은 `.satisfied` 사용.
 */
export function evaluateNumericComparisonV2(
  cmp: NumericComparison,
  cellValue: string,
  ctx: BranchEvalCtx,
): ComparisonResult {
  if (!cmp.left) {
    const fakeQ = '__current__';
    const fakeC = '__current__';
    const wrapped: NumericComparison = {
      ...cmp,
      left: { kind: 'cell', questionId: fakeQ, cellId: fakeC },
    };
    const evalCtx: LookupEvalCtx = {
      ...ctx,
      responses: {
        ...ctx.responses,
        [fakeQ]: { ...(ctx.responses[fakeQ] ?? {}), [fakeC]: cellValue },
      },
    };
    return evaluateComparisonWithFailSafe(wrapped, evalCtx);
  }
  return evaluateComparisonWithFailSafe(cmp, ctx);
}

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
 * 라디오 버튼 응답의 분기 규칙 찾기
 */
function getBranchRuleForRadio(question: Question, response: unknown): BranchRule | null {
  // manual: question.options 그대로 / table-source: choice_opt 셀에서 변환된 옵션
  const options = resolveChoiceOptions(question);
  if (!options.length) return null;

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
 * 체크박스 응답의 분기 규칙 찾기
 * 여러 옵션이 선택된 경우 첫 번째 branchRule을 우선 적용
 */
function getBranchRuleForCheckbox(question: Question, response: unknown): BranchRule | null {
  // manual: question.options 그대로 / table-source: choice_opt 셀에서 변환된 옵션
  const options = resolveChoiceOptions(question);
  if (!options.length || !Array.isArray(response)) return null;

  // 체크된 값들 추출
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
      const cellValue = tableResponse[cell.id];
      if (!cellValue) continue;

      // Select 타입 셀 처리
      if (cell.type === 'select' && cell.selectOptions) {
        // select는 optionId를 저장하므로 optionId로 찾기
        const selectedOptionId =
          typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
            ? (cellValue as { optionId: string }).optionId
            : cellValue;

        const selectedOption = cell.selectOptions.find((opt) => opt.id === selectedOptionId);
        if (selectedOption?.branchRule) {
          return selectedOption.branchRule;
        }
      }

      // Radio 타입 셀 처리
      if (cell.type === 'radio' && cell.radioOptions) {
        // 라디오는 optionId를 저장하므로 optionId로 찾기
        const selectedOptionId =
          typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
            ? (cellValue as { optionId: string }).optionId
            : cellValue;

        const selectedOption = cell.radioOptions.find((opt) => opt.id === selectedOptionId);
        if (selectedOption?.branchRule) {
          return selectedOption.branchRule;
        }
      }

      // Checkbox 타입 셀 처리 (첫 번째 체크된 옵션의 branchRule 사용)
      if (cell.type === 'checkbox' && cell.checkboxOptions && Array.isArray(cellValue)) {
        // 체크박스는 optionId 배열을 저장
        const checkedOptionIds = cellValue.map((val: unknown) =>
          typeof val === 'object' && val !== null && 'optionId' in val
            ? (val as { optionId: string }).optionId
            : val,
        );

        for (const option of cell.checkboxOptions) {
          if (checkedOptionIds.includes(option.id) && option.branchRule) {
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
  return match ? parseInt(match[1], 10) : null;
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
  const { rowIds, cellColumnIndex, checkType, expectedValues } = conditions;

  // 디버깅 로그
  console.group(`🔍 테이블 검증 규칙 체크: ${rule.description || rule.id}`);
  console.log('검증 타입:', type);
  console.log('조건:', { rowIds, cellColumnIndex, checkType, expectedValues });
  console.log('테이블 응답 데이터:', tableResponse);
  console.log('질문 행 데이터:', question.tableRowsData);

  // 지정된 행(rowIds) 중에서 체크된 행들을 수집
  const checkedRowsInTarget: string[] = [];

  for (const row of question.tableRowsData) {
    if (!rowIds.includes(row.id)) continue;

    // 특정 열만 확인하거나 모든 셀 확인
    let cellsToCheck = cellColumnIndex !== undefined ? [row.cells[cellColumnIndex]] : row.cells;

    // 만약 특정 열(예: 0번 열)을 선택했는데 해당 셀이 텍스트(라벨) 등 비인터랙티브 타입이라면,
    // 사용자 의도를 파악하여 해당 행의 첫 번째 입력 필드(라디오, 체크박스 등)를 대신 확인합니다.
    if (cellColumnIndex !== undefined && cellsToCheck.length === 1) {
      const targetCell = cellsToCheck[0];
      if (targetCell && ['text', 'image', 'video'].includes(targetCell.type)) {
        const firstInteractive = row.cells.find((c) =>
          ['checkbox', 'radio', 'select', 'input'].includes(c.type),
        );
        if (firstInteractive) {
          cellsToCheck = [firstInteractive];
        }
      }
    }

    for (const cell of cellsToCheck) {
      if (!cell) continue;

      // 평면 구조에서 셀 값 가져오기
      const cellValue = tableResponse[cell.id];
      if (!cellValue) continue;

      // 셀 타입에 따라 체크 여부 확인
      let isChecked = false;

      // 규칙의 checkType 대신 실제 셀의 타입을 기준으로 판단
      // (사용자가 규칙 설정 시 checkType을 잘못 설정하는 경우를 방지하고, 실제 데이터 타입에 맞게 검증)
      switch (cell.type) {
        case 'checkbox':
          // 체크박스: 배열에 값이 있으면 체크됨
          if (Array.isArray(cellValue) && cellValue.length > 0) {
            if (expectedValues && expectedValues.length > 0) {
              // 응답은 optionId 배열을 저장하지만, expectedValues는 value 배열을 저장
              // optionId를 value로 변환해야 함
              const checkedOptionIds = cellValue
                .map((v) =>
                  typeof v === 'object' && v !== null && 'optionId' in v
                    ? (v as { optionId: string }).optionId
                    : typeof v === 'string'
                      ? v
                      : null,
                )
                .filter((id): id is string => id !== null);

              if (cell.checkboxOptions) {
                // optionId로 옵션들을 찾아서 value를 가져옴
                const checkedValues = checkedOptionIds
                  .map((optionId) => {
                    const option = cell.checkboxOptions?.find((opt) => opt.id === optionId);
                    return option?.value;
                  })
                  .filter((v): v is string => v !== undefined);

                if (checkedValues.some((v) => expectedValues.includes(v))) {
                  isChecked = true;
                }
              }
            } else {
              isChecked = true;
            }
          }
          break;

        case 'radio':
          // 라디오: 값이 있으면 선택됨
          if (cellValue) {
            if (expectedValues && expectedValues.length > 0) {
              // 응답은 optionId를 저장하지만, expectedValues는 value를 저장
              // optionId를 value로 변환해야 함
              const selectedOptionId =
                typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
                  ? (cellValue as { optionId: string }).optionId
                  : typeof cellValue === 'string'
                    ? cellValue
                    : null;

              if (selectedOptionId && cell.radioOptions) {
                // optionId로 옵션을 찾아서 value를 가져옴
                const selectedOption = cell.radioOptions.find((opt) => opt.id === selectedOptionId);
                if (selectedOption && expectedValues.includes(selectedOption.value)) {
                  isChecked = true;
                }
              }
            } else {
              isChecked = true;
            }
          }
          break;

        case 'select':
          // 셀렉트: 값이 있고, expectedValues가 있으면 그 값과 일치하는지 확인
          if (cellValue) {
            if (expectedValues && expectedValues.length > 0) {
              // 응답은 optionId를 저장하지만, expectedValues는 value를 저장
              // optionId를 value로 변환해야 함
              const selectedOptionId =
                typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
                  ? (cellValue as { optionId: string }).optionId
                  : typeof cellValue === 'string'
                    ? cellValue
                    : null;

              if (selectedOptionId && cell.selectOptions) {
                // optionId로 옵션을 찾아서 value를 가져옴
                const selectedOption = cell.selectOptions.find(
                  (opt) => opt.id === selectedOptionId,
                );
                if (selectedOption) {
                  isChecked = expectedValues.includes(selectedOption.value);
                }
              }
            } else {
              isChecked = true;
            }
          }
          break;

        case 'input':
          // 입력: 값이 있고, expectedValues가 있으면 그 값과 일치하는지 확인
          if (cellValue) {
            const strValue = String(cellValue).trim();
            if (strValue !== '') {
              if (expectedValues && expectedValues.length > 0) {
                isChecked = expectedValues.includes(strValue);
              } else {
                isChecked = true;
              }
            }
          }
          break;
      }

      if (isChecked && !checkedRowsInTarget.includes(row.id)) {
        checkedRowsInTarget.push(row.id);
        console.log(`✅ 행 ${row.id} (${row.label}): 지정된 행 중 체크됨`);
      }
    }
  }

  console.log('지정된 행 중 체크된 행:', checkedRowsInTarget);

  // 검증 타입에 따라 조건 확인
  let mainConditionResult: boolean;
  switch (type) {
    case 'exclusive-check':
      // 특정 행만 체크된 경우 (다른 행은 체크 안됨)
      // 모든 행 중에서 rowIds에 지정된 행만 체크되어야 함
      const allCheckedRowsInTable: string[] = [];
      for (const row of question.tableRowsData) {
        let cellsToCheck = cellColumnIndex !== undefined ? [row.cells[cellColumnIndex]] : row.cells;

        // 만약 특정 열(예: 0번 열)을 선택했는데 해당 셀이 텍스트(라벨) 등 비인터랙티브 타입이라면,
        // 사용자 의도를 파악하여 해당 행의 첫 번째 입력 필드(라디오, 체크박스 등)를 대신 확인합니다.
        if (cellColumnIndex !== undefined && cellsToCheck.length === 1) {
          const targetCell = cellsToCheck[0];
          if (targetCell && ['text', 'image', 'video'].includes(targetCell.type)) {
            const firstInteractive = row.cells.find((c) =>
              ['checkbox', 'radio', 'select', 'input'].includes(c.type),
            );
            if (firstInteractive) {
              cellsToCheck = [firstInteractive];
            }
          }
        }

        for (const cell of cellsToCheck) {
          if (!cell) continue;
          // 평면 구조에서 셀 값 가져오기
          const cellValue = tableResponse[cell.id];

          let isAnyChecked = false;

          // 셀 타입이나 규칙의 checkType에 상관없이 실제 값이 존재하는지 확인
          if (Array.isArray(cellValue)) {
            if (cellValue.length > 0) isAnyChecked = true;
          } else if (typeof cellValue === 'string') {
            if (cellValue.trim() !== '') isAnyChecked = true;
          } else if (cellValue) {
            // 객체나 기타 Truthy 값
            isAnyChecked = true;
          }

          if (isAnyChecked && !allCheckedRowsInTable.includes(row.id)) {
            allCheckedRowsInTable.push(row.id);
            console.log(`✅ 행 ${row.id} (${row.label}): 테이블 전체에서 체크됨`);
            break;
          }
        }
      }

      // rowIds에 지정된 행들만 체크되고, 다른 행은 체크 안되어야 함
      console.log('테이블 전체에서 체크된 행:', allCheckedRowsInTable);
      console.log('지정된 행:', rowIds);

      // 독점 체크: 체크된 행이 있고, 모든 체크된 행이 지정된 행에 포함되어야 함
      // (다른 행이 체크되면 안됨)
      mainConditionResult =
        allCheckedRowsInTable.length > 0 &&
        allCheckedRowsInTable.every((id) => rowIds.includes(id));

      console.log('독점 체크 결과:', mainConditionResult);
      console.log('  - 체크된 행 수:', allCheckedRowsInTable.length);
      console.log(
        '  - 모든 체크된 행이 지정된 행에 포함됨:',
        allCheckedRowsInTable.every((id) => rowIds.includes(id)),
      );
      break;

    case 'any-of':
      // 여러 행 중 하나라도 체크된 경우
      mainConditionResult = checkedRowsInTarget.length > 0;
      console.log('any-of 결과:', mainConditionResult);
      console.log('  - 지정된 행 중 체크된 행 수:', checkedRowsInTarget.length);
      break;

    case 'all-of':
      // 특정 행들이 모두 체크된 경우
      mainConditionResult = rowIds.every((id) => checkedRowsInTarget.includes(id));
      console.log('all-of 결과:', mainConditionResult);
      console.log('  - 지정된 행:', rowIds);
      console.log('  - 체크된 행:', checkedRowsInTarget);
      console.log('  - 모든 지정된 행이 체크됨:', mainConditionResult);
      break;

    case 'none-of':
      // 특정 행들이 모두 체크 안된 경우
      mainConditionResult = checkedRowsInTarget.length === 0;
      console.log('none-of 결과:', mainConditionResult);
      console.log('  - 지정된 행 중 체크된 행 수:', checkedRowsInTarget.length, '(0이어야 함)');
      break;

    case 'required-combination':
      // 특정 조합이 체크된 경우 (모든 지정된 행이 체크되어야 함)
      mainConditionResult = rowIds.every((id) => checkedRowsInTarget.includes(id));
      console.log('required-combination 결과:', mainConditionResult);
      console.log('  - 지정된 행:', rowIds);
      console.log('  - 체크된 행:', checkedRowsInTarget);
      console.log('  - 모든 지정된 행이 체크됨:', mainConditionResult);
      break;

    default:
      console.groupEnd();
      return false;
  }

  // 추가 조건이 없으면 메인 조건 결과만 반환
  if (!rule.additionalConditions) {
    console.groupEnd();
    return mainConditionResult;
  }

  // 추가 조건 평가
  const additionalConditions = rule.additionalConditions;
  console.log('📋 추가 조건 평가 시작');
  console.log('추가 조건:', additionalConditions);

  // 추가 조건에서 확인할 행들 결정
  // rowIds가 지정되어 있으면 해당 행만, 없으면 메인 조건에서 체크된 행 사용
  const rowsToCheckForAdditional =
    additionalConditions.rowIds && additionalConditions.rowIds.length > 0
      ? additionalConditions.rowIds
      : checkedRowsInTarget;

  if (rowsToCheckForAdditional.length === 0) {
    console.log('⚠️ 추가 조건을 확인할 행이 없습니다');
    console.groupEnd();
    return false;
  }

  console.log('추가 조건에서 확인할 행:', rowsToCheckForAdditional);

  // 추가 조건 평가: 같은 행에서 메인 조건과 추가 조건을 모두 만족하는지 확인
  // (메인 조건에서 체크된 행들 중에서, 같은 행에서 추가 조건도 만족하는 행이 있는지 확인)
  let additionalConditionResult = false;
  const additionalColIndex = additionalConditions.cellColumnIndex;

  // 메인 조건에서 체크된 행들만 확인 (같은 행에서 두 조건을 모두 만족해야 함)
  for (const rowId of checkedRowsInTarget) {
    const row = question.tableRowsData.find((r) => r.id === rowId);
    if (!row) continue;

    const cell = row.cells[additionalColIndex];
    if (!cell) continue;

    // 평면 구조에서 셀 값 가져오기
    const cellValue = tableResponse[cell.id];
    if (!cellValue) continue;

    // 셀 타입에 따라 체크 여부 확인
    let isChecked = false;

    switch (cell.type) {
      case 'checkbox':
        if (Array.isArray(cellValue) && cellValue.length > 0) {
          if (
            additionalConditions.expectedValues &&
            additionalConditions.expectedValues.length > 0
          ) {
            const checkedOptionIds = cellValue
              .map((v) =>
                typeof v === 'object' && v !== null && 'optionId' in v
                  ? (v as { optionId: string }).optionId
                  : typeof v === 'string'
                    ? v
                    : null,
              )
              .filter((id): id is string => id !== null);

            if (cell.checkboxOptions) {
              const checkedValues = checkedOptionIds
                .map((optionId) => {
                  const option = cell.checkboxOptions?.find((opt) => opt.id === optionId);
                  return option?.value;
                })
                .filter((v): v is string => v !== undefined);

              if (checkedValues.some((v) => additionalConditions.expectedValues!.includes(v))) {
                isChecked = true;
              }
            }
          } else {
            isChecked = true;
          }
        }
        break;

      case 'radio':
        if (cellValue) {
          if (
            additionalConditions.expectedValues &&
            additionalConditions.expectedValues.length > 0
          ) {
            const selectedOptionId =
              typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
                ? (cellValue as { optionId: string }).optionId
                : typeof cellValue === 'string'
                  ? cellValue
                  : null;

            if (selectedOptionId && cell.radioOptions) {
              const selectedOption = cell.radioOptions.find((opt) => opt.id === selectedOptionId);
              if (
                selectedOption &&
                additionalConditions.expectedValues.includes(selectedOption.value)
              ) {
                isChecked = true;
              }
            }
          } else {
            isChecked = true;
          }
        }
        break;

      case 'select':
        if (cellValue) {
          if (
            additionalConditions.expectedValues &&
            additionalConditions.expectedValues.length > 0
          ) {
            const selectedOptionId =
              typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
                ? (cellValue as { optionId: string }).optionId
                : typeof cellValue === 'string'
                  ? cellValue
                  : null;

            if (selectedOptionId && cell.selectOptions) {
              const selectedOption = cell.selectOptions.find((opt) => opt.id === selectedOptionId);
              if (selectedOption) {
                isChecked = additionalConditions.expectedValues.includes(selectedOption.value);
              }
            }
          } else {
            isChecked = true;
          }
        }
        break;

      case 'input':
        if (cellValue) {
          const strValue = String(cellValue).trim();
          if (strValue !== '') {
            if (
              additionalConditions.expectedValues &&
              additionalConditions.expectedValues.length > 0
            ) {
              isChecked = additionalConditions.expectedValues.includes(strValue);
            } else {
              isChecked = true;
            }
          }
        }
        break;
    }

    if (isChecked) {
      additionalConditionResult = true;
      console.log(`✅ 행 ${row.id} (${row.label}): 같은 행에서 메인 조건과 추가 조건 모두 만족`);
      break; // 하나라도 만족하면 됨 (any-of 타입이므로)
    }
  }

  console.log('추가 조건 결과:', additionalConditionResult);
  const finalResult = mainConditionResult && additionalConditionResult;
  console.log('최종 결과 (메인 조건 AND 추가 조건):', finalResult);
  console.log('  - 같은 행에서 두 조건을 모두 만족하는 행이 있는지 확인');
  console.groupEnd();

  return finalResult;
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

      // 동적 분기: targetQuestionMap이 있고 추가 조건이 있으면 값에 따라 질문 선택
      if (rule.targetQuestionMap && rule.additionalConditions) {
        const tableResponse = response as Record<string, unknown>;
        const additionalColIndex = rule.additionalConditions.cellColumnIndex;
        const rowsToCheck =
          rule.additionalConditions.rowIds && rule.additionalConditions.rowIds.length > 0
            ? rule.additionalConditions.rowIds
            : question.tableRowsData?.map((r) => r.id) || [];

        // 추가 조건에서 선택된 값 찾기
        for (const row of question.tableRowsData || []) {
          if (!rowsToCheck.includes(row.id)) continue;

          const cell = row.cells[additionalColIndex];
          if (!cell) continue;

          const cellValue = tableResponse[cell.id];
          if (!cellValue) continue;

          // 셀 타입에 따라 값 추출
          let selectedValue: string | null = null;

          switch (cell.type) {
            case 'radio':
              if (cellValue) {
                const selectedOptionId =
                  typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
                    ? (cellValue as { optionId: string }).optionId
                    : typeof cellValue === 'string'
                      ? cellValue
                      : null;

                if (selectedOptionId && cell.radioOptions) {
                  const selectedOption = cell.radioOptions.find(
                    (opt) => opt.id === selectedOptionId,
                  );
                  if (selectedOption) {
                    selectedValue = selectedOption.value;
                  }
                }
              }
              break;

            case 'select':
              if (cellValue) {
                const selectedOptionId =
                  typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
                    ? (cellValue as { optionId: string }).optionId
                    : typeof cellValue === 'string'
                      ? cellValue
                      : null;

                if (selectedOptionId && cell.selectOptions) {
                  const selectedOption = cell.selectOptions.find(
                    (opt) => opt.id === selectedOptionId,
                  );
                  if (selectedOption) {
                    selectedValue = selectedOption.value;
                  }
                }
              }
              break;

            case 'checkbox':
              // 체크박스는 첫 번째 체크된 옵션의 값 사용
              if (Array.isArray(cellValue) && cellValue.length > 0) {
                const checkedOptionIds = cellValue
                  .map((v) =>
                    typeof v === 'object' && v !== null && 'optionId' in v
                      ? (v as { optionId: string }).optionId
                      : typeof v === 'string'
                        ? v
                        : null,
                  )
                  .filter((id): id is string => id !== null);

                if (checkedOptionIds.length > 0 && cell.checkboxOptions) {
                  const firstOption = cell.checkboxOptions.find(
                    (opt) => opt.id === checkedOptionIds[0],
                  );
                  if (firstOption) {
                    selectedValue = firstOption.value;
                  }
                }
              }
              break;

            case 'input':
              if (cellValue) {
                selectedValue = String(cellValue).trim();
              }
              break;
          }

          // targetQuestionMap에서 해당 값으로 질문 ID 찾기
          if (selectedValue && rule.targetQuestionMap[selectedValue]) {
            targetQuestionId = rule.targetQuestionMap[selectedValue];
            console.log(`🎯 동적 분기: "${selectedValue}" → 질문 ID: ${targetQuestionId}`);
            break;
          }
        }
      }

      return {
        id: rule.id,
        value: 'table-validation',
        action: rule.action,
        targetQuestionId,
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

  const { conditions, logicType } = group.displayCondition;

  // 조건들을 평가 (enabled가 false인 조건은 제외)
  const results = conditions
    .filter((condition) => condition.enabled !== false)
    .map((condition) => evaluateQuestionCondition(condition, allResponses, allQuestions, evalCtx));

  // 논리 타입에 따라 결과 결합
  switch (logicType) {
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

  const { conditions, logicType } = row.displayCondition;

  // 조건들을 평가 (enabled가 false인 조건은 제외)
  const results = conditions
    .filter((condition) => condition.enabled !== false)
    .map((condition) => evaluateQuestionCondition(condition, allResponses, allQuestions, evalCtx));

  // 논리 타입에 따라 결과 결합
  switch (logicType) {
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

  const { conditions, logicType } = column.displayCondition;

  const results = conditions
    .filter((condition) => condition.enabled !== false)
    .map((condition) => evaluateQuestionCondition(condition, allResponses, allQuestions, evalCtx));

  switch (logicType) {
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

  const { conditions, logicType } = group.displayCondition;

  const results = conditions
    .filter((condition) => condition.enabled !== false)
    .map((condition) => evaluateQuestionCondition(condition, allResponses, allQuestions, evalCtx));

  switch (logicType) {
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

  const { conditions, logicType } = question.displayCondition;

  // 조건들을 평가 (enabled가 false인 조건은 제외)
  const results = conditions
    .filter((condition) => condition.enabled !== false)
    .map((condition) => evaluateQuestionCondition(condition, allResponses, allQuestions, evalCtx));

  // 논리 타입에 따라 결과 결합
  switch (logicType) {
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

function evaluateExpressionComparison(
  comparison: ExpressionComparison,
  responses: Record<string, unknown>,
  ctx: BranchEvalCtx,
): boolean {
  const L = evaluateExpressionOperand(comparison.left, responses, ctx);
  const R = evaluateExpressionOperand(comparison.right, responses, ctx);
  if (L === undefined || R === undefined) return true; // fail-safe SHOW

  if (comparison.op === '==' || comparison.op === '!=') {
    const eq = String(L) === String(R);
    return comparison.op === '==' ? eq : !eq;
  }
  const ln = toNumber(L);
  const rn = toNumber(R);
  if (ln === undefined || rn === undefined) return true;
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
  let acc = evaluateExpressionClause(config.clauses[0], responses, ctx);
  for (let i = 1; i < config.clauses.length; i++) {
    const op = config.joinOps[i - 1] ?? 'AND';
    // 단락 평가 — lookup 평가까지 포함된 clause 의 비용을 무료로 절약
    if (op === 'AND' && !acc) break;
    if (op === 'OR' && acc) break;
    const next = evaluateExpressionClause(config.clauses[i], responses, ctx);
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

  // 추가 조건에서 확인할 행들 결정
  // rowIds가 지정되어 있으면 해당 행만, 없으면 메인 조건에서 체크된 행 사용
  const rowsToCheckForAdditional =
    additionalConditions.rowIds && additionalConditions.rowIds.length > 0
      ? additionalConditions.rowIds
      : checkedRowsInTarget;

  if (rowsToCheckForAdditional.length === 0) {
    return false;
  }

  // 추가 조건 평가: 같은 행에서 메인 조건과 추가 조건을 모두 만족하는지 확인
  // (메인 조건에서 체크된 행들 중에서, 같은 행에서 추가 조건도 만족하는 행이 있는지 확인)
  let additionalConditionResult = false;

  // 메인 조건에서 체크된 행들만 확인 (같은 행에서 두 조건을 모두 만족해야 함)
  for (const rowId of checkedRowsInTarget) {
    const row = sourceQuestion.tableRowsData.find((r) => r.id === rowId);
    if (!row) continue;

    const cell = row.cells[additionalColIndex];
    if (!cell) continue;

    const cellValue = tableResponse[cell.id];
    if (!cellValue) continue;

    // 셀 타입에 따라 체크 여부 확인
    let isChecked = false;

    switch (cell.type) {
      case 'checkbox':
        if (Array.isArray(cellValue) && cellValue.length > 0) {
          if (
            additionalConditions.expectedValues &&
            additionalConditions.expectedValues.length > 0
          ) {
            const checkedOptionIds = cellValue
              .map((v) =>
                typeof v === 'object' && v !== null && 'optionId' in v
                  ? (v as { optionId: string }).optionId
                  : typeof v === 'string'
                    ? v
                    : null,
              )
              .filter((id): id is string => id !== null);

            if (cell.checkboxOptions) {
              const checkedValues = checkedOptionIds
                .map((optionId) => {
                  const option = cell.checkboxOptions?.find((opt) => opt.id === optionId);
                  return option?.value;
                })
                .filter((v): v is string => v !== undefined);

              if (checkedValues.some((v) => additionalConditions.expectedValues!.includes(v))) {
                isChecked = true;
              }
            }
          } else {
            isChecked = true;
          }
        }
        break;

      case 'radio':
        if (cellValue) {
          if (
            additionalConditions.expectedValues &&
            additionalConditions.expectedValues.length > 0
          ) {
            const selectedOptionId =
              typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
                ? (cellValue as { optionId: string }).optionId
                : typeof cellValue === 'string'
                  ? cellValue
                  : null;

            if (selectedOptionId && cell.radioOptions) {
              const selectedOption = cell.radioOptions.find((opt) => opt.id === selectedOptionId);
              if (
                selectedOption &&
                additionalConditions.expectedValues.includes(selectedOption.value)
              ) {
                isChecked = true;
              }
            }
          } else {
            isChecked = true;
          }
        }
        break;

      case 'select':
        if (cellValue) {
          if (
            additionalConditions.expectedValues &&
            additionalConditions.expectedValues.length > 0
          ) {
            const selectedOptionId =
              typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
                ? (cellValue as { optionId: string }).optionId
                : typeof cellValue === 'string'
                  ? cellValue
                  : null;

            if (selectedOptionId && cell.selectOptions) {
              const selectedOption = cell.selectOptions.find((opt) => opt.id === selectedOptionId);
              if (selectedOption) {
                isChecked = additionalConditions.expectedValues.includes(selectedOption.value);
              }
            }
          } else {
            isChecked = true;
          }
        }
        break;

      case 'input':
        if (cellValue) {
          const strValue = String(cellValue).trim();
          if (strValue !== '') {
            if (additionalConditions.numericComparison) {
              isChecked = evaluateNumericComparisonV2(
                additionalConditions.numericComparison,
                strValue,
                ctx,
              ).satisfied;
            } else if (
              additionalConditions.expectedValues &&
              additionalConditions.expectedValues.length > 0
            ) {
              isChecked = additionalConditions.expectedValues.includes(strValue);
            } else {
              isChecked = true;
            }
          }
        }
        break;
    }

    if (isChecked) {
      additionalConditionResult = true;
      break; // 하나라도 만족하면 됨 (any-of 타입이므로)
    }
  }

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

  // 체크된 행들 수집
  const checkedRows: string[] = [];

  for (const row of question.tableRowsData) {
    if (!rowIds.includes(row.id)) continue;

    const cellsToCheck = cellColumnIndex !== undefined ? [row.cells[cellColumnIndex]] : row.cells;

    for (const cell of cellsToCheck) {
      if (!cell) continue;

      // 평면 구조에서 셀 값 가져오기
      const cellValue = tableResponse[cell.id];
      if (!cellValue) continue;

      // 셀 타입에 따라 체크 여부 확인
      let isChecked = false;

      if (cell.type === 'checkbox' && Array.isArray(cellValue) && cellValue.length > 0) {
        if (expectedValues && expectedValues.length > 0) {
          const checkedOptionIds = cellValue
            .map((v) =>
              typeof v === 'object' && v !== null && 'optionId' in v
                ? (v as { optionId: string }).optionId
                : typeof v === 'string'
                  ? v
                  : null,
            )
            .filter((id): id is string => id !== null);

          if (cell.checkboxOptions) {
            const checkedValues = checkedOptionIds
              .map((optionId) => {
                const option = cell.checkboxOptions?.find((opt) => opt.id === optionId);
                return option?.value;
              })
              .filter((v): v is string => v !== undefined);

            if (checkedValues.some((v) => expectedValues.includes(v))) {
              isChecked = true;
            }
          }
        } else {
          isChecked = true;
        }
      } else if (cell.type === 'radio' && cellValue) {
        if (expectedValues && expectedValues.length > 0) {
          const selectedOptionId =
            typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
              ? (cellValue as { optionId: string }).optionId
              : typeof cellValue === 'string'
                ? cellValue
                : null;

          if (selectedOptionId && cell.radioOptions) {
            const selectedOption = cell.radioOptions.find((opt) => opt.id === selectedOptionId);
            if (selectedOption && expectedValues.includes(selectedOption.value)) {
              isChecked = true;
            }
          }
        } else {
          isChecked = true;
        }
      } else if (cell.type === 'select' && cellValue) {
        if (expectedValues && expectedValues.length > 0) {
          const selectedOptionId =
            typeof cellValue === 'object' && cellValue !== null && 'optionId' in cellValue
              ? (cellValue as { optionId: string }).optionId
              : typeof cellValue === 'string'
                ? cellValue
                : null;

          if (selectedOptionId && cell.selectOptions) {
            const selectedOption = cell.selectOptions.find((opt) => opt.id === selectedOptionId);
            if (selectedOption) {
              isChecked = expectedValues.includes(selectedOption.value);
            }
          }
        } else {
          isChecked = true;
        }
      } else if (
        cell.type === 'input' &&
        typeof cellValue === 'string' &&
        cellValue.trim() !== ''
      ) {
        if (numericComparison) {
          isChecked = evaluateNumericComparisonV2(numericComparison, cellValue, ctx).satisfied;
        } else if (expectedValues && expectedValues.length > 0) {
          isChecked = expectedValues.includes(cellValue.trim());
        } else {
          isChecked = true;
        }
      }

      if (isChecked && !checkedRows.includes(row.id)) {
        checkedRows.push(row.id);
        break;
      }
    }
  }

  // checkType에 따라 조건 확인
  let satisfied: boolean;
  switch (checkType) {
    case 'any':
      satisfied = checkedRows.length > 0;
      break;
    case 'all':
      satisfied = rowIds.every((id) => checkedRows.includes(id));
      break;
    case 'none':
      satisfied = checkedRows.length === 0;
      break;
    default:
      satisfied = false;
  }

  return { satisfied, checkedRows };
}
