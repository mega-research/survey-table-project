import {
  Question,
  QuestionOption,
  Survey,
} from '@/types/survey';
import {
  shouldDisplayQuestion,
  getNextQuestionIndex,
} from '@/utils/branch-logic';

/**
 * 주어진 설문에 대한 가짜(Mock) 응답 데이터를 생성합니다.
 * 설문의 분기 로직(Branch Logic)과 표시 조건(Display Condition)을 준수합니다.
 */
/**
 * 옵션 텍스트 입력(기타 등) 사이드카 키 — 실제 제출 payload 와 동일한 키.
 * 저장 구조: questionResponses.__optTexts__[questionId][optionId] = text
 * (읽기 정본: lib/option-text-read.getOptionText)
 */
export const OPT_TEXTS_KEY = '__optTexts__';

/** allowTextInput 옵션에 채울 기본 mock 텍스트 — 시드 스크립트에서 시맨틱 텍스트로 교체 가능 */
function fakeOptionText(opt: { textInputPlaceholder?: string }): string {
  const base = opt.textInputPlaceholder?.trim() || '기타 응답';
  return `${base} ${Math.floor(Math.random() * 100) + 1}`;
}

export function generateFakeSurveyResponse(survey: Survey): Record<string, any> {
  const responses: Record<string, any> = {};
  const optTexts: Record<string, Record<string, string>> = {};
  const questions = survey.questions;
  let currentIndex = 0;

  // 무한 루프 방지용 (최대 질문 수의 2배까지만 순회)
  let loopCount = 0;
  const maxLoops = questions.length * 2;

  while (currentIndex >= 0 && currentIndex < questions.length && loopCount < maxLoops) {
    loopCount++;
    const question = questions[currentIndex];
    if (!question) break;

    // 1. 질문이 현재 응답 상태에서 표시되어야 하는지 확인
    const isVisible = shouldDisplayQuestion(
      question,
      responses,
      questions,
      survey.groups
    );

    if (isVisible) {
      // 선택된 옵션이 텍스트 입력(기타 등)을 허용하면 사이드카에 수집.
      // 실제 제출 경로(survey-response-flow.buildOptTextsPayload)와 동일한 저장 구조:
      //   responses.__optTexts__[questionId][optionId] = text
      const collectOptionText = (opt: {
        id: string;
        allowTextInput?: boolean;
        textInputPlaceholder?: string;
      } | null | undefined) => {
        if (!opt?.allowTextInput) return;
        const perQuestion = (optTexts[question.id] ??= {});
        perQuestion[opt.id] = fakeOptionText(opt);
      };

      // 2. 랜덤 응답 생성
      const responseValue = generateRandomValueForQuestion(question, responses, collectOptionText);

      if (responseValue !== null && responseValue !== undefined) {
        responses[question.id] = responseValue;
      }
    }

    // 3. 다음 질문 인덱스 결정 (분기 로직 적용)
    // 현재 질문에 응답이 없어도(숨겨진 질문), 분기 로직은 확인해야 함 (숨겨진 질문은 보통 다음으로 넘어감)
    // branch-logic의 getNextQuestionIndex는 응답을 기반으로 판단하므로, 
    // 응답이 없으면 기본적으로 index + 1을 반환함.
    const currentResponse = responses[question.id];
    const nextIndex = getNextQuestionIndex(questions, currentIndex, currentResponse);

    if (nextIndex === -1) {
      break; // 설문 종료
    }

    currentIndex = nextIndex;
  }

  if (Object.keys(optTexts).length > 0) {
    responses[OPT_TEXTS_KEY] = optTexts;
  }

  return responses;
}

/**
 * 개별 질문에 대한 랜덤 값을 생성합니다.
 */
function generateRandomValueForQuestion(
  question: Question,
  allResponses: Record<string, any>,
  collectOptionText: (opt: QuestionOption | null | undefined) => void
): any {
  switch (question.type) {
    case 'radio':
    case 'select': { // 단일 선택
      const opt = pickRandomOption(question.options);
      if (!opt) return null;
      collectOptionText(opt);
      return opt.value;
    }

    case 'checkbox':
    case 'multiselect': { // 다중 선택
      const opts = pickRandomMultipleOptions(question.options);
      opts.forEach(collectOptionText);
      return opts.map(opt => opt.value);
    }

    case 'text':
      return `테스트 응답 ${Math.floor(Math.random() * 1000)}`;

    case 'textarea':
      return `테스트 서술형 응답입니다. 랜덤 숫자: ${Math.floor(Math.random() * 1000)}`;

    case 'table':
      return generateRandomTableResponse(question, allResponses, collectOptionText);

    case 'notice':
      return null; // 공지사항은 응답 없음

    default:
      return null;
  }
}

/**
 * 옵션 중 하나를 랜덤하게 선택 (Radio, Select)
 */
function pickRandomOption(options?: QuestionOption[]): QuestionOption | null {
  if (!options || options.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * options.length);
  return options[randomIndex] ?? null;
}

/**
 * 옵션 중 여러 개를 본포에 따라 랜덤하게 선택 (Checkbox, Multiselect)
 */
function pickRandomMultipleOptions(options?: QuestionOption[]): QuestionOption[] {
  if (!options || options.length === 0) return [];

  // 최소 1개 이상 선택하도록 설정 (필수라고 가정)
  const countToPick = Math.max(1, Math.floor(Math.random() * Math.min(3, options.length)) + 1);

  // 셔플 후 앞에서부터 n개 선택
  const shuffled = [...options].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, countToPick);
}

/**
 * 테이블 질문에 대한 랜덤 응답 생성 (가장 복잡함)
 * TableValidationRule을 준수해야 함.
 */
function generateRandomTableResponse(
  question: Question,
  _allResponses: Record<string, any>,
  collectOptionText: (opt: QuestionOption | null | undefined) => void
): Record<string, any> {
  if (!question.tableRowsData) return {};

  const tableResponse: Record<string, any> = {};
  const rows = question.tableRowsData;
  const validationRules = question.tableValidationRules || [];

  // 검증 규칙 분석 — 행 단위 전략 결정에 사용
  const exclusiveGroups: string[][] = [];
  const anyOfGroups: string[][] = [];
  const requiredRows = new Set<string>();
  const forbiddenRows = new Set<string>();

  for (const rule of validationRules) {
    if (rule.type === 'exclusive-check') {
      // conditions.rowIds가 상호 배타적 그룹임
      exclusiveGroups.push(rule.conditions.rowIds);
    } else if (rule.type === 'required-combination' || rule.type === 'all-of') {
      rule.conditions.rowIds.forEach(id => requiredRows.add(id));
    } else if (rule.type === 'none-of') {
      rule.conditions.rowIds.forEach(id => forbiddenRows.add(id));
    } else if (rule.type === 'any-of') {
      anyOfGroups.push(rule.conditions.rowIds);
    }
  }

  // 행별 처리 전략.
  // 기본은 fill — 완료 응답이라면 모든 보이는 행에 답한다는 가정.
  // (radio/select/input 셀은 항상 채우고, checkbox 셀만 fillRowCells 에서 확률적으로 채운다.)
  const rowStrategies = new Map<string, 'must-pick' | 'cannot-pick' | 'fill'>();
  rows.forEach(r => rowStrategies.set(r.id, 'fill'));

  // Exclusive 그룹: 그룹 내 하나만 선택, 나머지는 선택 금지
  for (const groupRowIds of exclusiveGroups) {
    const chosenRowId = groupRowIds[Math.floor(Math.random() * groupRowIds.length)];
    groupRowIds.forEach(id => {
      rowStrategies.set(id, id === chosenRowId ? 'must-pick' : 'cannot-pick');
    });
  }

  // any-of 그룹: 최소 한 행은 보장
  for (const groupRowIds of anyOfGroups) {
    const alreadyPicked = groupRowIds.some(id => rowStrategies.get(id) === 'must-pick');
    if (alreadyPicked) continue;
    const candidates = groupRowIds.filter(id => rowStrategies.get(id) !== 'cannot-pick');
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    if (chosen) rowStrategies.set(chosen, 'must-pick');
  }

  // required / forbidden 은 최우선
  requiredRows.forEach(id => rowStrategies.set(id, 'must-pick'));
  forbiddenRows.forEach(id => rowStrategies.set(id, 'cannot-pick'));

  // 각 행별로 셀 데이터 채우기
  for (const row of rows) {
    const strategy = rowStrategies.get(row.id) ?? 'fill';
    if (strategy === 'cannot-pick') continue;
    fillRowCells(row, tableResponse, strategy === 'must-pick', collectOptionText);
  }

  return tableResponse;
}

function fillRowCells(
  row: any,
  tableResponse: Record<string, any>,
  mustPick: boolean,
  collectOptionText: (opt: any) => void
) {
  for (const cell of row.cells ?? []) {
    if (['text', 'image', 'video'].includes(cell.type)) continue;

    let value: any = null;

    if (cell.type === 'radio') {
      // 라디오 그리드: 보이는 행은 항상 하나 선택 (완료 응답 가정)
      if (cell.radioOptions && cell.radioOptions.length > 0) {
        const opt = cell.radioOptions[Math.floor(Math.random() * cell.radioOptions.length)];
        // 표 radio/select 응답의 정본 형태 — table-cell-semantics.unwrapOptionId 가 인정하는 { optionId }
        value = { optionId: opt.id };
        collectOptionText(opt);
      }
    } else if (cell.type === 'checkbox') {
      // 체크박스 그리드가 과밀해지지 않도록, 필수 행이 아니면 절반 정도만 체크 행으로 남긴다
      if (cell.checkboxOptions && cell.checkboxOptions.length > 0 && (mustPick || Math.random() < 0.5)) {
        const count = Math.floor(Math.random() * cell.checkboxOptions.length) + 1;
        const shuffled = [...cell.checkboxOptions].sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, count);
        value = selected.map((opt: any) => ({ optionId: opt.id }));
        selected.forEach(collectOptionText);
      }
    } else if (cell.type === 'select') {
      if (cell.selectOptions && cell.selectOptions.length > 0) {
        const opt = cell.selectOptions[Math.floor(Math.random() * cell.selectOptions.length)];
        value = { optionId: opt.id };
        collectOptionText(opt);
      }
    } else if (cell.type === 'input') {
      value = cell.inputType === 'number'
        ? String(Math.floor(Math.random() * 100) + 1)
        : `텍스트 ${Math.floor(Math.random() * 100)}`;
    }

    if (value) {
      tableResponse[cell.id] = value;
    }
  }
}

/**
 * 생성된 응답을 진행 지점(allowedQuestionIds)까지 잘라낸다.
 * __optTexts__ 사이드카도 허용된 질문 것만 남긴다 — 시드 스크립트의 drop/in_progress 절단용.
 */
export function truncateFakeResponses(
  responses: Record<string, any>,
  allowedQuestionIds: Set<string>,
): Record<string, any> {
  const truncated: Record<string, any> = Object.fromEntries(
    Object.entries(responses).filter(
      ([qid]) => qid !== OPT_TEXTS_KEY && allowedQuestionIds.has(qid),
    ),
  );

  const optTexts = responses[OPT_TEXTS_KEY] as Record<string, Record<string, string>> | undefined;
  if (optTexts) {
    const kept = Object.fromEntries(
      Object.entries(optTexts).filter(([qid]) => allowedQuestionIds.has(qid)),
    );
    if (Object.keys(kept).length > 0) truncated[OPT_TEXTS_KEY] = kept;
  }

  return truncated;
}
