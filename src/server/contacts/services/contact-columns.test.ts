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

import { updateContactColumns } from './contact-columns';

// 이 브라우저가 「테스트 모드로 보기」를 켠 상태 — 전역 테스트 모드가 켜지면 콘솔이 테스트 파티션을 본다.
// (쿠키가 없으면 전역 플래그가 켜져 있어도 실데이터다 — server/data-scope)
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name.startsWith('ops-test-view-') ? { name, value: '1' } : undefined),
  }),
}));

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

  it('메일 표시(showInMail)는 attrs·pii 컬럼에 저장되고, 시스템ID 는 끈 값(false)이 저장된다', async () => {
    const scheme = {
      version: 1,
      headerRow: 1,
      columns: [
        { key: 'resid', label: '시스템ID', source: 'system.resid' as const, order: 1, showInMail: false },
        { key: '리스트ID', label: '리스트ID', source: 'attrs.리스트ID' as const, order: 2, showInMail: true },
        { key: '대표자명', label: '대표자명', source: 'pii.대표자명' as const, order: 3, showInMail: true },
      ],
    };

    await updateContactColumns({ surveyId: 'sv-1', scheme });

    expect(capturedSets).toEqual([{ testContactColumns: scheme }]);
  });

  it('메일 표시는 운영 컬럼에 걸면 거부한다 — 메일 표에 따로 있는 열', async () => {
    const scheme = {
      version: 1,
      headerRow: 1,
      columns: [
        { key: 'web', label: 'web', source: 'system.web' as const, order: 1, showInMail: true },
      ],
    };

    await expect(updateContactColumns({ surveyId: 'sv-1', scheme })).rejects.toThrow(
      '메일 표시는 명단 속성·개인정보·시스템ID 열에만 지정할 수 있습니다.',
    );
    expect(capturedSets).toEqual([]);
  });
});
