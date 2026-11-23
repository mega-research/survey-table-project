import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import { contactTargets, surveyResponses } from '@/db/schema';
import { sanitizeAttrsAgainstPiiScheme } from './scheme-helpers';
import { piiPlainToStore, readStoredPiiPlain, upsertPiiValue } from '@/lib/crypto/contact-pii-repo';
import { describePiiFormatProblems } from '@/lib/crypto/pii-fields';
import {
  archiveTestMailForTargets,
  hardDeleteMailForTargets,
} from '@/server/workflows/test-mail-archive';
import { lockWriteScope } from '@/server/data-scope';
import {
  type FieldworkShare,
  shareAttrStamp,
  shareTargetCondition,
} from '@/server/fieldwork-share-scope';
import { generateInviteCode } from '@/lib/survey-url';
import { InternalFailure } from '@/server/internal-failure';

import {
  type ContactEditor,
  type ContactTargetInfoValues,
  diffContactTargetInfo,
  diffContactTargetPii,
} from '../domain/contact-target-edit';
import type {
  AddContactTargetInput,
  ContactTargetRow,
  DeleteContactTargetInput,
  UpdateContactTargetInput,
} from '../domain/contact-target';
import { prepareContactInsertScope } from './contact-insert-scope';
import {
  type NormalizedContactColumnScheme,
  normalizeContactColumnScheme,
} from '@/lib/operations/contacts-format';

import { allocateContactResid } from './contact-resid';
import { recordContactTargetEdit } from './contact-target-edit-log';

/**
 * 값이 있는데 형식이 틀린 PII(예: `@` 없는 메일)를 저장 전에 거부한다.
 *
 * upsertPiiValue 는 「정규화 결과가 빈 값」을 「칸을 비웠다」와 같게 다뤄 기존 암호화 행을 지우고
 * 성공으로 끝난다 — 그대로 넘기면 화면에는 「저장 완료」가 뜨고 값은 사라진다(2026-10-06 실사고).
 * 사람이 값을 넣은 단건 추가·수정은 여기서 막는다. 트랜잭션 앞에서 던지므로 같은 요청의
 * attrs·메모도 쓰이지 않는다(반쯤 저장된 상태를 만들지 않는다). 엑셀 업로드는 이 경로를 타지
 * 않고 종전대로 형식이 틀린 칸을 건너뛴다.
 */
function assertStorablePiiUpdates(piiUpdates: UpdateContactTargetInput['piiUpdates']): void {
  const problems = describePiiFormatProblems(piiUpdates ?? []);
  if (problems.length > 0) throw new ORPCError('BAD_REQUEST', { message: problems.join(' ') });
}

/**
 * 현재 DB 모드를 기준으로 대상자를 잠그고, 그 잠금 아래에서 대상 정보의 지금 값을 읽는다.
 *
 * 목록을 연 뒤 테스트 모드가 전환된 경우에도 이전 탭이 반대 스코프 행을 수정·삭제하지
 * 못하도록, 설문 행과 대상 행을 같은 트랜잭션에서 순서대로 잠근다.
 */
async function lockTargetAndReadCurrent(
  tx: DbTransaction,
  input: { id: string; surveyId: string },
  isGuest: boolean,
  share: FieldworkShare,
): Promise<{
  isTest: boolean;
  scheme: NormalizedContactColumnScheme | null;
  /** 잠금 아래에서 읽은 지금 값 — 「대상 정보 수정 현황」의 이전 값이다. */
  current: ContactTargetInfoValues;
}> {
  const scope = await lockCurrentSurveyScope(tx, input.surveyId, isGuest);

  const [target] = await tx
    .select({
      id: contactTargets.id,
      attrs: contactTargets.attrs,
      memo: contactTargets.memo,
      contactMethod: contactTargets.contactMethod,
    })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.id, input.id),
        eq(contactTargets.surveyId, input.surveyId),
        eq(contactTargets.isTest, scope.isTest),
        // 담당 범위도 잠금 조회의 조건이다 — 범위 밖 대상은 없는 대상과 똑같이 NOT_FOUND 다.
        shareTargetCondition(share),
      ),
    )
    .for('update');
  if (!target) throw new ORPCError('NOT_FOUND', { message: '조사 대상을 찾을 수 없습니다.' });

  return {
    ...scope,
    current: { attrs: target.attrs, memo: target.memo, contactMethod: target.contactMethod },
  };
}

async function lockCurrentSurveyScope(
  tx: DbTransaction,
  surveyId: string,
  isGuest: boolean,
): Promise<{ isTest: boolean; scheme: NormalizedContactColumnScheme | null }> {
  const locked = await lockWriteScope(tx, surveyId, isGuest, {
    lock: 'update',
    columns: ['contactColumns', 'testContactColumns'],
  });
  if (!locked) throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });

  const { isTest, row } = locked;
  return {
    isTest,
    // 잠금 아래 raw JSONB 를 읽는 지점이라 소비처로 내보내기 전에 형태를 보정한다.
    scheme: normalizeContactColumnScheme((isTest ? row.testContactColumns : row.contactColumns) ?? null),
  };
}

/**
 * 담당 범위에 묶인 게스트가 쓰는 명단 값에 범위 열을 박는다 — 입력이 그 열을 비우거나 다른 값으로 보내도
 * 자기 범위 값이 저장된다. 범위 게스트가 대상을 남의 범위로 옮기거나(수정) 범위 밖에 만들지(추가) 못하게
 * 하는 유일한 자리다 — 범위 열은 명단 값(JSONB)이라 DB 제약이 없다. `all` 이면 입력 그대로다.
 */
function withShareStamp(attrs: Record<string, string>, share: FieldworkShare): Record<string, string> {
  if (share.kind === 'none') {
    throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });
  }
  const stamp = shareAttrStamp(share);
  return stamp ? { ...attrs, [stamp.attrsKey]: stamp.value } : attrs;
}

/**
 * 컨택리스트의 "+ 컨택 추가" 모달 저장.
 * resid 는 next_contact_resid() 로 자동 발번.
 * PII 컬럼은 piiUpdates 로 별도 전달 → contact_pii 에 암호화 저장.
 *
 * 인증은 authed 미들웨어가 담당. 캐시 갱신은 소비처 router.refresh 로 대체.
 *
 * isGuest 는 procedure 가 이미 인증한 context.user.id 에서 파생해 전달한다 — 서비스가
 * auth 를 재조회하면 그 실패가 fail-open(어드민 취급)으로 이어질 수 있다.
 *
 * `share` 는 열람자의 담당 범위다 — 범위 게스트가 추가한 대상에는 자기 범위 값이 찍힌다(`withShareStamp`).
 */
export async function addContactTarget(
  input: AddContactTargetInput,
  isGuest: boolean,
  share: FieldworkShare,
): Promise<ContactTargetRow> {
  const { surveyId, attrs: rawAttrs, piiUpdates, memo, contactMethod } = input;
  assertStorablePiiUpdates(piiUpdates);

  const result = await db.transaction(async (tx) => {
    const prepared = await prepareContactInsertScope(tx, {
      surveyId,
      requestedCount: 1,
      requireEmptyTestScope: false,
      isGuest,
    });
    // 잠금 뒤 읽은 현재 스코프의 스킴으로 평문 PII 누적을 차단한다.
    const attrs = withShareStamp(sanitizeAttrsAgainstPiiScheme(rawAttrs, prepared.scheme), share);

    const resid = await allocateContactResid(tx, surveyId, prepared.isTest);

    const [row] = await tx
      .insert(contactTargets)
      .values({
        surveyId,
        resid,
        isTest: prepared.isTest,
        // 그룹 값(group_value)은 명단 업로드만 채운다 — 한 명씩 추가한 대상은 비워 둔다(아래 수정 경로 주석).
        attrs,
        memo: memo ?? null,
        contactMethod: contactMethod ?? null,
        inviteCode: generateInviteCode(),
      })
      .returning({ id: contactTargets.id, resid: contactTargets.resid });
    if (!row) throw new InternalFailure('contact_targets INSERT 실패');

    if (piiUpdates && piiUpdates.length > 0) {
      for (const p of piiUpdates) {
        await upsertPiiValue(tx, row.id, p.columnKey, p.fieldType, p.plain);
      }
    }

    return row;
  });

  return result;
}

/**
 * 행 단위 갱신 — attrs/memo/contactMethod + PII 변경분 upsert. 그룹 값(group_value)은 쓰지 않는다.
 *
 * 바뀐 칸이 있으면 같은 트랜잭션에서 「대상 정보 수정 현황」 한 줄(`info_edit`)을 남긴다. 개인정보 열은
 * 값 없이 「입력 · 변경 · 삭제」만 남는다 — 지금 값은 잠금 아래에서 복호화해 비교에만 쓴다. 이전 값은
 * 화면이 보낸 값이 아니라 대상 행 잠금 아래에서 읽은 지금 값이다 — 그 사이 다른 사람이 고친 칸을
 * 이 저장이 옛 값으로 덮으면 그것도 변경으로 남는다. 기록 INSERT 가 실패하면 저장도 롤백된다.
 * editor 는 procedure 가 인증된 context 에서 넘긴다.
 *
 * `share` 는 열람자의 담당 범위다 — 범위 밖 대상은 NOT_FOUND 이고, 범위 게스트는 범위 열을 바꾸지 못한다
 * (`withShareStamp` 가 자기 값으로 되돌린다).
 */
export async function updateContactTarget(
  input: UpdateContactTargetInput,
  isGuest: boolean,
  editor: ContactEditor,
  share: FieldworkShare,
): Promise<void> {
  const { id, surveyId, attrs: rawAttrs, piiUpdates, memo, contactMethod } = input;
  assertStorablePiiUpdates(piiUpdates);

  await db.transaction(async (tx) => {
    const { isTest, scheme, current } = await lockTargetAndReadCurrent(
      tx,
      { id, surveyId },
      isGuest,
      share,
    );
    // 모드·대상 소속과 같은 잠금 스냅샷에서 확정한 스킴으로 PII 평문을 제거한다.
    const attrs = withShareStamp(sanitizeAttrsAgainstPiiScheme(rawAttrs, scheme), share);

    // 그룹 값(group_value)은 건드리지 않는다 — 명단 업로드가 채운 값 그대로 둔다. 전에는 화면이 넘긴 열
    // 이름으로 다시 썼는데, 그 열을 이름(「전시회」)으로 추측해 저장할 때마다 다른 열 값으로 덮었다
    // (2026-11-23 국내전시회 설문 — 314명의 그룹이 전시회ID 숫자로 바뀌었다).
    // 개인정보 열의 지금 값 — 같은 잠금 아래, 덮어쓰기 전에 읽어 메모리에서만 비교한다.
    const piiWrites = (piiUpdates ?? []).map((p) => ({
      columnKey: p.columnKey,
      next: piiPlainToStore(p.fieldType, p.plain),
    }));
    const storedPii = await readStoredPiiPlain(
      tx,
      id,
      piiWrites.map((w) => w.columnKey),
    );

    // .returning() 길이로 영향 행 수를 판정한다. PII 재암호화(upsertPiiValue)는
    // 현재 모드의 행 소속이 확정된 뒤에만 일어나야 하므로 이 검증을 PII 부수효과보다 앞에 둔다.
    const updated = await tx
      .update(contactTargets)
      .set({
        attrs,
        memo: memo ?? null,
        contactMethod: contactMethod ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contactTargets.id, id),
          eq(contactTargets.surveyId, surveyId),
          eq(contactTargets.isTest, isTest),
        ),
      )
      .returning({ id: contactTargets.id });
    if (updated.length === 0) throw new ORPCError('NOT_FOUND', { message: '조사 대상을 찾을 수 없습니다.' });

    if (piiUpdates && piiUpdates.length > 0) {
      for (const p of piiUpdates) {
        await upsertPiiValue(tx, id, p.columnKey, p.fieldType, p.plain);
      }
    }

    // 비교 기준은 양쪽 다 PII 정제 뒤 attrs 다. 지금 값도 정제한다 — 그 열이 개인정보로 바뀌기 전에
    // 올라온 옛 행은 attrs 에 평문이 남아 있어, 그대로 비교하면 그 평문이 기록의 이전 값이 된다.
    // pii 변경은 값 없이 같은 줄에 붙인다.
    const changes = [
      ...diffContactTargetInfo(
        { ...current, attrs: sanitizeAttrsAgainstPiiScheme(current.attrs, scheme) },
        { attrs, memo: memo ?? null, contactMethod: contactMethod ?? null },
        scheme,
      ),
      ...diffContactTargetPii(storedPii, piiWrites, scheme),
    ];
    await recordContactTargetEdit(tx, {
      surveyId,
      contactTargetId: id,
      action: 'info_edit',
      changes,
      editor,
    });
  });
}

/**
 * 행 삭제. FK 동작: survey_responses 는 SET NULL(응답 보존), contact_attempts/contact_pii 는 CASCADE.
 *
 * 설문 스코프 가드: 행이 input.surveyId 소속일 때만 DELETE. CASCADE(attempts/pii 동반 삭제)는
 * 비가역적이므로 .returning() 길이로 영향 0행이면 NOT_FOUND throw 하여 사전 차단한다.
 */
export async function deleteContactTarget(
  input: DeleteContactTargetInput,
  isGuest: boolean,
): Promise<void> {
  const { id, surveyId } = input;
  await db.transaction(async (tx) => {
    const { isTest } = await lockCurrentSurveyScope(tx, surveyId, isGuest);
    const [target] = await tx
      .select({ id: contactTargets.id })
      .from(contactTargets)
      .where(
        and(
          eq(contactTargets.id, id),
          eq(contactTargets.surveyId, surveyId),
          eq(contactTargets.isTest, isTest),
        ),
      );
    if (!target) throw new ORPCError('NOT_FOUND', { message: '조사 대상을 찾을 수 없습니다.' });

    if (isTest) {
      // helper가 campaign → contact → recipient 순서로 잠근다. ambiguous sending의
      // durable payload는 webhook/23시간 terminalization까지 유지한 뒤 제거된다.
      await archiveTestMailForTargets(tx, [id]);
      await tx
        .delete(surveyResponses)
        .where(
          and(
            eq(surveyResponses.surveyId, surveyId),
            eq(surveyResponses.contactTargetId, id),
            eq(surveyResponses.isTest, true),
          ),
        );
    } else {
      await hardDeleteMailForTargets(tx, [id]);
      // actual response는 기존 의미대로 보존하고 target 연결만 제거한다.
      await tx
        .update(surveyResponses)
        .set({ contactTargetId: null })
        .where(
          and(eq(surveyResponses.surveyId, surveyId), eq(surveyResponses.contactTargetId, id)),
        );
    }
    const deleted = await tx
      .delete(contactTargets)
      .where(
        and(
          eq(contactTargets.id, id),
          eq(contactTargets.surveyId, surveyId),
          eq(contactTargets.isTest, isTest),
        ),
      )
      .returning({ id: contactTargets.id });
    if (deleted.length === 0) throw new ORPCError('NOT_FOUND', { message: '조사 대상을 찾을 수 없습니다.' });
  });
}
