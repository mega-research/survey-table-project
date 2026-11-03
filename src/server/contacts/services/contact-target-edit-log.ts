import { sql } from 'drizzle-orm';
import 'server-only';

import type { DbTransaction } from '@/db';
import { contactTargetEditLogs } from '@/db/schema';
import type { ContactTargetEditAction, ContactTargetEditChange } from '@/shared/contracts/contacts';

import type { ContactEditor } from '../domain/contact-target-edit';

/**
 * 「대상 정보 수정 현황」 한 줄을 쓴다 — 바꾼 쓰기와 **같은 트랜잭션** 안에서 부른다.
 *
 * 변경이 비어 있으면 아무것도 쓰지 않는다(바뀐 것 없는 저장은 기록 없음). INSERT 가 실패하면
 * 예외가 트랜잭션을 롤백해 바꾼 값도 남지 않는다 — 기록 없는 변경을 만들지 않는다.
 *
 * created_at 은 now()(트랜잭션 시작 시각)가 아니라 clock_timestamp() 다. 같은 대상의 저장이
 * 잠금 뒤에 줄을 서면 늦게 쓴 쪽이 먼저 시작했을 수 있어, 시작 시각으로는 최신순이 뒤집힌다.
 */
export async function recordContactTargetEdit(
  tx: DbTransaction,
  args: {
    surveyId: string;
    contactTargetId: string;
    action: ContactTargetEditAction;
    changes: ContactTargetEditChange[];
    editor: ContactEditor;
  },
): Promise<void> {
  if (args.changes.length === 0) return;
  await tx.insert(contactTargetEditLogs).values({
    surveyId: args.surveyId,
    contactTargetId: args.contactTargetId,
    action: args.action,
    changes: args.changes,
    editedBy: args.editor.id,
    editorEmail: args.editor.email,
    createdAt: sql`clock_timestamp()`,
  });
}
