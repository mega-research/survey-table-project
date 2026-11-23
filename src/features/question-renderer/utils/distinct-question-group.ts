import type { Question } from '@/types/survey';

/**
 * 문항 사이의 중복 불가 묶음 — 같은 묶음 이름(`Question.distinctGroup`)을 적은 단일 선택 문항끼리는 같은 보기를
 * 고른 채 「다음」으로 넘어갈 수 없다(CONTEXT.md 「중복 불가 묶음」의 「문항 사이의 중복 불가 묶음」).
 *
 * 표의 선택 칸에 거는 중복 불가 묶음(distinct-select-group)을 문항 단위로 넓힌 것이다. 이름으로 묶고 보기 값으로
 * 비교하는 규칙은 같고, 다른 점은 **화면에서 막지 않는다**는 것 하나다 — 보기는 그대로 다 누를 수 있고 차단 검증
 * (`NumericIssue.kind: 'distinct'`)만 건다. 그래서 판정을 부르는 곳은 차단 검증 하나다.
 *
 * - 대상은 radio·select 문항이고 답이 글자 하나일 때다. 내장 표를 쓰는 문항은 응답값이 칸 id 라 문항끼리 같을 수
 *   없어 자연히 걸리지 않는다. 복수 선택·순위·표 문항은 묶음 이름이 있어도 구성원이 아니다.
 * - 대칭이다 — 겹친 문항 모두가 위반이고, 어느 쪽을 바꿀지는 응답자가 고른다. 문항 순서·쪽 배치를 보지 않는다.
 * - 다른 문항의 답은 응답 전체에서 읽는다. 숨은 문항의 답은 숨는 순간 지워지므로 비교 대상이 아니다
 *   (최대 선택 개수 연동 `resolveMaxSelections` 과 같은 전제).
 * - 보기별 예외는 없다(「기타」도 한 번).
 */

/** 묶음 이름 — 앞뒤 공백을 떼고, 비면 묶음이 없는 것이다 */
function distinctGroupOf(question: Pick<Question, 'type' | 'distinctGroup'>): string | null {
  if (question.type !== 'radio' && question.type !== 'select') return null;
  const name = question.distinctGroup?.trim() ?? '';
  return name === '' ? null : name;
}

/** 단일 선택 문항의 답 — 고른 보기 값 글자. 답이 없으면 null */
function singleAnswerOf(response: unknown): string | null {
  return typeof response === 'string' && response !== '' ? response : null;
}

/**
 * 이 문항의 답이 같은 묶음의 다른 문항 답과 겹치는가.
 *
 * @param allQuestions 설문의 문항 전체 — 같은 묶음의 구성원을 여기서 찾는다
 * @param allResponses 응답 전체(문항 id → 답)
 */
export function hasDistinctQuestionViolation(
  question: Question,
  response: unknown,
  allQuestions: readonly Question[],
  allResponses: Record<string, unknown>,
): boolean {
  const group = distinctGroupOf(question);
  if (group === null) return false;
  const answer = singleAnswerOf(response);
  if (answer === null) return false;
  return allQuestions.some(
    (other) =>
      other.id !== question.id &&
      distinctGroupOf(other) === group &&
      singleAnswerOf(allResponses[other.id]) === answer,
  );
}
