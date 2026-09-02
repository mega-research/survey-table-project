import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyDocuments } from '@/db/schema';
import { copyR2Objects, deleteR2ObjectsByKey } from '@/lib/image-utils-server';
import { getR2PublicUrl } from '@/lib/r2-env';
import { registerDeletionCandidates } from '@/lib/r2-lifecycle/deletion-queue.server';
import { nextOrderAfter } from '@/lib/survey-document/anchor-row';
import { toPermanentSurveyDocumentKey } from '@/lib/survey-document/document-key';

import type {
  AttachSurveyDocumentInput,
  ListSurveyDocumentsInput,
  RemoveSurveyDocumentInput,
  SurveyDocument,
} from '../../domain/survey-document';

/** DB 행 → 화면 모양. 공개 URL 은 저장하지 않고 키에서 파생한다. */
function toDocument(row: typeof surveyDocuments.$inferSelect): SurveyDocument {
  return {
    id: row.id,
    surveyId: row.surveyId,
    fileKey: row.fileKey,
    filename: row.filename,
    pageCount: row.pageCount,
    order: row.order,
    url: `${getR2PublicUrl()}/${row.fileKey}`,
  };
}

export async function listSurveyDocuments(
  input: ListSurveyDocumentsInput,
): Promise<SurveyDocument[]> {
  const rows = await db
    .select()
    .from(surveyDocuments)
    .where(eq(surveyDocuments.surveyId, input.surveyId))
    .orderBy(asc(surveyDocuments.order), asc(surveyDocuments.createdAt));
  return rows.map(toDocument);
}

export class SurveyDocumentAttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SurveyDocumentAttachError';
  }
}

/**
 * tmp 업로드를 영구 위치로 옮기고 설문에 붙인다.
 *
 * 교체(replaceDocumentId)에 가드를 두지 않는다 — 쪽 수가 달라져 얼린 앵커가
 * 엉뚱한 곳을 가리켜도 막지 않는다. 기획자 책임이라는 결정이다 (ADR 0020).
 * 대신 교체된 이전 파일은 유예 삭제 큐에 등록해 7일간 되돌릴 수 있게 둔다.
 */
export async function attachSurveyDocument(
  input: AttachSurveyDocumentInput,
): Promise<SurveyDocument> {
  const permanentKey = toPermanentSurveyDocumentKey(input.key);
  if (!permanentKey) {
    throw new SurveyDocumentAttachError('업로드된 조사표 파일을 찾을 수 없습니다.');
  }

  const { failed } = await copyR2Objects([{ srcKey: input.key, dstKey: permanentKey }]);
  if (failed.length > 0) {
    throw new SurveyDocumentAttachError('조사표 파일을 저장하지 못했습니다. 다시 시도해 주세요.');
  }

  // R2 복사는 트랜잭션 밖이라 이후 트랜잭션이 던지면 참조 없는 영구 키가 남는다.
  // 방금 만든 객체이고 아직 어디에서도 가리키지 않으므로 그 자리에서 되돌린다 —
  // 유예 삭제 큐는 '한때 참조됐던' 키를 위한 장치라 여기 쓸 자리가 아니다.
  let attached: { document: SurveyDocument; previousKey: string | null };
  try {
    attached = await db.transaction(async (tx) => {
      if (input.replaceDocumentId) {
        const [existing] = await tx
          .select()
          .from(surveyDocuments)
          .where(
            and(
              eq(surveyDocuments.id, input.replaceDocumentId),
              eq(surveyDocuments.surveyId, input.surveyId),
            ),
          );
        if (!existing) {
          throw new SurveyDocumentAttachError('교체할 조사표를 찾을 수 없습니다.');
        }
        const [updated] = await tx
          .update(surveyDocuments)
          .set({
            fileKey: permanentKey,
            filename: input.filename,
            pageCount: input.pageCount,
            updatedAt: new Date(),
          })
          .where(eq(surveyDocuments.id, existing.id))
          .returning();
        if (!updated) throw new SurveyDocumentAttachError('조사표 교체에 실패했습니다.');
        return {
          document: toDocument(updated),
          previousKey: existing.fileKey === permanentKey ? null : existing.fileKey,
        };
      }

      const siblings = await tx
        .select({ order: surveyDocuments.order })
        .from(surveyDocuments)
        .where(eq(surveyDocuments.surveyId, input.surveyId));
      const nextOrder = nextOrderAfter(siblings);
      const [inserted] = await tx
        .insert(surveyDocuments)
        .values({
          surveyId: input.surveyId,
          fileKey: permanentKey,
          filename: input.filename,
          pageCount: input.pageCount,
          order: nextOrder,
        })
        .returning();
      if (!inserted) throw new SurveyDocumentAttachError('조사표 등록에 실패했습니다.');
      return { document: toDocument(inserted), previousKey: null };
    });
  } catch (error) {
    await deleteR2ObjectsByKey([permanentKey]);
    throw error;
  }
  const { document, previousKey } = attached;

  if (previousKey) {
    await registerDeletionCandidates(db, {
      keys: [previousKey],
      source: 'document-delete',
      reason: '조사표 교체',
    });
  }
  // tmp 원본은 R2 lifecycle 이 24h 내 지우지만, 성공 경로에서는 즉시 치운다
  await deleteR2ObjectsByKey([input.key]);

  return document;
}

/**
 * 조사표를 뗀다. 파일은 즉시 지우지 않고 유예 삭제 큐에 등록한다 —
 * 실수로 뗀 조사표를 7일 안에 되돌릴 수 있어야 한다 (ADR 0015).
 */
export async function removeSurveyDocument(input: RemoveSurveyDocumentInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(surveyDocuments)
      .where(
        and(
          eq(surveyDocuments.id, input.documentId),
          eq(surveyDocuments.surveyId, input.surveyId),
        ),
      )
      .returning({ fileKey: surveyDocuments.fileKey });
    if (!deleted) return;
    await registerDeletionCandidates(tx, {
      keys: [deleted.fileKey],
      source: 'document-delete',
      reason: '조사표 삭제',
    });
  });
}
