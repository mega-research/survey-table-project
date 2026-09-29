import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets, surveyResponses } from '@/db/schema';
import type { FieldworkLinkSession } from '@/lib/auth/fieldwork-link-session';
import type { AuthUser } from '@/shared/contracts/auth';

import { resolveLinkActorForSurvey } from './fieldwork-link';
import {
  accountAttribution,
  type ActorAttribution,
  linkAttribution,
  loadSurveyAccess,
} from './survey-access';

/**
 * 대리 응답 세션 판정 — `data-scope`·`survey-access`·`fieldwork-link` 와 나란한 코어
 * (티켓 27, ADR-0019 → ADR-0026 티켓 09).
 *
 * 외주가 조사 대상 화면의 「응답 대행」으로 컨택의 초대 링크를 열면 **응답자와 똑같은 응답
 * 페이지**가 뜬다. 그 화면은 `pub` 이라 인증을 요구하지 않고, 요구해서도 안 된다 — 요구하는
 * 순간 응답자가 못 들어온다. 그래서 「지금 이 요청이 대행인가」는 화면이 말하는 것이 아니라
 * **서버가 세션·초대 토큰·capability 셋을 함께 보고** 판정한다.
 *
 * 이 파일이 코어인 이유는 판정이 도메인 하나에 속하지 않기 때문이다 — 응답 도메인이 묻고,
 * 접근 코어가 답의 절반을 갖고 있으며, 컨택이 나머지를 갖는다.
 *
 * ## 화면이 보내는 값을 믿지 않는다
 *
 * 클라이언트가 링크 id 나 사용자 id 를 실어 보내면 누구든 남의 이름으로 귀속을 위조한다.
 * 입력은 언제나 **초대 토큰과 쿠키 둘뿐**이다. 쿠키가 여럿일 때(업체가 두 조사를 병행한다)
 * 어느 것을 볼지는 **초대 토큰이 속한 설문 id** 가 정한다.
 *
 * ## 배너가 사라졌다 (티켓 09)
 *
 * 예전에는 대행 여부를 화면 맨 위 띠로 알렸고, 그것을 물을지 정하려고 주소에 `?fw=1` 힌트가
 * 붙었다. ADR-0026 이 **대행 표시를 없앴으므로** 물을 것이 사라졌고 힌트도 함께 걷었다 —
 * 그 파라미터의 유일한 목적이 배너였다. 지금 이 판정의 결과는 **귀속과 차단에만** 쓰인다.
 *
 * ## 응답자 경로에는 비용이 0 이다
 *
 * 계정 세션도 링크 쿠키도 없으면 첫 줄에서 끝난다 — 이 판정은 `pub` 표면의 가장 뜨거운
 * 경로에 얹히므로 그 단락이 계약이다. `?fw=1` 이 막아 주던 왕복이 애초에 없어진 이유다.
 */
export type FieldworkProxy =
  /** 대행이 아니다 — 응답자 직접 응답이거나, 이 설문의 자격이 없다. */
  | { kind: 'none' }
  /** 대행이다. 아래 귀속이 응답 행에 찍힌다. */
  | { kind: 'proxy'; contactTargetId: string; attribution: ActorAttribution }
  /**
   * 대행이지만 **이미 완료된 대상**이다.
   *
   * 응답자 본인에게는 재응답 설정이 열려 있을 수 있으므로 `blocked` 는 **대행 세션에만**
   * 적용된다 — 같은 링크를 응답자가 열면 종전 정책 그대로다.
   */
  | { kind: 'blocked'; reason: 'completed' };

/**
 * 판정이 보는 요청의 임자 — 계정 세션과 링크 쿠키 둘 다 없을 수 있다.
 *
 * `ORPCContext` 가 이 모양을 구조적으로 만족하므로 호출부는 컨텍스트를 그대로 넘긴다. 코어가
 * RPC 를 모르는 채로 남는 것이 요점이다.
 */
export interface FieldworkProxySubject {
  user: AuthUser | null;
  /** 서명만 검증된 링크 세션 후보 — 「지금도 유효한가」는 이 파일이 링크 행을 읽어 답한다. */
  linkSessions?: readonly FieldworkLinkSession[] | undefined;
}

export async function resolveFieldworkProxy(
  subject: FieldworkProxySubject,
  surveyId: string,
  inviteToken: string | null,
): Promise<FieldworkProxy> {
  // 대행은 **컨택을 지목해야** 성립한다. 익명 링크로 들어왔으면 그냥 응답자다.
  if (inviteToken === null) return { kind: 'none' };

  const attribution = await resolveProxyAttribution(subject, surveyId);
  if (attribution === null) return { kind: 'none' };

  const [row] = await db
    .select({
      contactTargetId: contactTargets.id,
      completedResponseId: surveyResponses.id,
    })
    .from(contactTargets)
    .leftJoin(
      surveyResponses,
      and(
        eq(surveyResponses.contactTargetId, contactTargets.id),
        eq(surveyResponses.isCompleted, true),
        isNotNull(surveyResponses.completedAt),
        // 삭제된 완료 응답은 차단하지 않는다 — 담당 연구원이 불량 응답을 지우고 재실사를
        // 지시하는 것이 정상 동선인데, 술어가 없으면 그 대상이 영구히 대행 불가가 된다.
        isNull(surveyResponses.deletedAt),
      ),
    )
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.inviteToken, inviteToken),
        // 외부 주체는 언제나 real 파티션이다(data-scope 「외부 주체」). 조건을 빼면 테스트
        // 모드가 켜진 설문에서 대행이 test 대상을 열고, 그 응답이 실데이터로 집계되지 않는다.
        eq(contactTargets.isTest, false),
      ),
    )
    .limit(1);

  // 토큰이 이 설문의 것이 아니다 — 대행이 아니라고만 답한다(존재를 알려주지 않는다).
  if (!row) return { kind: 'none' };
  if (row.completedResponseId !== null) return { kind: 'blocked', reason: 'completed' };

  return { kind: 'proxy', contactTargetId: row.contactTargetId, attribution };
}

/**
 * 이 주체가 이 설문을 대행할 자격이 있는가 — 있으면 귀속, 없으면 `null`.
 *
 * 자격은 **`contacts.writeAttempts` 하나**다. 두 모델이 같은 문을 지나는 것이 요점이다 —
 * 외주 실사 링크는 그 capability 를 갖고(ADR-0026), 옛 실사 계정은 초대됐을 때만 갖는다
 * (ADR-0019 의 「본인도 초대돼야 한다」). 실사 팀장의 파생 시야는 그 칸이 없어 여기서 걸린다.
 *
 * **링크를 먼저 본다.** `scoped` 베이스가 계정을 먼저 보는 것과 반대인데, 이유가 그 반대다 —
 * 여기서는 「누구의 이름으로 기록할 것인가」를 정하고, 응답 화면을 실제로 연 것은 링크
 * 콘솔에서 넘어온 외주다. 연구원이 자기 계정으로 초대 링크를 열어 보는 것은 대행이 아니며
 * (계정이 실사 유형이 아니라 아래 분기에서 `none` 이다) 그 경우 귀속도 남지 않는다.
 */
async function resolveProxyAttribution(
  subject: FieldworkProxySubject,
  surveyId: string,
): Promise<ActorAttribution | null> {
  const link = await resolveLinkActorForSurvey(subject.linkSessions, surveyId);
  if (link.kind === 'ok') {
    const access = await loadSurveyAccess(link.actor, surveyId).catch(() => null);
    if (access?.capabilities.has('contacts.writeAttempts')) {
      return linkAttribution(link.actor.linkId);
    }
    return null;
  }

  // 옛 실사 계정 모델 (ADR-0019) — 철거는 별도 스펙이라 공존 창 동안 그대로 둔다.
  // 응답자 경로의 단락도 여기다: 세션이 없거나 실사가 아니면 DB 를 한 번도 치지 않는다.
  const user = subject.user;
  if (user === null || user.userType !== 'fieldwork' || user.status !== 'active') return null;
  // 없는 설문·**삭제된 설문**은 코어가 SurveyAccessError 로 던진다(티켓 17 — 삭제는 관문에서
  // 언제나 not_found 다). 대행 판정에서는 그것도 「대행이 아니다」로 접는다: 실제 차단은 응답
  // 생성 경로의 게이트가 이미 한다.
  const access = await loadSurveyAccess(user, surveyId).catch(() => null);
  if (!access?.capabilities.has('contacts.writeAttempts')) return null;
  return accountAttribution(user.id);
}

/**
 * 확정된 응답 행에 귀속을 찍는다 — **대행의 유일한 쓰기 지점** (티켓 27).
 *
 * 처음에는 진입 서비스마다 귀속을 인자로 흘려보냈는데, 그 구조는 새 진입 경로가 생길 때마다
 * 인자를 또 실어야 하고 **실제로 세 곳을 놓쳤다**: 버전 이관이 성공한 재개
 * (`migrateResumedRowIfStale`), 기존 행을 물려받는 생성(`insertResponseWithContactReuse` 의
 * takeover), 대상자 테스트 lane. 셋 다 배너는 뜨는데 귀속이 NULL 이었다.
 *
 * 그래서 「어떻게 행이 생겼는가」를 묻지 않는다. **행 id 가 확정된 뒤 한 번** 찍는다 —
 * 진입 경로가 몇 개든 전부 그 지점을 지나므로 누락이 구조적으로 불가능해진다.
 *
 * **컨택 일치를 함께 건다.** 세션 폴백으로 돌아온 행이 이 초대의 컨택이 아닐 수 있고, 그때
 * 찍으면 남의 응답에 귀속이 붙는다. 조건이 안 맞으면 조용히 0행이다 — 진입 자체는 이미
 * 성공했으므로 여기서 던지면 응답을 막게 된다.
 *
 * **덮어쓰되 null 로 지우지는 않는다.** 한 대상을 둘이 나눠 뛰면 마지막 진입자가 남고
 * (이 컬럼의 눈금은 응답 하나이지 저장 한 번이 아니다), 응답자가 이어받아도 그 응답은 실제로
 * 일부가 대행이므로 표식이 남아야 한다 — 대행이 아닌 요청은 애초에 여기 오지 않는다.
 */
export async function stampFieldworkAttribution(
  responseId: string,
  proxy: FieldworkProxy,
): Promise<void> {
  if (proxy.kind !== 'proxy') return;
  await db
    .update(surveyResponses)
    .set({
      fieldworkUserId: proxy.attribution.accountUserId,
      fieldworkLinkId: proxy.attribution.fieldworkLinkId,
    })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.contactTargetId, proxy.contactTargetId),
      ),
    );
}
