/**
 * pino redact 경로 목록 (2차 안전망).
 *
 * 1차 방어선은 allowlist 관례다 — 로그에는 id·건수·경로만 바인딩하고 JSONB 컨테이너·
 * 응답값·PII 평문을 애초에 싣지 않는다. 이 목록은 실수로 실렸을 때의 검열막이다.
 *
 * 주의:
 * - pino 와일드카드는 1-depth (`*.attrs` 는 `a.b.attrs` 를 못 잡는다). 깊은 중첩은
 *   redact 로 방어할 수 없으므로 allowlist 관례가 본질이다.
 * - 메시지 문자열 보간(`` `... ${email}` ``)은 검열 불가 — 값은 반드시 구조화 필드로.
 * - `name` 은 PII fieldType 이지만 템플릿명·파일명·캠페인명과 광범위하게 충돌해 제외.
 *   사람 이름은 로그에 싣지 않는 것이 원칙이다.
 * - `ip` 는 로그 스키마의 "어디서" 필드로 의도적으로 기록한다 — redact 대상 아님.
 */
export const REDACT_PATHS: string[] = [
  // JSONB / 응답값 컨테이너 — 내용 전체 검열
  'attrs',
  '*.attrs',
  'questionResponses',
  '*.questionResponses',
  'answers',
  '*.answers',
  'textValue',
  '*.textValue',
  'arrayValue',
  '*.arrayValue',
  'objectValue',
  '*.objectValue',

  // 컨택 PII 암호화 3종 세트
  'cipher',
  '*.cipher',
  'blindIndex',
  '*.blindIndex',
  'maskHint',
  '*.maskHint',

  // 메일/컨택 스냅샷·토큰 (이메일 평문 + 사칭 가능 토큰)
  'emailSnapshot',
  '*.emailSnapshot',
  'inviteTokenSnapshot',
  '*.inviteTokenSnapshot',
  'inviteToken',
  '*.inviteToken',
  'unsubscribeToken',
  '*.unsubscribeToken',

  // PII fieldType 계열 평문 키 (복호화 결과·webhook payload 등에서 등장 가능)
  'email',
  '*.email',
  'mobile',
  '*.mobile',
  'phone',
  '*.phone',
  'address',
  '*.address',
  'bizNumber',
  '*.bizNumber',
  'biz_number',
  '*.biz_number',
  'representative',
  '*.representative',

  // HTTP 표준
  'req.headers.cookie',
  'req.headers.authorization',
];
