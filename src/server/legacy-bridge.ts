import { and, eq, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyAccessLinks, surveys } from '@/db/schema';
import { isLegacyBridgeSurvey } from '@/lib/auth/legacy-guest-link';
import { decryptSharedSecret } from '@/lib/crypto/aes';
import { constantTimeEquals } from '@/lib/crypto/constant-time';

import { type AccessLinkAuthResult, isClosed, linkRowColumns, signedIn } from './access-link';

/**
 * 옛 주소 다리 — 옛 게스트 주소(설문 id 만 담은 `/admin/surveys/<id>/operations`)로 온 업체를 외주 링크 하나로
 * 이어 주는 **전환기 장치**다 (fieldwork-multi-company 티켓 10, `src/lib/auth/AGENTS.md` 「게이트는 2단이다」).
 *
 * 링크 세션 판정 코어(`server/access-link`)에서 떼어 둔 것은 수명이 달라서다 — 허용 목록(`GUEST_SURVEY_GRANTS`)을
 * 비우면 꺼지고 옛 주소가 사라지면 이 파일째 지운다. 링크 행의 모양·닫힘 판정·세션 서명은 코어의 것을 그대로
 * 쓴다(`linkRowColumns`·`isClosed`·`signedIn`) — 다리가 닫힘을 따로 판정하면 `/fw` 접속과 갈린다.
 *
 * 소비자는 셋이다: 다리 비밀번호 화면(`app/fw/legacy/[surveyId]`)의 입구 `isLegacyBridgeOpen`, 접속 표면
 * `accessLinkSession.authenticateLegacyBridge` 의 `authenticateLegacyBridge`. 링크를 쿠키로 고르는 다리
 * 라우트(`app/api/legacy-guest-link`)는 RPC 주체 판정과 같은 `resolveLinkActorForSurvey`(코어)를 쓴다.
 */

/**
 * 옛 주소 다리의 비밀번호 한 칸 — **토큰 없이 설문 id 와 비밀번호로** 외주 링크 하나를 고른다.
 *
 * 옛 게스트 주소는 설문 id 만 담고 있어, 외주 링크가 업체 수만큼 선 설문에서는 주소로 링크를
 * 정할 수 없다. 그래서 그 설문의 **열린 외주 링크 비밀번호 전부**와 대조해 정확히 하나가 맞을 때만
 * 그 링크로 들어온다 — 이 경로에서는 비밀번호만이 업체 사이 칸막이다(모든 업체가 설문 id 를 안다).
 *
 * - **허용 목록 밖 설문은 DB 를 묻지 않는다**(`isLegacyBridgeSurvey`). 이 표면이 아무 설문에나
 *   열리면 모든 설문의 외주 링크가 토큰 없이 비밀번호 하나로 두드려진다.
 * - 0개도 2개 이상도 같은 `denied` 다. 「둘 다 맞았다」를 가르면 그 응답이 곧 「다른 업체가 같은
 *   비밀번호를 쓴다」의 확인이 되고, 어느 쪽으로 보내도 엉뚱한 업체 콘솔이 열릴 수 있다.
 * - 대조는 **링크 전부를 끝까지** 돈다 — 맞는 것을 찾자마자 멈추면 응답 시간이 「몇 번째 링크가
 *   맞았나」를 흘린다. 각 대조는 `constantTimeEquals` 다.
 * - 닫힘(중단·설문 종료·삭제·배치 대기)은 맞는 비밀번호에만 말해 준다 — `/fw` 의 접속과 같은 결이다.
 *   종료된 링크(`closedAt`)는 후보에서 뺀다: 닫힌 링크의 옛 비밀번호로 남은 링크가 열리지 않는다.
 * - 반환 모양은 `/fw` 접속과 같다. 이름표·조사 이름·링크 목록은 싣지 않는다(코어는 고르지도 않는다).
 */
export async function authenticateLegacyBridge(
  surveyId: string,
  password: string,
): Promise<AccessLinkAuthResult> {
  const normalizedId = surveyId.toLowerCase();
  if (!isLegacyBridgeSurvey(normalizedId)) return { ok: false, reason: 'denied' };

  const rows = await loadOpenFieldworkRows(normalizedId);
  const given = password.trim();
  const matches = rows.filter((row) =>
    constantTimeEquals(decryptSharedSecret(row.passwordCipher), given),
  );
  if (matches.length !== 1) return { ok: false, reason: 'denied' };
  const match = matches[0]!;
  if (isClosed(match)) return { ok: false, reason: 'closed' };
  return signedIn(match, match.token);
}

/**
 * 다리 비밀번호 화면을 열 수 있는가 — 허용 목록에 든 설문이면 언제나 비밀번호 칸이다. **DB 를 묻지 않는다.**
 *
 * 화면에 실릴 것이 없다: 조사 이름·업체 목록·이름표·링크 수는 물론 **닫힘도** 입구에서는 말하지 않는다.
 * 이 화면은 설문 id 만 아는 사람 누구나 여는데, 닫힘(중단·설문 종료·삭제·배치 대기)을 비밀번호 없이 말하면
 * 설문 상태가 그 사람에게 새어 나간다 — 위 접속 함수의 「닫힘은 맞는 비밀번호에만」과 같은 규칙이다. 맞는
 * 비밀번호의 `closed` 를 받은 비밀번호 칸이 그 자리에서 닫힘 안내로 바뀐다. 열린 외주 링크가 없어도 칸은
 * 같다(무엇을 넣어도 `denied` — 「링크가 없다」를 말하지 않는다). 허용 목록 밖이면 `false` 다(화면이 다리가
 * 꺼진 자리로 보낸다).
 */
export function isLegacyBridgeOpen(surveyId: string): boolean {
  return isLegacyBridgeSurvey(surveyId.toLowerCase());
}

/** 그 설문의 열린(종료되지 않은) 외주 링크 행 전부 — 설문 상태 조인까지. */
async function loadOpenFieldworkRows(surveyId: string) {
  return db
    .select({ ...linkRowColumns(), token: surveyAccessLinks.token })
    .from(surveyAccessLinks)
    .innerJoin(surveys, eq(surveys.id, surveyAccessLinks.surveyId))
    .where(
      and(
        eq(surveyAccessLinks.surveyId, surveyId),
        eq(surveyAccessLinks.kind, 'fieldwork'),
        isNull(surveyAccessLinks.closedAt),
      ),
    );
}
