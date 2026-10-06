export const PII_FIELD_TYPES = [
  'email',
  'mobile',
  'phone',
  'name',
  'representative',
  'biz_number',
  'address',
] as const;

export type PiiFieldType = (typeof PII_FIELD_TYPES)[number];

export function isPiiFieldType(value: string): value is PiiFieldType {
  return (PII_FIELD_TYPES as readonly string[]).includes(value);
}

/** PII 타입 → 사용자 표시용 한국어 라벨. UI 컴포넌트는 이 한 곳만 참조. */
export const PII_LABEL_KO: Record<PiiFieldType, string> = {
  email: '이메일',
  mobile: '휴대폰',
  phone: '전화',
  name: '이름',
  representative: '담당자',
  address: '주소',
  biz_number: '사업자번호',
};

export function piiFieldLabel(t: PiiFieldType): string {
  return PII_LABEL_KO[t] ?? t;
}

export function normalizePii(fieldType: PiiFieldType, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  switch (fieldType) {
    case 'email': {
      // 최소 형식 검증: local@domain (각각 1자 이상)
      const lower = trimmed.toLowerCase();
      const at = lower.indexOf('@');
      if (at <= 0 || at === lower.length - 1) return '';
      // domain 에 점 없으면 사실상 무효 (TLD 없음) — blind_index 생성 안 함
      if (!lower.slice(at + 1).includes('.')) return '';
      return lower;
    }
    case 'mobile':
    case 'phone':
    case 'biz_number':
      return trimmed.replace(/[^0-9]/g, '');
    case 'name':
    case 'representative':
    case 'address':
      return trimmed.replace(/\s+/g, ' ');
    default:
      // 경계 스키마가 z.custom 이라 런타임 검증이 없어 union 외 fieldType 이 들어올 수 있음.
      // default 가 없으면 switch 를 빠져나가 undefined 를 반환(타입은 string)하고,
      // blindIndex 가 빈 문자열을 만들어 PII 가 조용히 누락된다. 일반 공백 정규화로 폴백해
      // 함수를 total 하게 만들어 값 유실을 방지한다.
      return trimmed.replace(/\s+/g, ' ');
  }
}

/**
 * 값이 있는데 저장할 수 없는 형식이면 그 이유, 아니면 null.
 *
 * 저장 경로는 「정규화 결과가 빈 값」을 「칸을 비웠다」와 똑같이 다뤄 기존 암호화 행을 지운다.
 * 그래서 `@` 없는 메일을 넣고 저장하면 오류 없이 값이 사라진다. 사람이 값을 넣은 저장(단건 추가·
 * 수정)은 이 판정으로 **저장 전에** 막는다 — 화면과 서버가 같은 함수를 쓴다.
 * 빈 값은 문제가 아니다: 칸을 비우는 것은 지우겠다는 뜻이고 화면이 따로 확인을 받는다.
 * 엑셀 업로드는 이 판정을 쓰지 않는다(형식이 틀린 칸은 종전대로 건너뛴다).
 */
export function piiFormatProblem(fieldType: PiiFieldType, value: string): string | null {
  if (!value.trim()) return null;
  if (normalizePii(fieldType, value)) return null;
  return fieldType === 'email'
    ? '메일 형식이 아닙니다 (예: name@example.com).'
    : '숫자가 없어 저장할 수 없습니다.';
}

/**
 * PII 변경분 묶음에서 저장할 수 없는 칸만 「칸 이름」 + 이유 한 줄씩으로 낸다.
 * `labelOf` 는 칸 이름을 바꿔 붙일 때 쓴다 — 화면은 컬럼 라벨, 서버는 컬럼 키 그대로.
 */
export function describePiiFormatProblems(
  updates: readonly { columnKey: string; fieldType: PiiFieldType; plain: string }[],
  labelOf: (columnKey: string) => string = (columnKey) => columnKey,
): string[] {
  const lines: string[] = [];
  for (const update of updates) {
    const problem = piiFormatProblem(update.fieldType, update.plain);
    if (problem) lines.push(`「${labelOf(update.columnKey)}」 ${problem}`);
  }
  return lines;
}
