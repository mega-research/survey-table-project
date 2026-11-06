import type { Question, QuestionConditionGroup } from '@/types/survey';

/**
 * 문항 안의 모든 조건 묶음(`QuestionConditionGroup`) 자리를 한 곳에서 돈다 — 빌더의 보기 value 리매핑과 임시 문항 id
 * 리매핑이 이 함수 하나로 조건을 옮긴다.
 *
 * 자리를 손으로 나열하던 시절, 새로 생긴 조건(행 반복 블록 표시·펼쳐 둘 조건, 표 제약의 다른 문항 조건)이 리매핑에서
 * 빠져 옛 값·임시 id 를 계속 가리켰다(2026-11-06). 이월값 불러오기 조건과 동적 행 그룹 표시 조건도 같은 이유로 빠져
 * 있었다. `Question` 타입에 조건 묶음 필드를 새로 넣으면 여기에 한 줄을 더할 것 — `question-condition-groups.test.ts`
 * 가 컴파일러로 `Question` 타입을 훑어 이 함수가 돌지 않는 자리를 잡는다.
 *
 * immer draft 를 그 자리에서 바꾼다. 하나라도 바뀌면 true.
 */
export function remapQuestionConditionGroups(
  question: Question,
  remap: (group: QuestionConditionGroup) => QuestionConditionGroup,
): boolean {
  let changed = false;
  const visit = <T extends object, K extends keyof T>(holder: T | undefined | null, key: K) => {
    const group = holder?.[key] as QuestionConditionGroup | undefined;
    if (!holder || !group) return;
    const next = remap(group);
    if (next !== group) {
      holder[key] = next as T[K];
      changed = true;
    }
  };

  visit(question, 'displayCondition');
  visit(question, 'priorAnswerCondition');
  for (const row of question.tableRowsData ?? []) visit(row, 'displayCondition');
  for (const column of question.tableColumns ?? []) visit(column, 'displayCondition');
  for (const config of question.dynamicRowConfigs ?? []) visit(config, 'displayCondition');
  visit(question.rowRepeatConfig, 'displayCondition');
  visit(question.rowRepeatConfig, 'expandWhen');
  for (const constraint of question.sumConstraints ?? []) visit(constraint, 'whenQuestion');
  return changed;
}
