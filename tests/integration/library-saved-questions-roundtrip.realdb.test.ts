/**
 * saved-questions procedure 실 DB 왕복 integration test
 *
 * 목적: procedure -> service -> 실 PostgreSQL 왕복이 실제로 돈다는 것을 CI에 고정.
 * 나머지 saved-questions unit test는 service를 vi.mock 하므로,
 * z.custom + 캐스팅 기반 거짓안전(타입은 통과하지만 실 DB 필드 매핑 누락)을 잡지 못한다.
 *
 * 실행 조건: DATABASE_URL이 127.0.0.1 또는 localhost를 포함할 때만 동작.
 * prod URL 환경에서는 describe.skipIf로 전체 스킵 -> 일반 pnpm test에서 데이터 오염 없음.
 *
 * 선행 조건: 로컬 supabase 스택 + 19테이블 셋업 완료 (pnpm db:setup-test).
 */

import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// promoteSurveyImages는 R2 호출(CLOUDFLARE_R2_PUBLIC_URL 필수 + 실제 S3 연결)을 포함한다.
// 이 test는 DB 왕복만 검증하므로 이미지 promote를 passthrough stub으로 대체한다.
vi.mock('@/lib/survey/survey-image-promote', () => ({
  promoteSurveyImages: async <T>(questions: T[]): Promise<T[]> => questions,
}));

// deleteImagesFromR2Server도 R2 연결이 필요하므로 no-op stub으로 대체.
vi.mock('@/lib/image-utils-server', () => ({
  deleteImagesFromR2Server: async () => undefined,
  moveR2Objects: async () => ({ movedKeys: [], failed: [] }),
}));

import { db } from '@/db';
import { savedQuestions as savedQuestionsTable } from '@/db/schema/surveys';
import type { ORPCContext } from '@/server/context';

import { savedQuestions } from '@/features/library/server/procedures/saved-questions';

// prod 방어선: DATABASE_URL이 로컬이 아니면 전체 suite 스킵
const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

function adminContext(): ORPCContext {
  return {
    db,
    supabase: {} as never,
    user: { id: 'test-admin', email: 'test@local' },
  };
}

describe.skipIf(!isLocalDb)('saved-questions procedure round-trip (real local DB)', () => {
  const client = createRouterClient({ savedQuestions }, { context: adminContext() });
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(savedQuestionsTable).where(eq(savedQuestionsTable.id, id));
    }
  });

  it('create -> list 왕복: 저장된 질문이 조회되고 tags가 빈 배열로 정규화된다', async () => {
    const question = {
      id: 'rt-src',
      type: 'text' as const,
      title: '왕복 테스트 질문',
      required: false,
      order: 0,
    };

    const saved = await client.savedQuestions.create({
      question: question as never,
      metadata: { name: '왕복-테스트', category: '테스트' },
    });
    createdIds.push(saved.id);

    // toDomainSavedQuestion의 null-coalescing 검증: tags null -> []
    expect(saved.name).toBe('왕복-테스트');
    expect(saved.tags).toEqual([]);

    // list에서 방금 생성한 row가 보이는지 확인
    const list = await client.savedQuestions.list();
    expect(list.some((q) => q.id === saved.id)).toBe(true);
  });

  it('recentlyUsed: usageCount>0 필터를 LIMIT 이전에 적용해 사용된 질문이 더 최근 미사용 질문에 밀려나지 않는다', async () => {
    // 회귀: 과거에는 LIMIT(상위 limit개) 적용 후 JS에서 usageCount>0 필터를 돌려서,
    // 상위 limit개가 전부 usageCount===0이면 결과가 빈 배열이 되어 '최근 사용' 섹션이 사라졌다.

    // 1) 사용된 질문 1개 생성 후 apply (usageCount=1, updatedAt이 now로 갱신됨)
    const usedSaved = await client.savedQuestions.create({
      question: {
        id: 'rt-used',
        type: 'text' as const,
        title: '사용된 질문',
        required: false,
        order: 0,
      } as never,
      metadata: { name: 'recently-used-사용됨', category: '테스트' },
    });
    createdIds.push(usedSaved.id);
    await client.savedQuestions.apply({ id: usedSaved.id });

    // 2) apply 이후에 미사용 질문 limit개 생성 -> 이들이 updatedAt 최신 상위를 모두 차지함
    const limit = 5;
    for (let i = 0; i < limit; i += 1) {
      const unused = await client.savedQuestions.create({
        question: {
          id: `rt-unused-${i}`,
          type: 'text' as const,
          title: `미사용 질문 ${i}`,
          required: false,
          order: 0,
        } as never,
        metadata: { name: `recently-used-미사용-${i}`, category: '테스트' },
      });
      createdIds.push(unused.id);
    }

    // 3) recentlyUsed는 usageCount>0인 사용된 질문을 여전히 포함해야 한다.
    const recent = await client.savedQuestions.recentlyUsed({ limit });
    expect(recent.some((q) => q.id === usedSaved.id)).toBe(true);
    // 미사용(usageCount===0) 질문은 절대 포함되지 않는다.
    expect(recent.every((q) => q.usageCount > 0)).toBe(true);
  });

  it('apply: usageCount 증가 후 새 id를 부여한 question을 반환한다', async () => {
    const question = {
      id: 'rt-src2',
      type: 'text' as const,
      title: 'apply 테스트',
      required: false,
      order: 0,
    };

    const saved = await client.savedQuestions.create({
      question: question as never,
      metadata: { name: 'apply-테스트', category: '테스트' },
    });
    createdIds.push(saved.id);

    const applied = await client.savedQuestions.apply({ id: saved.id });

    expect(applied).not.toBeNull();
    // applySavedQuestion이 generateId()로 새 id를 부여함
    expect(applied?.id).not.toBe(saved.id);
    expect(applied?.title).toBe('apply 테스트');

    // usageCount가 DB에서 실제로 증가했는지 직접 확인
    const [row] = await db
      .select({ usageCount: savedQuestionsTable.usageCount })
      .from(savedQuestionsTable)
      .where(eq(savedQuestionsTable.id, saved.id));
    expect(row?.usageCount).toBe(1);
  });
});
