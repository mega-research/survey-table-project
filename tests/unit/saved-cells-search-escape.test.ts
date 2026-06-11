import { beforeEach, describe, expect, it, vi } from 'vitest';

// searchSavedCells 가 ILIKE wildcard(% _ \)를 리터럴로 escape 한 뒤
// 패턴을 만드는지 회귀 검증. 실제 PG 연결 없이 drizzle ilike 인자만 캡처한다.
const { mockFindMany, ilikeCalls } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  ilikeCalls: [] as Array<{ column: unknown; pattern: string }>,
}));

vi.mock('@/db', () => ({
  db: {
    query: { savedCells: { findMany: mockFindMany } },
  },
}));

vi.mock('@/db/schema/surveys', () => ({
  savedCells: { name: 'name', updatedAt: 'updatedAt' },
}));

vi.mock('drizzle-orm', () => ({
  desc: (c: unknown) => c,
  eq: () => ({}),
  sql: () => ({}),
  ilike: (column: unknown, pattern: string) => {
    ilikeCalls.push({ column, pattern });
    return { column, pattern };
  },
}));

describe('searchSavedCells ILIKE escape', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([]);
    ilikeCalls.length = 0;
  });

  it('% 와 _ 를 백슬래시로 escape 한 패턴으로 검색한다', async () => {
    const { searchSavedCells } = await import(
      '@/features/library/server/services/saved-cells.service'
    );
    await searchSavedCells('50%_x');

    expect(ilikeCalls).toHaveLength(1);
    // %50\%\_x% — 메타문자가 wildcard 가 아니라 리터럴이 되어야 한다
    expect(ilikeCalls[0]?.pattern).toBe('%50\\%\\_x%');
  });

  it('백슬래시도 escape 한다', async () => {
    const { searchSavedCells } = await import(
      '@/features/library/server/services/saved-cells.service'
    );
    await searchSavedCells('a\\b');

    expect(ilikeCalls[0]?.pattern).toBe('%a\\\\b%');
  });

  it('메타문자가 없으면 그대로 부분일치 패턴을 만든다', async () => {
    const { searchSavedCells } = await import(
      '@/features/library/server/services/saved-cells.service'
    );
    await searchSavedCells('plain');

    expect(ilikeCalls[0]?.pattern).toBe('%plain%');
  });
});
