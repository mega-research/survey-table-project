/**
 * 엑셀 헤더 (정규화된 한국어) → 시스템 필드 + PII 타입 자동 매칭.
 * 우선순위: 정확 매칭 > 부분 포함.
 *
 * 단위 테스트: tests/unit/domains/contacts/auto-detect.test.ts.
 */

import type { PiiFieldType } from '@/lib/crypto/pii-fields';

const PATTERNS = {
  email: ['이메일', '메일', 'email', 'e-mail', '메일주소'],
  biz: ['사업자등록번호', '사업자번호', '사업자', 'biz'],
  mobile: ['휴대폰번호', '휴대폰', '핸드폰', '모바일', 'mobile', 'cell'],
  phone: ['전화번호', '전화', '유선', '연락처', 'phone', 'tel'],
  name: ['이름', '성명', '담당자', 'name', 'contact name'],
  address: ['주소', '소재지', 'address'],
  group: ['전시회명', '전시회', '캠페인'],
} as const;

export interface AutoDetected {
  group?: number;
}

function findHeader(headers: string[], patterns: readonly string[]): number | undefined {
  for (const p of patterns) {
    const i = headers.findIndex((h) => h === p);
    if (i >= 0) return i;
  }
  for (const p of patterns) {
    const i = headers.findIndex((h) => h.includes(p));
    if (i >= 0) return i;
  }
  return undefined;
}

export function autoDetectSystemFields(headers: string[]): AutoDetected {
  const result: AutoDetected = {};
  const group = findHeader(headers, PATTERNS.group);
  if (group != null) result.group = group;
  return result;
}

/**
 * 헤더 한 줄을 보고 PII 타입을 추정. 매칭 없으면 undefined.
 * mobile 패턴이 phone 패턴보다 먼저 검사돼야 "휴대폰" 이 phone 으로 떨어지지 않음.
 */
export function detectPiiType(header: string): PiiFieldType | undefined {
  const h = header.trim();
  if (!h) return undefined;
  // 정확 매칭 우선
  for (const [type, patterns] of (
    [
      ['email', PATTERNS.email],
      ['biz_number', PATTERNS.biz],
      ['mobile', PATTERNS.mobile],
      ['phone', PATTERNS.phone],
      ['name', PATTERNS.name],
      ['address', PATTERNS.address],
    ] as const
  )) {
    if (patterns.some((p) => p === h)) return type;
  }
  // 부분 포함
  for (const [type, patterns] of (
    [
      ['email', PATTERNS.email],
      ['biz_number', PATTERNS.biz],
      ['mobile', PATTERNS.mobile],
      ['phone', PATTERNS.phone],
      ['name', PATTERNS.name],
      ['address', PATTERNS.address],
    ] as const
  )) {
    if (patterns.some((p) => h.includes(p))) return type;
  }
  return undefined;
}

/**
 * 헤더 배열 → PII 매핑 자동 prefill. 사용자가 검토·수정 가능.
 */
export function autoDetectPiiMapping(headers: string[]): Record<string, PiiFieldType> {
  const result: Record<string, PiiFieldType> = {};
  for (const h of headers) {
    const t = detectPiiType(h);
    if (t) result[h] = t;
  }
  return result;
}
