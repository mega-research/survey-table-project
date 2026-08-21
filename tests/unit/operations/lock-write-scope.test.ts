import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lockWriteScope } from '@/lib/operations/data-scope.server';

// lockWriteScope 는 주입된 executor(tx 또는 db)만 쓴다 — 전역 db 는 로드만 막는다.
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guest-viewer', () => ({ isGuestViewer: vi.fn() }));

interface Captured {
  selection: Record<string, unknown> | null;
  lock: string | null;
  limit: number | null;
}

/** select(...).from(surveys).where(...).for(mode) | .limit(n) 체인 stub — 호출 형태를 캡처한다. */
function makeExecutor(rows: Array<Record<string, unknown>>) {
  const captured: Captured = { selection: null, lock: null, limit: null };
  const executor = {
    select: vi.fn((selection: Record<string, unknown>) => {
      captured.selection = selection;
      return {
        from: () => ({
          where: () => ({
            for: async (mode: string) => {
              captured.lock = mode;
              return rows;
            },
            limit: async (n: number) => {
              captured.limit = n;
              return rows;
            },
          }),
        }),
      };
    }),
  };
  return { executor: executor as never, captured };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

describe('lockWriteScope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lock:'update' 는 FOR UPDATE 로 잠그고 어드민은 전역 플래그를 그대로 파티션으로 쓴다", async () => {
    const { executor, captured } = makeExecutor([{ enabled: true }]);

    const locked = await lockWriteScope(executor, SURVEY_ID, false, { lock: 'update' });

    expect(captured.lock).toBe('update');
    expect(captured.limit).toBeNull();
    expect(locked).toEqual({ isTest: true, scope: 'test', row: { enabled: true } });
  });

  it("lock:'share' 는 FOR SHARE 로 잠근다", async () => {
    const { executor, captured } = makeExecutor([{ enabled: false }]);

    const locked = await lockWriteScope(executor, SURVEY_ID, false, { lock: 'share' });

    expect(captured.lock).toBe('share');
    expect(locked).toEqual({ isTest: false, scope: 'real', row: { enabled: false } });
  });

  it("lock:'none' 은 잠그지 않고 limit(1) 조회만 한다", async () => {
    const { executor, captured } = makeExecutor([{ enabled: true }]);

    const locked = await lockWriteScope(executor, SURVEY_ID, false, { lock: 'none' });

    expect(captured.lock).toBeNull();
    expect(captured.limit).toBe(1);
    expect(locked?.isTest).toBe(true);
  });

  it('게스트는 전역 테스트 모드 ON 이어도 real 파티션으로 확정된다', async () => {
    const { executor } = makeExecutor([{ enabled: true }]);

    const locked = await lockWriteScope(executor, SURVEY_ID, true, { lock: 'update' });

    expect(locked).toEqual({ isTest: false, scope: 'real', row: { enabled: true } });
  });

  it('설문 행이 없으면 throw 하지 않고 null 을 돌려준다 — 에러 계약은 호출부 소관', async () => {
    const { executor } = makeExecutor([]);

    await expect(
      lockWriteScope(executor, SURVEY_ID, false, { lock: 'update' }),
    ).resolves.toBeNull();
  });

  it('columns 로 요청한 surveys 컬럼을 enabled 와 함께 투영하고 row 로 그대로 돌려준다', async () => {
    const scheme = { version: 1, headerRow: 1, columns: [] };
    const { executor, captured } = makeExecutor([
      { enabled: true, contactColumns: null, testContactColumns: scheme },
    ]);

    const locked = await lockWriteScope(executor, SURVEY_ID, false, {
      lock: 'update',
      columns: ['contactColumns', 'testContactColumns'],
    });

    expect(Object.keys(captured.selection ?? {})).toEqual([
      'enabled',
      'contactColumns',
      'testContactColumns',
    ]);
    expect(locked?.row.testContactColumns).toEqual(scheme);
    expect(locked?.row.contactColumns).toBeNull();
  });
});
