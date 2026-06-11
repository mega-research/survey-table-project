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
