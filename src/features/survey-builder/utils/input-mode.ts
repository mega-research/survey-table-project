/**
 * 단답형 문항의 입력 모드 전환 — 숫자 모드와 입력 형식은 **배타**다.
 *
 * 숫자 모드는 천단위 구분·범위·초기값·수식 피연산자를 다루는데 전화번호에는 하이픈이
 * 들어간다. 한 칸이 둘 다일 수 없으므로, 형식으로 넘어가거나 아예 끌 때 숫자 전용
 * 설정을 함께 버린다. 빌더 두 컨트롤(형식 선택·"숫자만 입력" 체크박스)이 같은 전환을
 * 쓰도록 함수 하나로 둔다 — 각자 지우면 한쪽에만 잔재가 남는다.
 */
import type { InputType } from '@/types/input-type';
import type { Question } from '@/types/survey';

type InputModeFields = Pick<Question, 'inputType' | 'emptyDefault' | 'numberFormat'>;

export function applyInputTypeChange<T extends InputModeFields>(prev: T, next: InputType): T {
  const draft: T = { ...prev, inputType: next };
  if (next !== 'number') {
    delete draft.emptyDefault;
    delete draft.numberFormat;
  }
  return draft;
}
