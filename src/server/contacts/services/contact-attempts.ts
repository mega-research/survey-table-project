import { and, eq, sql } from 'drizzle-orm';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import { contactAttempts, contactTargets } from '@/db/schema';
import { logger } from '@/lib/logger';
import { isUniqueViolation } from '@/lib/pg-error';
import { lockWriteScope } from '@/server/data-scope';
import type { ActorAttribution } from '@/server/survey-access';
import type { ContactTargetEditAttemptSnapshot } from '@/shared/contracts/contacts';

import type {
  AddContactAttemptInput,
  ContactAttempt,
  DeleteContactAttemptInput,
  UpdateContactAttemptInput,
} from '../domain/contact-attempt';
import { type ContactEditor, attemptEditChange } from '../domain/contact-target-edit';
import { recordContactTargetEdit } from './contact-target-edit-log';

/**
 * 현재 DB 모드에 속한 대상자를 잠근다. 목록을 본 뒤 모드가 바뀌어도 회차 변경은
 * 현재 스코프 대상자에게만 허용된다.
 */
async function lockTargetInCurrentScope(
  tx: DbTransaction,
  contactTargetId: string,
  surveyId: string,
  isExternal: boolean,
): Promise<void> {
  const locked = await lockWriteScope(tx, surveyId, isExternal, { lock: 'update' });
  if (!locked) throw new Error('NOT_FOUND');
  const { isTest } = locked;

  const [target] = await tx
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.id, contactTargetId),
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.isTest, isTest),
      ),
    )
    .for('update');
  if (!target) throw new Error('NOT_FOUND');
}

/**
 * 회차 추가 — attempt_no 는 MAX(attempt_no)+1 로 자동 발번.
 * UNIQUE(contact_target_id, attempt_no) 가 race 가드.
 *
 * I6: 두 사용자 동시 추가 시 23505 (UNIQUE 위반) 발생 가능 → 최대 3회 재시도.
 * 3회 모두 실패 시 user-facing error.
 *
 * surveyId 는 input 으로 받되 service 로직에서는 사용하지 않는다(revalidate 제거).
 *
 * isExternal 는 procedure 가 이미 인증한 주체에서 파생해 전달한다 — 서비스가 auth 를 재조회하면
 * 그 실패가 fail-open(어드민 취급)으로 이어질 수 있다. 회차 추가는 회차 목록 자체가 기록이라
 * 「대상 정보 수정 현황」에는 남기지 않는다.
 *
 * **누가 남겼는가가 회차의 절반이다**(티켓 26) — 담당 연구원이 「이 부재중은 누가 찍었나」를
 * 물을 수 있어야 한다. 귀속(계정 칸·링크 칸)은 `author`, 화면에 보이는 기록자 글자는 `editor` 의
 * 이메일 스냅샷(`created_by_email`, 0152)이다.
 */
export async function addAttempt(
  input: AddContactAttemptInput,
  isExternal: boolean,
  /**
   * 「누가 넣었는가」 — 계정 칸과 링크 칸 중 **정확히 하나** (0127, ADR-0026, 티켓 08).
   *
   * 외주 실사 링크는 `contacts.writeAttempts` 를 갖지만 계정이 아니다. 계정 FK 칸에 무엇이든
   * 채우려 들면 그 순간 남의 이름으로 기록이 남으므로 링크 칸이 따로 있고, 둘의 배타는
   * `attributionOf` 가 주체에서 파생시켜 타입으로, DB 의 CHECK 가 저장 시점에 지킨다.
   */
  author: ActorAttribution,
  /** 기록자 글자 — 계정이면 이메일, 외주 링크면 「외주」(`contactEditorOfActor`). */
  editor: ContactEditor,
): Promise<{ id: string; attemptNo: number }> {
  const { contactTargetId, resultCode, note } = input;

  const MAX_RETRIES = 3;
  let lastError: unknown = null;
  let result: { id: string; attemptNo: number } | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      result = await db.transaction(async (tx) => {
        await lockTargetInCurrentScope(tx, input.contactTargetId, input.surveyId, isExternal);
        const [maxRow] = await tx
          .select({ maxNo: sql<number | null>`MAX(${contactAttempts.attemptNo})` })
          .from(contactAttempts)
          .where(eq(contactAttempts.contactTargetId, contactTargetId));
        const nextNo = (maxRow?.maxNo ?? 0) + 1;

        const [row] = await tx
          .insert(contactAttempts)
          .values({
            contactTargetId,
            attemptNo: nextNo,
            resultCode,
            note: note ?? null,
            createdBy: author.accountUserId,
            fieldworkLinkId: author.fieldworkLinkId,
            createdByEmail: editor.email,
          })
          .returning({ id: contactAttempts.id, attemptNo: contactAttempts.attemptNo });
        if (!row) throw new Error('contact_attempts INSERT 실패');
        return row;
      });
      break; // 성공 시 retry loop 종료
    } catch (e) {
      lastError = e;
      if (!isUniqueViolation(e)) throw e; // 다른 에러는 즉시 전파
      // UNIQUE 위반은 retry — 다음 iteration 에서 MAX+1 재계산
    }
  }

  if (result == null) {
    logger.error({ contactTargetId, err: lastError }, '[addAttempt] race retry 소진');
    throw new Error('동시 편집 충돌이 발생했습니다. 다시 시도해주세요.');
  }

  return result;
}

/**
 * 회차 수정 — resultCode/note 갱신.
 * 설문 스코프 가드: contactTargetId 가 surveyId 소속인지 선행 확인한 뒤,
 * attempt.id + contactTargetId 스코프로 UPDATE 한다. 그 대상 소속 회차가 없으면 NOT_FOUND throw.
 *
 * 바꾸기 전 회차는 대상 잠금 아래에서 읽는다 — 회차를 바꾸는 경로(추가·수정·삭제)는 모두 같은
 * 대상 잠금을 먼저 잡으므로 읽은 뒤 UPDATE 사이에 그 회차가 바뀌지 않는다. 결과코드·비고 중
 * 하나라도 달라졌을 때만 「대상 정보 수정 현황」에 고치기 전·후를 같은 트랜잭션으로 남긴다
 * (비고 없음과 빈 비고는 같다).
 */
export async function updateAttempt(
  input: UpdateContactAttemptInput,
  isExternal: boolean,
  editor: ContactEditor,
): Promise<void> {
  const { id, contactTargetId, surveyId, resultCode } = input;
  const note = input.note ?? null;
  await db.transaction(async (tx) => {
    await lockTargetInCurrentScope(tx, contactTargetId, surveyId, isExternal);
    const scope = and(
      eq(contactAttempts.id, id),
      eq(contactAttempts.contactTargetId, contactTargetId),
    );
    const [before] = await tx.select().from(contactAttempts).where(scope);
    if (!before) throw new Error('NOT_FOUND');
    await tx.update(contactAttempts).set({ resultCode, note }).where(scope);

    const unchanged = before.resultCode === resultCode && (before.note ?? '') === (note ?? '');
    if (unchanged) return;
    await recordContactTargetEdit(tx, {
      surveyId,
      contactTargetId,
      action: 'attempt_edit',
      changes: [attemptEditChange(before.attemptNo, attemptSnapshot(before), { resultCode, note })],
      editor,
    });
  });
}

/**
 * 회차 삭제.
 * 설문 스코프 가드: contactTargetId 가 surveyId 소속인지 선행 확인한 뒤,
 * attempt.id + contactTargetId 스코프로 DELETE 한다. 영향 0행이면 NOT_FOUND throw.
 *
 * 지운 회차는 「대상 정보 수정 현황」에 지운 내용째(결과코드·비고·기록자·기록 시각) 같은
 * 트랜잭션으로 남긴다 — DELETE … RETURNING 이 대상 잠금 아래에서 지운 행을 그대로 돌려준다.
 * 기록이 실패하면 삭제도 롤백된다.
 */
export async function deleteAttempt(
  input: DeleteContactAttemptInput,
  isExternal: boolean,
  editor: ContactEditor,
): Promise<void> {
  const { id, contactTargetId, surveyId } = input;
  await db.transaction(async (tx) => {
    await lockTargetInCurrentScope(tx, contactTargetId, surveyId, isExternal);
    const [deleted] = await tx
      .delete(contactAttempts)
      .where(and(eq(contactAttempts.id, id), eq(contactAttempts.contactTargetId, contactTargetId)))
      .returning();
    if (!deleted) throw new Error('NOT_FOUND');
    await recordContactTargetEdit(tx, {
      surveyId,
      contactTargetId,
      action: 'attempt_delete',
      changes: [attemptEditChange(deleted.attemptNo, attemptSnapshot(deleted), null)],
      editor,
    });
  });
}

/** 기록에 담는 바꾸기 전 회차 — 기록 시각은 ISO 문자열(JSONB). */
function attemptSnapshot(row: ContactAttempt): ContactTargetEditAttemptSnapshot {
  return {
    resultCode: row.resultCode,
    note: row.note,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt.toISOString(),
  };
}
