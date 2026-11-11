import { and, asc, eq, inArray } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactPii, contactTargets } from '@/db/schema';
import { resolveMailEmailOrder } from '@/lib/contacts/mail-email-order';
import { upsertPiiValue } from '@/lib/crypto/contact-pii-repo';
import { generateInviteCode } from '@/lib/survey-url';
import { lockWriteScope } from '@/server/data-scope';
import { InternalFailure } from '@/server/internal-failure';
import { loadMailEmailOrder, resolveSendAddresses } from '@/server/read-models/send-address';

import { prepareContactInsertScope } from './contact-insert-scope';
import { allocateContactResid } from './contact-resid';
import { resolveTestContactFieldBindings } from './test-contact-columns';

/** 테스트 대상자 상한(prepareContactInsertScope 와 같은 수) — 사본을 못 만들 때의 안내 문구용 */
const TEST_TARGET_LIMIT = 20;

export type TestSendTargetResult =
  /**
   * 눌러서 열리는 테스트 대상자 링크. created = 이번에 사본을 새로 만들었다.
   * attrs = 그 대상자의 명단 값 — 메일 본문 치환이 같은 값을 쓰게 호출부가 발송에 넘긴다
   * (발송이 샘플을 다시 읽으면 그 사이 고쳐진 값으로 본문과 링크가 어긋난다).
   */
  | { kind: 'live'; inviteCode: string; created: boolean; attrs: Record<string, string> }
  /** 테스트 대상자 링크를 줄 수 없다 — 호출부는 견본 링크를 쓴다 */
  | { kind: 'sandbox'; reason: 'test-mode-off' | 'guest' | 'sample-missing' | 'no-test-targets' }
  /** 새 사본이 필요한데 테스트 대상자가 상한이다 — 호출부는 발송하지 않고 문구를 돌려준다 */
  | { kind: 'limit'; message: string };

/** attrs 비교 — 키 순서와 무관하게 같은 열·같은 값이면 같다 */
function sameAttrs(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string => {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  };
  return norm(a) === norm(b);
}

const sameEmail = (a: string | null | undefined, b: string) =>
  (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

/**
 * 메일 「테스트 발송」의 초대 링크로 쓸 **테스트 대상자**를 정한다 (CONTEXT.md 「테스트 발송」).
 *
 * - 샘플이 테스트 대상자면 그 대상자.
 * - 샘플이 실제 조사 대상이면 그 명단 값(attrs·groupValue)을 복사한 테스트 사본 — 없으면 만든다.
 *   개인정보 열은 복사하지 않고 이메일 열에 테스트 수신 주소만 넣는다. 실제 대상자의 초대 링크는
 *   어떤 경우에도 돌려주지 않는다.
 * - 다시 쓰는 것은 **사본과 구별되지 않는** 테스트 대상자뿐이다: attrs·groupValue 가 같고, 발송 주소가
 *   수신 주소와 같고, 개인정보 칸이 그 이메일 하나뿐. 이름·전화가 든 손으로 만든 테스트 대상자는
 *   다시 쓰지 않는다 — 그 값이 링크를 받은 사람에게 보인다.
 * - 수신 주소는 **발송이 실제로 읽는 이메일 열**(발송 순위 1번, 없으면 테스트 이메일 열)에 넣는다.
 *   다른 열에 넣으면 다시 쓰기 판정이 그 주소를 못 찾아 발송마다 사본이 는다.
 * - 테스트 대상자가 한 명도 없는 설문에서는 사본을 만들지 않는다(견본). 첫 테스트 대상자가 생기는 순간
 *   익명 테스트 링크가 무효가 되고(`getSurveyForResponse`) 익명 테스트 응답이 지워지기 때문이다
 *   (`prepareContactInsertScope`) — 그 전환은 담당자가 「테스트 조사 대상자 생성」으로 직접 한다.
 *
 * 설문 행을 `FOR UPDATE` 로 잠근 채 찾고 만든다 — 테스트 대상자 생성·테스트 모드 전환과 직렬화되고,
 * 같은 발송이 동시에 두 번 와도 사본은 하나다. isGuest 는 procedure 가 인증한 사용자에서 파생해 넘긴다.
 */
export async function ensureTestSendTarget(input: {
  surveyId: string;
  /** 샘플 조사 대상 id — 서버가 고른 것(첫 조사 대상). 값은 여기서 다시 읽는다 */
  sampleTargetId: string;
  /** 테스트 메일을 받을 주소 — 사본의 이메일 칸에 들어간다 */
  recipientEmail: string;
  isGuest: boolean;
}): Promise<TestSendTargetResult> {
  if (input.isGuest) return { kind: 'sandbox', reason: 'guest' };

  return db.transaction(async (tx) => {
    const locked = await lockWriteScope(tx, input.surveyId, false, { lock: 'update' });
    if (!locked || !locked.row.enabled) return { kind: 'sandbox', reason: 'test-mode-off' } as const;

    const [sample] = await tx
      .select({
        id: contactTargets.id,
        isTest: contactTargets.isTest,
        attrs: contactTargets.attrs,
        groupValue: contactTargets.groupValue,
        inviteCode: contactTargets.inviteCode,
      })
      .from(contactTargets)
      .where(
        and(eq(contactTargets.id, input.sampleTargetId), eq(contactTargets.surveyId, input.surveyId)),
      )
      .limit(1);
    if (!sample) return { kind: 'sandbox', reason: 'sample-missing' } as const;
    const attrs = (sample.attrs ?? {}) as Record<string, string>;
    if (sample.isTest) {
      return { kind: 'live', inviteCode: sample.inviteCode, created: false, attrs } as const;
    }

    const testTargets = await tx
      .select({
        id: contactTargets.id,
        attrs: contactTargets.attrs,
        groupValue: contactTargets.groupValue,
        inviteCode: contactTargets.inviteCode,
      })
      .from(contactTargets)
      .where(and(eq(contactTargets.surveyId, input.surveyId), eq(contactTargets.isTest, true)))
      .orderBy(asc(contactTargets.resid));

    if (testTargets.length === 0) return { kind: 'sandbox', reason: 'no-test-targets' } as const;

    const candidates = testTargets.filter(
      (t) => sameAttrs(t.attrs, sample.attrs) && (t.groupValue ?? null) === (sample.groupValue ?? null),
    );
    if (candidates.length > 0) {
      const candidateIds = candidates.map((t) => t.id);
      const order = await loadMailEmailOrder(input.surveyId, true, tx);
      const addresses = await resolveSendAddresses(tx, candidateIds, order);
      const piiRows = await tx
        .select({ contactTargetId: contactPii.contactTargetId })
        .from(contactPii)
        .where(inArray(contactPii.contactTargetId, candidateIds));
      const piiCount = new Map<string, number>();
      for (const row of piiRows) {
        piiCount.set(row.contactTargetId, (piiCount.get(row.contactTargetId) ?? 0) + 1);
      }
      const reusable = candidates.find((t) => {
        const resolved = addresses.get(t.id);
        return (
          resolved?.kind === 'send' &&
          sameEmail(resolved.email, input.recipientEmail) &&
          // 개인정보 칸이 그 이메일 하나뿐 — 사본과 같은 모양일 때만
          piiCount.get(t.id) === 1
        );
      });
      if (reusable) {
        return { kind: 'live', inviteCode: reusable.inviteCode, created: false, attrs } as const;
      }
    }

    if (testTargets.length >= TEST_TARGET_LIMIT) {
      return {
        kind: 'limit',
        message: `테스트 대상자가 ${TEST_TARGET_LIMIT}명이라 열리는 테스트 링크를 새로 만들 수 없습니다. 「테스트 데이터 보기」에서 쓰지 않는 테스트 대상자를 지운 뒤 다시 보내 주세요.`,
      } as const;
    }

    const prepared = await prepareContactInsertScope(tx, {
      surveyId: input.surveyId,
      requestedCount: 1,
      requireEmptyTestScope: false,
      isGuest: false,
      forceTestScope: true,
    });
    if (!prepared.scheme) throw new InternalFailure('테스트 대상자 컬럼을 찾을 수 없습니다.');
    // 발송이 읽는 열에 넣는다 — 순위가 걸려 있으면 1순위 열, 없으면 테스트 이메일 열(전 열이 후보다).
    const emailColumnKey =
      resolveMailEmailOrder(prepared.scheme)?.[0] ??
      resolveTestContactFieldBindings(prepared.scheme).email.columnKey;

    const resid = await allocateContactResid(tx, input.surveyId, true);
    const [created] = await tx
      .insert(contactTargets)
      .values({
        surveyId: input.surveyId,
        resid,
        isTest: true,
        groupValue: sample.groupValue,
        attrs: sample.attrs,
        inviteCode: generateInviteCode(),
      })
      .returning({ id: contactTargets.id, inviteCode: contactTargets.inviteCode });
    if (!created) throw new InternalFailure('테스트 사본 대상자 저장에 실패했습니다.');
    await upsertPiiValue(tx, created.id, emailColumnKey, 'email', input.recipientEmail);

    return { kind: 'live', inviteCode: created.inviteCode, created: true, attrs } as const;
  });
}
