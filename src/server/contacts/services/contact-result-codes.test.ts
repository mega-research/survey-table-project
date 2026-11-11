import { beforeEach, describe, expect, it, vi } from 'vitest';

const capturedSets: Array<Record<string, unknown>> = [];

vi.mock('@/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        capturedSets.push(values);
        return { where: async () => undefined };
      },
    })),
  },
}));

import type { ContactResultCode } from '@/shared/contracts/contacts';

import { updateResultCodes } from './contact-result-codes';

describe('updateResultCodes 목록 행 표시', () => {
  beforeEach(() => {
    capturedSets.length = 0;
  });

  it('rowMark 세 값은 그대로 저장된다', async () => {
    const codes: ContactResultCode[] = [
      { code: '1.조사완료', label: '1.조사완료', order: 1, status: 'positive', rowMark: 'done' },
      { code: '수신거부', label: '수신거부', order: 2, rowMark: 'out' },
      { code: '4.부재', label: '4.부재', order: 3, rowMark: 'none' },
      { code: '5.출장', label: '5.출장', order: 4 },
    ];

    await updateResultCodes('sv-1', codes);

    expect(capturedSets).toEqual([{ contactResultCodes: codes }]);
  });

  it('모르는 rowMark 값은 저장 전에 거부한다', async () => {
    const codes = [
      { code: '수신거부', label: '수신거부', order: 1, rowMark: 'red' },
    ] as unknown as ContactResultCode[];

    await expect(updateResultCodes('sv-1', codes)).rejects.toThrow(
      '목록 행 표시 값이 올바르지 않습니다.',
    );
    expect(capturedSets).toEqual([]);
  });

  it('null(기본 코드셋 복귀)은 그대로 저장된다', async () => {
    await updateResultCodes('sv-1', null);
    expect(capturedSets).toEqual([{ contactResultCodes: null }]);
  });
});
