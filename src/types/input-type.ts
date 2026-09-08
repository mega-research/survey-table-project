/**
 * 입력 칸의 입력 모드 — 단답형 문항 · 표 input 셀 · 보기 상세기재가 공유한다.
 *
 * 이 유니온이 여섯 자리(`Question.inputType` · `TableCell.inputType` ·
 * `QuestionOption`/`CheckboxOption`/`RadioOption`/`TableCell` 의 `textInputType`)에
 * 리터럴로 복붙돼 있던 것을 한 곳으로 모은 것이다. 값이 늘 때 한 줄만 고치면 되고,
 * 문자열로 되받아 캐스트하는 자리(행→Question 매퍼 · 셀 직렬화 · 발행 스냅샷 ·
 * 쿼터 화면)도 같은 타입을 참조해 컴파일러가 누락을 호명한다.
 *
 * DB 는 열려 있다 — `questions.input_type` 은 enum 도 CHECK 도 없는 text 컬럼이고
 * 셀·보기의 `textInputType` 은 JSONB 안이다. 경계 검증은 zod 스키마가 한다.
 */
export const INPUT_TYPES = ['text', 'number'] as const;

export type InputType = (typeof INPUT_TYPES)[number];

export function isInputType(value: unknown): value is InputType {
  return typeof value === 'string' && (INPUT_TYPES as readonly string[]).includes(value);
}
