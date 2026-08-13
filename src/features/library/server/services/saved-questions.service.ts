import 'server-only';

import { desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { NewSavedQuestion, savedQuestions } from '@/db/schema/surveys';
import { escapeLikePattern } from '@/lib/operations/filter-shared';
import { normalizeQuestion } from '@/lib/question';
import { registerDeletionCandidates } from '@/lib/r2-lifecycle/deletion-queue.server';
import { extractR2KeysFromJsonbValue } from '@/lib/r2-lifecycle/key-extract';
import { collectFieldLimitedSaveDiff } from '@/lib/r2-lifecycle/save-diff-collector.server';
import { promoteNoticeAttachments } from '@/lib/survey/notice-attachment-promote';
import { promoteSurveyImages } from '@/lib/survey/survey-image-promote';
import { generateId } from '@/lib/utils';
import type { Question, SavedQuestion } from '@/types/survey';
import { resolveMobileDrilldownRepeatHeaderRange } from '@/utils/mobile-drilldown-repeat-header';
import { resolveMobileTableDisplayMode } from '@/utils/mobile-table-display-mode';

import type {
  CreateSavedQuestionInput,
  UpdateSavedQuestionInput,
} from '../../domain/saved-question';

// drizzle $inferSelect row -> domain SavedQuestion 명시 변환
// tags: string[] | null -> string[] (null -> 빈 배열)
// description: string | null -> string | undefined (domain은 optional, exactOptionalPropertyTypes 대응)
// question: QuestionData (JSONB) -> 읽기 경계 정규화(보존 모드). 기존 단언과 거동 동일,
//   세대별 키셋이 다른 보관함 질문의 알 수 없는 형태만 관측 로그.
function toDomainSavedQuestion(
  row: typeof savedQuestions.$inferSelect,
): SavedQuestion {
  const result: SavedQuestion = {
    id: row.id,
    question: normalizeQuestion(row.question),
    name: row.name,
    tags: row.tags ?? [],
    category: row.category,
    usageCount: row.usageCount,
    isPreset: row.isPreset,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.description != null) {
    result.description = row.description;
  }
  return result;
}

function prepareAppliedQuestion(question: Question): Question {
  const supportsMobileTableDisplay = question.type === 'radio'
    || question.type === 'checkbox'
    || question.type === 'table';
  const repeatHeaderRange = supportsMobileTableDisplay
    ? resolveMobileDrilldownRepeatHeaderRange(question)
    : null;
  const canonicalQuestion = supportsMobileTableDisplay
    ? {
        ...question,
        mobileTableDisplayMode: resolveMobileTableDisplayMode(question),
        mobileDrilldownRepeatHeaderStartRow: repeatHeaderRange?.startRow ?? null,
        mobileDrilldownRepeatHeaderEndRow: repeatHeaderRange?.endRow ?? null,
      }
    : question;
  const { groupId: _groupId, ...questionWithoutGroup } = canonicalQuestion;

  return {
    ...questionWithoutGroup,
    id: generateId(),
    order: 0,
  } as Question;
}

// ========================
// 쿼리
// ========================

/** 모든 저장된 질문 조회 (최근 수정순) */
export async function listSavedQuestions(): Promise<SavedQuestion[]> {
  const rows = await db.query.savedQuestions.findMany({
    orderBy: [desc(savedQuestions.updatedAt)],
  });
  return rows.map(toDomainSavedQuestion);
}

/** 이름/설명 검색 */
export async function searchSavedQuestions(query: string): Promise<SavedQuestion[]> {
  // 사용자 입력의 LIKE 메타문자(% _ \)를 리터럴로 escape — '50% 만족도' 같은
  // 이름 검색이 과도하게 매칭되지 않도록 한다. ilike() 두 번째 인자는 파라미터 바인딩됨.
  const pattern = `%${escapeLikePattern(query)}%`;
  const rows = await db.query.savedQuestions.findMany({
    where: or(
      ilike(savedQuestions.name, pattern),
      ilike(savedQuestions.description, pattern),
    ),
    orderBy: [desc(savedQuestions.updatedAt)],
  });
  return rows.map(toDomainSavedQuestion);
}

/** 카테고리별 질문 조회 */
export async function getSavedQuestionsByCategory(category: string): Promise<SavedQuestion[]> {
  const rows = await db.query.savedQuestions.findMany({
    where: eq(savedQuestions.category, category),
    orderBy: [desc(savedQuestions.updatedAt)],
  });
  return rows.map(toDomainSavedQuestion);
}

/** 최근 사용된 질문 조회 (usageCount > 0, updatedAt 최신순) */
export async function getRecentlyUsedQuestions(limit: number = 5): Promise<SavedQuestion[]> {
  // usageCount > 0 필터를 LIMIT 이전(SQL WHERE)에서 적용해야 한다.
  // 그렇지 않으면 최근 수정된 상위 limit개가 모두 usageCount===0일 때
  // 결과가 빈 배열이 되어 '최근 사용' 섹션이 사라진다.
  const rows = await db.query.savedQuestions.findMany({
    where: gt(savedQuestions.usageCount, 0),
    orderBy: [desc(savedQuestions.updatedAt)],
    limit,
  });
  return rows.map(toDomainSavedQuestion);
}

/** 사용 횟수 많은 질문 조회 */
export async function getMostUsedQuestions(limit: number = 5): Promise<SavedQuestion[]> {
  const rows = await db.query.savedQuestions.findMany({
    orderBy: [desc(savedQuestions.usageCount)],
    limit,
  });
  return rows.map(toDomainSavedQuestion);
}

/** 태그로 질문 조회 */
export async function getSavedQuestionsByTag(tag: string): Promise<SavedQuestion[]> {
  const rows = await db.query.savedQuestions.findMany();
  return rows.filter((q) => q.tags?.includes(tag)).map(toDomainSavedQuestion);
}

// ========================
// 뮤테이션
// ========================

/** 질문 저장 — tmp/survey/ 이미지·tmp/notice-attachment/ 첨부를 영구 prefix로 promote 후 insert */
export async function createSavedQuestion(input: CreateSavedQuestionInput): Promise<SavedQuestion> {
  const [promotedQuestion] = await promoteNoticeAttachments(
    await promoteSurveyImages([input.question]),
  );

  const newSavedQuestion: NewSavedQuestion = {
    question: promotedQuestion as unknown as NewSavedQuestion['question'],
    name: input.metadata.name,
    description: input.metadata.description,
    category: input.metadata.category,
    tags: input.metadata.tags ?? [],
    usageCount: 0,
    isPreset: false,
  };

  const [saved] = await db.insert(savedQuestions).values(newSavedQuestion).returning();
  if (!saved) throw new Error('질문 저장에 실패했습니다.');
  return toDomainSavedQuestion(saved);
}

/** 저장된 질문 업데이트 — question 포함 시 이미지·공지 첨부 promote */
export async function updateSavedQuestion(
  id: string,
  updates: UpdateSavedQuestionInput['updates'],
): Promise<SavedQuestion> {
  let promotedQuestion = updates.question;
  if (updates.question) {
    const [promoted] = await promoteNoticeAttachments(
      await promoteSurveyImages([updates.question]),
    );
    promotedQuestion = promoted;
  }

  // 저장 전 행 콘텐츠 read → write → 저장 diff 등록·부활 취소를 같은 트랜잭션으로.
  // question 이 payload 에 없으면(메타만 수정) diff 비교 대상이 없어 no-op.
  return db.transaction(async (tx) => {
    const [oldRow] = await tx.select().from(savedQuestions).where(eq(savedQuestions.id, id));

    const [updated] = await tx
      .update(savedQuestions)
      .set({
        ...updates,
        question: promotedQuestion as unknown as NewSavedQuestion['question'],
        updatedAt: new Date(),
      })
      .where(eq(savedQuestions.id, id))
      .returning();

    if (!updated) throw new Error('질문 수정에 실패했습니다.');

    if (oldRow && updates.question) {
      await collectFieldLimitedSaveDiff(tx, {
        oldRow: { question: oldRow.question },
        payloadRow: { question: promotedQuestion },
        reason: `보관함 질문 수정: ${oldRow.name || id}`,
      });
    }

    return toDomainSavedQuestion(updated);
  });
}

/**
 * 저장된 질문 삭제 — 연결 이미지는 R2 에서 지우지 않는다.
 * 원본 설문이 같은 URL 을 계속 참조 중일 수 있다(오늘 사고와 동형 경로).
 */
export async function deleteSavedQuestion(id: string): Promise<void> {
  // 삭제 전 같은 트랜잭션에서 질문 JSONB 의 R2 키를 수집해 유예 삭제 큐에 등록
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(savedQuestions).where(eq(savedQuestions.id, id));
    if (row) {
      await registerDeletionCandidates(tx, {
        keys: extractR2KeysFromJsonbValue(row.question),
        source: 'library-delete',
        reason: `보관함 질문 삭제: ${row.name || id}`,
      });
    }
    await tx.delete(savedQuestions).where(eq(savedQuestions.id, id));
  });
}

/**
 * 질문 사용 — usageCount 원자적 증가 후 새 id를 부여한 Question 객체 반환.
 * 존재하지 않는 id면 null 반환.
 */
export async function applySavedQuestion(id: string): Promise<Question | null> {
  const [updated] = await db
    .update(savedQuestions)
    .set({
      usageCount: sql`${savedQuestions.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(savedQuestions.id, id))
    .returning();

  if (!updated) return null;

  return prepareAppliedQuestion(normalizeQuestion(updated.question));
}

/**
 * 여러 질문 일괄 사용 — 1회 조회 + 1회 업데이트 최적화.
 * 빈 ids 배열이면 [] 반환.
 */
export async function applyMultipleSavedQuestions(ids: string[]): Promise<Question[]> {
  if (!ids.length) return [];

  const savedItems = await db.query.savedQuestions.findMany({
    where: inArray(savedQuestions.id, ids),
  });

  if (!savedItems.length) return [];

  await db
    .update(savedQuestions)
    .set({
      usageCount: sql`${savedQuestions.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(inArray(savedQuestions.id, ids));

  // findMany는 PG 저장 순서로 반환하므로, 사용자가 선택한 ids 순서대로 재정렬한다.
  const savedById = new Map(savedItems.map((saved) => [saved.id, saved]));
  const orderedItems = ids
    .map((id) => savedById.get(id))
    .filter((saved): saved is (typeof savedItems)[number] => saved !== undefined);

  return orderedItems.map((saved) => prepareAppliedQuestion(normalizeQuestion(saved.question)));
}
