import { describe, expect, it } from 'vitest';

import { attemptEditChange } from './contact-target-edit';

const before = {
  resultCode: '13. 독려',
  note: '금일중',
  createdByEmail: 'a@local',
  createdAt: '2026-10-27T00:35:53.000Z',
};

describe('attemptEditChange — 회차 수정·삭제의 변경', () => {
  it('고치기 전·후를 그대로 담는다', () => {
    expect(attemptEditChange(3, before, { resultCode: '3.비수신', note: null })).toEqual({
      kind: 'attempt',
      attemptNo: 3,
      before,
      after: { resultCode: '3.비수신', note: null },
    });
  });

  it('삭제는 after 가 null 이다', () => {
    expect(attemptEditChange(1, before, null)).toEqual({
      kind: 'attempt',
      attemptNo: 1,
      before,
      after: null,
    });
  });

  it('1,000자를 넘는 비고는 1,000자에서 자르고 잘린 쪽에 표식을 단다', () => {
    const long = '가'.repeat(1001);
    expect(
      attemptEditChange(2, { ...before, note: long }, { resultCode: '13. 독려', note: 'x' }),
    ).toEqual({
      kind: 'attempt',
      attemptNo: 2,
      before: { ...before, note: '가'.repeat(1000) },
      after: { resultCode: '13. 독려', note: 'x' },
      beforeTruncated: true,
    });
    expect(attemptEditChange(2, before, { resultCode: '13. 독려', note: long })).toMatchObject({
      after: { note: '가'.repeat(1000) },
      afterTruncated: true,
    });
    expect(attemptEditChange(2, { ...before, note: long }, null)).toMatchObject({
      before: { note: '가'.repeat(1000) },
      beforeTruncated: true,
      after: null,
    });
  });

  it('1,000자 딱 맞는 비고는 자르지 않는다', () => {
    const exact = '나'.repeat(1000);
    const change = attemptEditChange(2, { ...before, note: exact }, null);
    expect(change).toEqual({
      kind: 'attempt',
      attemptNo: 2,
      before: { ...before, note: exact },
      after: null,
    });
  });
});
