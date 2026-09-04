/**
 * 이월 값 프리필 판정 — CONTEXT.md > 추적조사 참조.
 *
 * 문항별 변동 확인이 **꺼진** 설문에서 이월 값이 이번 회차 응답으로 넘어가는 경로다.
 * 켜진 설문은 이 모듈을 쓰지 않는다 — 그쪽은 응답자가 변동 여부를 밝히는 순간
 * 문항 단위로 복사한다(`resolveAnswerOnConfirmation`).
 *
 * **표시되는 문항에만 깐다.** 숨은 문항의 값을 걸러내는 지점이 저장 경계에 없어서,
 * 전 문항에 한꺼번에 깔면 앞 문항에서 "해당 없음"을 고른 사람에게 지난 회차 하위 답이
 * 그대로 실려 나간다. 호출부가 그 단계의 표시 가능 문항만 넘긴다
 * (`collectUnconfirmedQuestionIds` 와 같은 계약).
 *
 * **이미 값이 있으면 덮지 않는다.** 응답자가 고친 값이 프리필에 밀리면 안 되고,
 * 재진입 복원으로 되살아난 값도 마찬가지다.
 */
import { supportsChangeConfirmation } from '@/lib/survey/change-confirmation';
import { type PriorAnswers, hasPriorAnswer } from '@/lib/survey/prior-answers';
import type { Question } from '@/types/survey';

/** 프리필로 써야 할 문항 하나. */
export interface PriorAnswerPrefillEntry {
  questionId: string;
  value: unknown;
}

/**
 * 이 단계에서 이월 값으로 채울 문항을 문항 순서대로 낸다.
 *
 * 대상 판정은 변동 확인이 켜진 경로와 **같은 술어**를 쓴다 — 안내문처럼 답이 없는 유형과
 * 본문 프리필 템플릿이 걸린 문항(이월 요약 채널이라 템플릿 값이 이긴다)은 양쪽 다 제외다.
 * 술어가 갈라지면 스위치를 켰다 껐다 할 때 채워지는 문항 집합이 달라진다.
 *
 * @param questions **이미 표시 조건으로 걸러진** 문항 목록
 * @param prior 이월 응답 한 벌. 없으면 빈 배열
 * @param responses 현재 응답 묶음. 값이 이미 있는 문항은 건너뛴다
 */
export function collectPriorAnswerPrefills(
  questions: readonly Question[],
  prior: PriorAnswers | null | undefined,
  responses: Record<string, unknown>,
): PriorAnswerPrefillEntry[] {
  if (!prior) return [];
  const entries: PriorAnswerPrefillEntry[] = [];
  for (const question of questions) {
    if (!supportsChangeConfirmation(question)) continue;
    // 빈 값은 이월 값이 아니다 — 키만 있고 답이 없는 문항까지 채우면 응답자가 손대지
    // 않은 빈칸이 "지난 회차 답"으로 제출된다.
    if (!hasPriorAnswer(prior, question.id)) continue;
    if (responses[question.id] !== undefined) continue;
    entries.push({ questionId: question.id, value: prior[question.id] });
  }
  return entries;
}

/** 키 순서에 흔들리지 않는 값 비교용 직렬화. 응답값은 JSON 안전한 형태만 담긴다. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(',')}}`;
}

/**
 * 표시 조건으로 숨겨진 문항에서 **손대지 않은** 이월 값을 걷어낸 응답 묶음을 낸다.
 *
 * 프리필은 채우는 시점의 표시 문항만 보므로, 그 뒤에 응답자가 앞 문항을 바꿔 하위 문항이
 * 숨겨지면 지난 회차 값이 남는다. 앞 문항에서 "해당 없음"을 고른 사람에게 작년 하위 답이
 * 실려 나가는 것이 정확히 그 사고다.
 *
 * **손댄 값은 남긴다.** 판정 기준은 "지금 값이 이월 값과 같은가" 하나다 — 프리필 값 자체가
 * 지문이라 따로 추적할 것이 없다. 응답자가 고쳤다면 값이 달라져 있고, 그건 숨겨졌더라도
 * 응답자가 실제로 한 답이므로 기존 동작(수기 답변은 숨겨져도 남는다)과 같게 둔다.
 *
 * 스위치가 켜진 설문에는 쓰지 않는다 — 그쪽은 확인을 밝힌 문항만 값이 복사되고, 숨은 문항은
 * 확인 대상에서 빠져 애초에 값이 생기지 않는다.
 *
 * @param visibleQuestionIds 지금 표시되는 문항 id 집합
 */
export function dropHiddenUntouchedPriorAnswers(
  responses: Record<string, unknown>,
  visibleQuestionIds: ReadonlySet<string>,
  prior: PriorAnswers | null | undefined,
): Record<string, unknown> {
  if (!prior) return responses;
  let dropped = false;
  const next: Record<string, unknown> = {};
  for (const [questionId, value] of Object.entries(responses)) {
    if (
      !visibleQuestionIds.has(questionId) &&
      hasPriorAnswer(prior, questionId) &&
      stableStringify(value) === stableStringify(prior[questionId])
    ) {
      dropped = true;
      continue;
    }
    next[questionId] = value;
  }
  // 걷어낼 것이 없으면 원본 참조를 그대로 돌려준다 — 호출부의 메모 의존을 흔들지 않는다.
  return dropped ? next : responses;
}
