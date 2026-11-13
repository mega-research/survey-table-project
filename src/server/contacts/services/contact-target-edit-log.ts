/**
 * 대상 정보 수정 현황 — 기록 쓰기 (CONTEXT.md 「대상 정보 수정 현황」).
 *
 * ── 배선과 규칙 ──
 * - **대상 정보 수정 현황** (2026-11-03, 0152): 표 `contact_target_edit_logs`(`action` = `info_edit |
 *   attempt_edit | attempt_delete | assignment_change`, `changes` 어휘는 `shared/contracts/contacts` 의
 *   `ContactTargetEditChange`).
 * - 쓰기는 `server/contacts/services/contact-target-edit-log` 의 `recordContactTargetEdit` 하나를 각 쓰기
 *   경로가 **같은 트랜잭션 · 대상 행 `FOR UPDATE` 아래**에서 부른다 — 상세 저장 `updateContactTarget` · 컨택원
 *   한 명 바꾸기 `setTargetAssignment`(이 기능으로 대상 잠금을 새로 더했다, 잠금 순서는 설문 스코프 → 컨택원 →
 *   대상) · 회차 `updateAttempt`·`deleteAttempt`.
 * - 판정은 `server/contacts/domain/contact-target-edit` 의 순수 함수(`diffContactTargetInfo` ·
 *   `diffContactTargetPii` · `attemptEditChange`)이고, 개인정보 열의 지금 값은 잠금 아래에서 복호화해
 *   메모리에서만 비교한다(`lib/crypto/contact-pii-repo` 의 `readStoredPiiPlain`, 저장할 평문 규칙
 *   `piiPlainToStore` 를 저장과 판정이 같이 쓴다).
 * - `created_at` 은 `clock_timestamp()` 다 — 같은 대상의 저장이 잠금 뒤에 줄을 서면 늦게 쓴 쪽이 먼저 시작했을
 *   수 있어 트랜잭션 시작 시각(`now()`)으로는 최신순이 뒤집힌다.
 * - 편집자는 procedure 가 인증된 context 에서 넘긴다(`contactEditorOf` — 게스트도 자기 이메일로).
 * - 회차의 `created_by` 는 auth.users 를 가리키는 uuid 라, 편집자 id 가 uuid 이고 auth.users 에 있을 때만
 *   채우고 아니면 NULL 이다(이메일 `created_by_email` 은 항상 채운다 — 기록자 칸 때문에 회차 추가가 실패하지
 *   않게).
 * - 그 FK 는 `ON DELETE SET NULL` 이다(0152 가 0014 의 기본 동작을 다시 걸었다 — 회차를 남긴 계정도 지울 수
 *   있게).
 * - 읽기는 `server/read-models/contact-target-edit-logs` 의 `getContactTargetEditLogs`(운영 데이터 스코프,
 *   최신순 최대 200줄, 게스트 거르기 `visibleContactTargetEditChanges`), 화면 문구는
 *   `lib/operations/contact-target-edit-format`, 카드는 `contact-target-edit-history-card`(「참가기업 정보」
 *   아래, 기본 접힘).
 * - PRD `.scratch/contact-edit-history/PRD.md`.
 */

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
