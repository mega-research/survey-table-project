import type { Question } from '@/types/survey';
import { parseNumericInput } from '@/utils/numeric-input';

/**
 * 최대 선택 개수 해석 — 고정값(`maxSelections`) 또는 다른 문항의 숫자 응답(`maxSelectionsSource`).
 *
 * "B2 에 적은 팀 수만큼만 B3 에서 고를 수 있다" 를 담는다. 응답 화면·빌더 미리보기의 선택 가드와
 * 「다음」 차단 검증이 같은 값을 봐야 하므로 판정은 이 함수 하나다.
 *
 * - 출처가 없으면 고정값 그대로.
 * - 참조값을 못 읽으면(미응답·숨은 문항·숫자 아님·1 미만) 고정값으로 폴백한다 — 0 을 상한으로
 *   삼으면 아무것도 고를 수 없어 필수 문항이 영영 막힌다.
 * - 참조값이 `unlimitedFrom` 이상이면 제한 없음(고정값도 무시).
 * - 그 밖에는 참조값(소수는 내림)이 상한이다.
 *
 * @returns 양의 정수 상한, 또는 제한 없음이면 undefined
 */
export function resolveMaxSelections(
  question: Pick<Question, 'maxSelections' | 'maxSelectionsSource'>,
  allResponses: Record<string, unknown> | undefined,
): number | undefined {
  const fixed =
    question.maxSelections !== undefined && question.maxSelections > 0
      ? question.maxSelections
      : undefined;
  const source = question.maxSelectionsSource;
  if (!source?.questionId) return fixed;

  const raw = allResponses?.[source.questionId];
  if (typeof raw !== 'string' || raw.trim() === '') return fixed;
  const parsed = parseNumericInput(raw);
  if (parsed === null) return fixed;
  const count = Math.floor(parsed);
  if (count < 1) return fixed;

  if (source.unlimitedFrom !== undefined && count >= source.unlimitedFrom) return undefined;
  return count;
}

/**
 * 해석된 상한을 `maxSelections` 에 실은 문항을 돌려준다 — 렌더러(일반 체크박스·보기 소스 표)는
 * 고정 숫자만 읽으므로 호출부가 이 한 줄로 갈아 끼우면 표면마다 분기를 넣지 않아도 된다.
 * 출처가 없는 문항은 같은 참조를 그대로 돌려준다.
 */
export function withResolvedMaxSelections(
  question: Question,
  allResponses: Record<string, unknown> | undefined,
): Question {
  if (!question.maxSelectionsSource?.questionId) return question;
  const resolved = resolveMaxSelections(question, allResponses);
  if (resolved === question.maxSelections) return question;
  const { maxSelections: _fixed, ...rest } = question;
  return resolved === undefined ? rest : { ...rest, maxSelections: resolved };
}
