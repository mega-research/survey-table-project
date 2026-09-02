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

  it('resid 컬럼 숨김도 허용된다 — 고객 NO 컬럼이 식별자 역할을 대신할 수 있음', async () => {
    const scheme = {
      version: 1,
      headerRow: 1,
      columns: [
        { key: 'resid', label: '시스템ID', source: 'system.resid' as const, order: 1, hidden: true },
        { key: 'c1', label: 'NO', source: 'attrs.NO' as const, order: 2 },
      ],
    };

    await updateContactColumns({ surveyId: 'sv-1', scheme });

    expect(capturedSets).toEqual([{ testContactColumns: scheme }]);
  });

  it('메일 표시(showInMail)는 attrs 컬럼에 저장된다', async () => {
    const scheme = {
      version: 1,
      headerRow: 1,
      columns: [
        { key: 'resid', label: '시스템ID', source: 'system.resid' as const, order: 1 },
        { key: '리스트ID', label: '리스트ID', source: 'attrs.리스트ID' as const, order: 2, showInMail: true },
      ],
    };

    await updateContactColumns({ surveyId: 'sv-1', scheme });

    expect(capturedSets).toEqual([{ testContactColumns: scheme }]);
  });

  it('메일 표시는 시스템·pii 컬럼에 걸면 거부한다 — attrs 에 값이 없어 표시 불가', async () => {
    const scheme = {
      version: 1,
      headerRow: 1,
      columns: [
        { key: 'resid', label: '시스템ID', source: 'system.resid' as const, order: 1, showInMail: true },
      ],
    };

    await expect(updateContactColumns({ surveyId: 'sv-1', scheme })).rejects.toThrow(
      '메일 표시는 명단 속성(attrs) 컬럼에만 지정할 수 있습니다.',
    );
    expect(capturedSets).toEqual([]);
  });
});
