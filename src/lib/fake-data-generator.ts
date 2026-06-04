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
export function generateFakeSurveyResponse(survey: Survey): Record<string, any> {
  const responses: Record<string, any> = {};
  const questions = survey.questions;
  let currentIndex = 0;

  // 무한 루프 방지용 (최대 질문 수의 2배까지만 순회)
  let loopCount = 0;
  const maxLoops = questions.length * 2;

  while (currentIndex >= 0 && currentIndex < questions.length && loopCount < maxLoops) {
    loopCount++;
    const question = questions[currentIndex];

    // 1. 질문이 현재 응답 상태에서 표시되어야 하는지 확인
    const isVisible = shouldDisplayQuestion(
      question,
      responses,
      questions,
      survey.groups
    );

    if (isVisible) {
      // 2. 랜덤 응답 생성
      const responseValue = generateRandomValueForQuestion(question, responses);

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

  return responses;
}

/**
 * 개별 질문에 대한 랜덤 값을 생성합니다.
 */
function generateRandomValueForQuestion(
  question: Question,
  allResponses: Record<string, any>
): any {
  switch (question.type) {
    case 'radio':
    case 'select': // 단일 선택
      return pickRandomOptionValue(question.options);

    case 'checkbox':
    case 'multiselect': // 다중 선택
      return pickRandomMultipleOptionValues(question.options);

    case 'text':
      return `테스트 응답 ${Math.floor(Math.random() * 1000)}`;

    case 'textarea':
      return `테스트 서술형 응답입니다. 랜덤 숫자: ${Math.floor(Math.random() * 1000)}`;

    case 'table':
      return generateRandomTableResponse(question, allResponses);

    case 'notice':
      return null; // 공지사항은 응답 없음

    default:
      return null;
  }
}

/**
 * 옵션 중 하나를 랜덤하게 선택 (Radio, Select)
 */
function pickRandomOptionValue(options?: QuestionOption[]): string | null {
  if (!options || options.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * options.length);
  return options[randomIndex].value;
}

/**
 * 옵션 중 여러 개를 본포에 따라 랜덤하게 선택 (Checkbox, Multiselect)
 */
function pickRandomMultipleOptionValues(options?: QuestionOption[]): string[] {
  if (!options || options.length === 0) return [];

  // 최소 1개 이상 선택하도록 설정 (필수라고 가정)
  // 30% 확률로 1개, 40% 확률로 2개, 30% 확률로 3개 이상 등 랜덤성 부여
  const countToPick = Math.max(1, Math.floor(Math.random() * Math.min(3, options.length)) + 1);

  // 셔플 후 앞에서부터 n개 선택
  const shuffled = [...options].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, countToPick).map(opt => opt.value);
}

/**
 * 테이블 질문에 대한 랜덤 응답 생성 (가장 복잡함)
 * TableValidationRule을 준수해야 함.
 */
function generateRandomTableResponse(
  question: Question,
  _allResponses: Record<string, any>
): Record<string, any> {
  if (!question.tableRowsData) return {};

  const tableResponse: Record<string, any> = {};
  const rows = question.tableRowsData;
  const validationRules = question.tableValidationRules || [];

  // 1. "체크해야 할 행"과 "체크하면 안 되는 행"을 결정하기 위한 전략 수립
  // 간단한 휴리스틱: exclusive-check 룰이 있으면 그 중 하나만 선택

  // 규칙 분석: exclusive-check 그룹 찾기
  const exclusiveGroups: string[][] = [];
  const requiredRows: string[] = [];

  for (const rule of validationRules) {
    if (rule.type === 'exclusive-check') {
      // conditions.rowIds가 상호 배타적 그룹임
      exclusiveGroups.push(rule.conditions.rowIds);
    } else if (rule.type === 'required-combination') {
      // 이 행들은 모두 선택되어야 함 (단, 로직상 visible할 때)
      rule.conditions.rowIds.forEach(id => {
        if (!requiredRows.includes(id)) requiredRows.push(id);
      });
    }
  }

  // 행별 처리 전략 결정
  const rowStrategies = new Map<string, 'must-pick' | 'cannot-pick' | 'random'>();

  // 기본은 random
  rows.forEach(r => rowStrategies.set(r.id, 'random'));

  // Exclusive 그룹 처리
  for (const groupRowIds of exclusiveGroups) {
    // 그룹 내에서 랜덤하게 하나 선택
    const chosenRowId = groupRowIds[Math.floor(Math.random() * groupRowIds.length)];

    groupRowIds.forEach(id => {
      if (id === chosenRowId) {
        rowStrategies.set(id, 'must-pick');
      } else {
        rowStrategies.set(id, 'cannot-pick');
      }
    });
  }

  // Required 처리 (Exclusive보다 우선순위가 높거나 충돌 시 로직 점검 필요하지만, 일단 덮어씀)
  requiredRows.forEach(id => rowStrategies.set(id, 'must-pick'));

  // 2. 각 행별로 셀 데이터 채우기
  for (const row of rows) {
    // 행이 표시 조건에 의해 숨겨져야 하면 스킵 (shouldDisplayRow가 있다면 사용, 없으면 일단 진행)
    // 여기서는 간단히 행 내부 셀들을 채움

    const strategy = rowStrategies.get(row.id) || 'random';

    // cannot-pick이면 스킵
    if (strategy === 'cannot-pick') continue;

    // random이면 50% 확률로 스킵 (테이블이 너무 꽉 차지 않게)
    // 하지만 테이블 질문 자체가 필수라면 최소 하나는 있어야 하는데...
    // 여기서는 단순화를 위해 random인 경우 30% 확률로 선택한다고 가정
    if (strategy === 'random' && Math.random() > 0.3) continue;

    // 행 채우기
    fillRowCells(row, tableResponse);
  }

  // 만약 테이블이 필수인데 아무것도 선택 안 됐으면?
  // (여기서는 생략, 추후 보완)

  return tableResponse;
}

function fillRowCells(row: any, tableResponse: Record<string, any>) {
  for (const cell of row.cells) {
    if (['text', 'image', 'video'].includes(cell.type)) continue;

    let value: any = null;

    if (cell.type === 'radio') {
      // 라디오: 옵션 중 하나 랜덤 선택
      if (cell.radioOptions && cell.radioOptions.length > 0) {
        const opt = cell.radioOptions[Math.floor(Math.random() * cell.radioOptions.length)];
        // 테이블은 보통 optionId를 저장함 (branch-logic 참조)
        // 하지만 branch-logic.ts를 보면 value 저장 방식이 혼용되어 있을 수 있음.
        // types/survey.ts 의 SurveyResponse는 value가 string | string[] 등임.
        // table value는 { "cellId": "optionId" } 형태가 일반적임.
        value = { optionId: opt.id }; // 중요: 테이블 컴포넌트 구현에 따라 다름. 보통 optionId 저장.
      }
    } else if (cell.type === 'checkbox') {
      // 체크박스: 옵션 중 랜덤 선택
      if (cell.checkboxOptions && cell.checkboxOptions.length > 0) {
        // 1개 이상 랜덤 선택
        const count = Math.floor(Math.random() * cell.checkboxOptions.length) + 1;
        const shuffled = [...cell.checkboxOptions].sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, count);
        value = selected.map(opt => ({ optionId: opt.id }));
      }
    } else if (cell.type === 'select') {
      if (cell.selectOptions && cell.selectOptions.length > 0) {
        const opt = cell.selectOptions[Math.floor(Math.random() * cell.selectOptions.length)];
        value = { optionId: opt.id };
      }
    } else if (cell.type === 'input') {
      value = `텍스트 ${Math.floor(Math.random() * 100)}`;
    }

    if (value) {
      tableResponse[cell.id] = value;
    }
  }
}
