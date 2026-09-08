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
/**
 * 값의 형식을 검사하는 입력 모드. 응답자가 친 값이 형식에 맞지 않으면 "다음"/제출이
 * 막히고, 통과한 값은 하이픈 포함 정규형으로 저장된다 (파서는 @/utils/input-format).
 *
 * 이름은 컨택 PII 어휘(`@/lib/crypto/pii-fields`)와 **같은 문자열**을 쓴다. 다만
 * 정규화 규칙은 다르다 — PII 는 숫자만 남기고 이쪽은 하이픈을 넣는다. 나중에 응답값과
 * 명단을 대조할 일이 생기면 비교 시점에 양쪽을 `normalizePii` 로 태워 숫자만 남긴다.
 * `corp_number`(법인번호)만 PII 목록에 없는 신규 어휘다.
 */
export const INPUT_FORMATS = ['mobile', 'phone', 'biz_number', 'corp_number', 'email'] as const;

export type InputFormat = (typeof INPUT_FORMATS)[number];

export const INPUT_TYPES = ['text', 'number', ...INPUT_FORMATS] as const;

export type InputType = (typeof INPUT_TYPES)[number];

export function isInputFormat(value: unknown): value is InputFormat {
  return typeof value === 'string' && (INPUT_FORMATS as readonly string[]).includes(value);
}

export function isInputType(value: unknown): value is InputType {
  return typeof value === 'string' && (INPUT_TYPES as readonly string[]).includes(value);
}
