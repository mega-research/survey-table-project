import { and, eq, isNotNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactPii, contactTargets, fieldworkOrgs, surveyResponses, users } from '@/db/schema';
import { decryptPiiForTargets } from '@/lib/crypto/contact-pii-repo';
import type { AuthUser } from '@/shared/contracts/auth';

import { loadSurveyAccess } from './survey-access';

/**
 * 대리 응답 세션 판정 — `data-scope`·`survey-access` 와 나란한 코어 (티켓 27, ADR-0019).
 *
 * 실사가 조사 대상 화면의 「응답 대행」으로 컨택의 초대 링크를 열면 **응답자와 똑같은 응답
 * 페이지**가 뜬다. 그 화면은 `pub` 이라 인증을 요구하지 않고, 요구해서도 안 된다 — 요구하는
 * 순간 응답자가 못 들어온다. 그래서 「지금 이 요청이 대행인가」는 화면이 말하는 것이 아니라
 * **서버가 세션·초대 토큰·capability 셋을 함께 보고** 판정한다.
 *
 * 이 파일이 코어인 이유는 판정이 도메인 하나에 속하지 않기 때문이다 — 응답 도메인이 묻고,
 * 접근 코어가 답의 절반을 갖고 있으며, 컨택 read-model 이 나머지를 갖는다.
 *
 * **화면이 보내는 값을 믿지 않는다.** 클라이언트가 `fieldworkUserId` 를 실어 보내면 누구든
 * 남의 이름으로 귀속을 위조한다. 입력은 언제나 초대 토큰과 세션 쿠키 둘뿐이다.
 *
 * **응답자 경로에는 비용이 0 이다.** 세션이 없거나 실사 계정이 아니면 첫 두 줄에서 끝난다 —
 * 이 판정은 `pub` 표면의 가장 뜨거운 경로에 얹히므로 그 단락이 계약이다.
 */
export type FieldworkProxy =
  /** 대행이 아니다 — 응답자 직접 응답이거나, 실사지만 이 설문에 초대되지 않았다. */
  | { kind: 'none' }
  /** 대행이다. `fieldworkUserId` 가 응답 행에 찍힌다. */
  | {
      kind: 'proxy';
      fieldworkUserId: string;
      fieldworkUserName: string;
      orgName: string;
      contactTargetId: string;
      resid: number;
      /**
       * 배너의 「대상 1024 **김민준**」 (.pen 10-3). 없으면 빈 문자열이고 배너는 번호만 그린다.
       *
       * 전화를 거는 사람이 화면의 대상과 손에 든 대상이 같은지 확인하는 칸이라 번호만으로는
       * 부족하다 — 실사는 이미 조사 대상 표에서 이 값을 원본으로 봤으므로 새 노출이 아니다.
       */
      contactLabel: string;
    }
  /**
   * 대행이지만 **이미 완료된 대상**이다 (.pen 10-2 「응답 완료」).
   *
   * 응답자 본인에게는 재응답 설정이 열려 있을 수 있으므로 `blocked` 는 **대행 세션에만**
   * 적용된다 — 같은 링크를 응답자가 열면 종전 정책 그대로다.
   */
  | { kind: 'blocked'; reason: 'completed' };

export async function resolveFieldworkProxy(
  user: AuthUser | null,
  surveyId: string,
  inviteToken: string | null,
): Promise<FieldworkProxy> {
  // 응답자 경로의 단락. 세션이 없거나 실사가 아니면 DB 를 한 번도 치지 않는다.
  if (user === null || user.userType !== 'fieldwork' || user.status !== 'active') {
    return { kind: 'none' };
  }
  // 대행은 **컨택을 지목해야** 성립한다. 익명 링크로 들어온 실사는 그냥 응답자다.
  if (inviteToken === null) return { kind: 'none' };

  // 초대되지 않은 설문이면 대행이 아니다. 실사 팀장의 파생 시야도 여기서 걸린다 —
  // 그 열에는 `contacts.writeAttempts` 가 없고(ADR-0019 「본인도 초대돼야 한다」),
  // 티켓 26 이 애초에 그 세션에는 초대 토큰을 주지 않는다. 이것은 그 두 번째 자물쇠다.
  // 없는 설문·**삭제된 설문**은 코어가 SurveyAccessError 로 던진다(티켓 17 — 삭제는 관문에서
  // 언제나 not_found 다). 대행 판정에서는 그것도 「대행이 아니다」로 접는다: 배너가 뜨지
  // 않을 뿐이고, 실제 차단은 응답 생성 경로의 게이트가 이미 한다.
  const access = await loadSurveyAccess(user, surveyId).catch(() => null);
  if (access === null) return { kind: 'none' };
  if (!access.capabilities.has('contacts.writeAttempts')) return { kind: 'none' };

  const [row] = await db
    .select({
      contactTargetId: contactTargets.id,
      resid: contactTargets.resid,
      attrs: contactTargets.attrs,
      completedResponseId: surveyResponses.id,
      userName: users.name,
      orgName: fieldworkOrgs.name,
    })
    .from(contactTargets)
    .leftJoin(
      surveyResponses,
      and(
        eq(surveyResponses.contactTargetId, contactTargets.id),
        eq(surveyResponses.isCompleted, true),
        isNotNull(surveyResponses.completedAt),
      ),
    )
    .innerJoin(users, eq(users.id, user.id))
    .leftJoin(fieldworkOrgs, eq(fieldworkOrgs.id, users.fieldworkOrgId))
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.inviteToken, inviteToken),
        // 실사는 언제나 real 파티션이다(data-scope 「외부 계정」). 조건을 빼면 테스트 모드가
        // 켜진 설문에서 대행이 test 대상을 열고, 그 응답이 실데이터로 집계되지 않는다.
        eq(contactTargets.isTest, false),
      ),
    )
    .limit(1);

  // 토큰이 이 설문의 것이 아니다 — 대행이 아니라고만 답한다(존재를 알려주지 않는다).
  if (!row) return { kind: 'none' };
  if (row.completedResponseId !== null) return { kind: 'blocked', reason: 'completed' };

  return {
    kind: 'proxy',
    fieldworkUserId: user.id,
    fieldworkUserName: row.userName,
    contactLabel: await contactLabelOf(row.contactTargetId, row.attrs),
    // 업체가 종료되면 조인이 비지만 대행 자체는 이미 capability 가 막는다(loadAccessSubject
    // 가 활성 업체일 때만 소속을 채운다). 여기 도달하면 업체는 활성이다.
    orgName: row.orgName ?? '',
    contactTargetId: row.contactTargetId,
    resid: row.resid,
  };
}

/**
 * 배너에 적을 대상 이름 한 칸.
 *
 * **이름 PII 를 먼저 본다.** 이름 컬럼은 암호화 저장이 흔하고, 그 경우 `attrs` 에는 아예
 * 값이 없다(업로드가 평문을 남기지 않는다). 복호는 이 한 행뿐이라 비용이 미미하고, 호출자가
 * 이미 `contacts.view` 를 지난 뒤다.
 *
 * 없으면 `attrs` 의 첫 비어 있지 않은 값으로 떨어진다 — 조사 대상 표의 기록 패널이 쓰는
 * 것과 같은 근사다. 그것도 없으면 빈 문자열이고 배너는 번호만 그린다.
 */
async function contactLabelOf(
  contactTargetId: string,
  attrs: Record<string, string> | null,
): Promise<string> {
  // `decryptPiiForTargets` 는 **컬럼 키**를 받는다(필드 유형이 아니다) — 이름 컬럼의 키는
  // 설문마다 다르므로(「이름」·「성명」·「담당자」…) 유형으로 먼저 찾아낸 뒤 넘긴다.
  const [nameColumn] = await db
    .select({ columnKey: contactPii.columnKey })
    .from(contactPii)
    .where(and(eq(contactPii.contactTargetId, contactTargetId), eq(contactPii.fieldType, 'name')))
    .limit(1);
  if (nameColumn) {
    const decrypted = await decryptPiiForTargets([contactTargetId], [nameColumn.columnKey]).catch(
      () => null,
    );
    const name = decrypted?.get(contactTargetId)?.[nameColumn.columnKey];
    if (name) return name;
  }
  for (const value of Object.values(attrs ?? {})) {
    if (value.trim()) return value.trim();
  }
  return '';
}
