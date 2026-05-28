import { describe, expect, it } from 'vitest';

import { extractResultCodeStatuses } from '@/lib/operations/result-code-statuses';
import { DEFAULT_RESULT_CODES, type ContactResultCode } from '@/db/schema/schema-types';

describe('extractResultCodeStatuses', () => {
  it('DEFAULT 13개에서 positive=[1.조사완료], negative=[수신거부]', () => {
    const result = extractResultCodeStatuses(DEFAULT_RESULT_CODES);
    expect(result.positive).toEqual(['1.조사완료']);
    expect(result.negative).toEqual(['수신거부']);
  });

  it('NULL 사용자 정의 안 함 → DEFAULT 적용', () => {
    const result = extractResultCodeStatuses(null);
    expect(result.positive).toEqual(['1.조사완료']);
    expect(result.negative).toEqual(['수신거부']);
  });

  it('명시 status 가 fallback 우선 — 수신거부를 neutral 로 재정의', () => {
    const codes: ContactResultCode[] = [
      { code: '1.조사완료', label: '1.조사완료', order: 1, status: 'positive' },
      { code: '수신거부', label: '수신거부', order: 2, status: 'neutral' },
    ];
    const result = extractResultCodeStatuses(codes);
    expect(result.positive).toEqual(['1.조사완료']);
    expect(result.negative).toEqual([]);
  });

  it('backward compat fallback — status 없고 code=1.조사완료 → positive', () => {
    const codes: ContactResultCode[] = [
      { code: '1.조사완료', label: '1.조사완료', order: 1 },
      { code: '2.재통화예약', label: '2.재통화예약', order: 2 },
    ];
    const result = extractResultCodeStatuses(codes);
    expect(result.positive).toEqual(['1.조사완료']);
    expect(result.negative).toEqual([]);
  });

  it('명시 status 가 fallback 우선 — 1.조사완료를 negative 로 재정의', () => {
    const codes: ContactResultCode[] = [
      { code: '1.조사완료', label: '1.조사완료', order: 1, status: 'negative' },
      { code: '커스텀완료', label: '커스텀완료', order: 2, status: 'positive' },
    ];
    const result = extractResultCodeStatuses(codes);
    expect(result.positive).toEqual(['커스텀완료']);
    expect(result.negative).toEqual(['1.조사완료']);
  });

  it('순서 보존', () => {
    const codes: ContactResultCode[] = [
      { code: 'X', label: 'X', order: 1, status: 'positive' },
      { code: 'A', label: 'A', order: 2, status: 'positive' },
      { code: 'M', label: 'M', order: 3, status: 'negative' },
      { code: 'B', label: 'B', order: 4, status: 'negative' },
    ];
    const result = extractResultCodeStatuses(codes);
    expect(result.positive).toEqual(['X', 'A']);
    expect(result.negative).toEqual(['M', 'B']);
  });
});
