import { beforeEach, describe, expect, it, vi } from 'vitest';

// searchSavedQuestions 가 ILIKE wildcard(% _ \)를 리터럴로 escape 한 뒤
// name/description 양쪽에 동일 패턴을 만드는지 회귀 검증.
// 실제 PG 연결 없이 drizzle ilike 인자만 캡처한다.
const { mockFindMany, ilikeCalls } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  ilikeCalls: [] as Array<{ column: unknown; pattern: string }>,
}));

vi.mock('@/db', () => ({
  db: {
    query: { savedQuestions: { findMany: mockFindMany } },
  },
}));

vi.mock('@/db/schema/surveys', () => ({
  savedQuestions: { name: 'name', description: 'description', updatedAt: 'updatedAt' },
}));

vi.mock('drizzle-orm', () => ({
  desc: (c: unknown) => c,
  eq: () => ({}),
  gt: () => ({}),
  inArray: () => ({}),
  or: (...conds: unknown[]) => conds,
  sql: () => ({}),
  ilike: (column: unknown, pattern: string) => {
    ilikeCalls.push({ column, pattern });
    return { column, pattern };
  },
}));

// searchSavedQuestions 는 아래 모듈을 사용하지 않으나 top-level import 라 stub 필요.
vi.mock('@/lib/image-extractor', () => ({ extractImageUrlsFromQuestion: () => [] }));
vi.mock('@/lib/image-utils-server', () => ({ deleteImagesFromR2Server: vi.fn() }));
vi.mock('@/lib/survey/survey-image-promote', () => ({ promoteSurveyImages: vi.fn() }));
vi.mock('@/lib/utils', () => ({ generateId: () => 'id' }));

describe('searchSavedQuestions ILIKE escape', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([]);
    ilikeCalls.length = 0;
  });

  it('% 와 _ 를 백슬래시로 escape 한 패턴으로 name/description 양쪽을 검색한다', async () => {
    const { searchSavedQuestions } = await import(
      '@/features/library/server/services/saved-questions.service'
    );
    await searchSavedQuestions('50%_x');

    // name + description 두 컬럼에 동일 패턴 적용
    expect(ilikeCalls).toHaveLength(2);
    // %50\%\_x% — 메타문자가 wildcard 가 아니라 리터럴이 되어야 한다
    expect(ilikeCalls[0]?.pattern).toBe('%50\\%\\_x%');
    expect(ilikeCalls[1]?.pattern).toBe('%50\\%\\_x%');
  });

  it('백슬래시도 escape 한다', async () => {
    const { searchSavedQuestions } = await import(
      '@/features/library/server/services/saved-questions.service'
    );
    await searchSavedQuestions('a\\b');

    expect(ilikeCalls[0]?.pattern).toBe('%a\\\\b%');
  });

  it('메타문자가 없으면 그대로 부분일치 패턴을 만든다', async () => {
    const { searchSavedQuestions } = await import(
      '@/features/library/server/services/saved-questions.service'
    );
    await searchSavedQuestions('plain');

    expect(ilikeCalls[0]?.pattern).toBe('%plain%');
  });
});
