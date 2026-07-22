import { beforeEach, describe, expect, it, vi } from 'vitest';

const capturedSets: Array<Record<string, unknown>> = [];

vi.mock('@/db', () => {
  const tx = {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: () => ({ for: async () => [{ enabled: true }] }),
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        capturedSets.push(values);
        return { where: async () => undefined };
      },
    })),
  };
  return {
    db: {
      update: tx.update,
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    },
  };
});

import { updateContactColumns } from './contact-columns.service';

describe('updateContactColumns 현재 스코프', () => {
  beforeEach(() => {
    capturedSets.length = 0;
  });

  it('현재 테스트 모드면 테스트 전용 컬럼 스킴만 저장한다', async () => {
    const scheme = {
      version: 1,
      headerRow: 1,
      columns: [{ key: 'resid', label: '번호', source: 'system.resid' as const, order: 1 }],
    };

    await updateContactColumns({ surveyId: 'sv-1', scheme });

    expect(capturedSets).toEqual([{ testContactColumns: scheme }]);
  });
});
