import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyFieldworkLinks, surveys } from '@/db/schema';
import { decryptSharedSecret } from '@/lib/crypto/aes';
import { constantTimeEquals } from '@/lib/crypto/constant-time';
import {
  fieldworkLinkCookieName,
  FIELDWORK_LINK_SESSION_MAX_AGE_SECONDS,
  isFieldworkLinkToken,
  readFieldworkLinkSessions,
  signFieldworkLinkSession,
  type FieldworkLinkSession,
} from '@/lib/auth/fieldwork-link-session';
import type { SurveyAssignmentStatus } from '@/shared/contracts/workspace';

import { type LinkActor, surveyClosedColumn } from './survey-access';

/**
 * 외주 실사 링크 세션의 판정 코어 — `data-scope`·`survey-access`·`fieldwork-proxy` 와 나란한
 * 자리다 (ADR-0026).
 *
 * 판정이 도메인 하나에 속하지 않기 때문에 코어다: 링크 행은 workspace 가 갖고, 「열려 있는
 * 설문인가」는 설문 도메인이 갖고, 그 결과로 무엇을 할 수 있는가는 접근 코어가 답한다.
 *
 * ## 입력은 토큰과 쿠키 둘뿐이다
 *
 * 화면이 실어 보내는 값은 계약에 없다. `linkId` 를 클라이언트가 보낼 수 있으면 누구든 남의
 * 링크 세션을 주장하고, 그 주장이 그대로 귀속(결과코드 회차·대리 응답)에 찍힌다 —
 * `fieldwork-proxy` 가 `fieldworkUserId` 를 계약에서 뺀 것과 같은 이유다.
 *
 * ## 사유는 둘로만 갈린다
 *
 * **닫힘**(중단·설문 종료·링크 종료·삭제·배치 대기)과 **그 밖 전부**(비밀번호 화면)다.
 *  - 「없는 토큰」과 「틀린 비밀번호」를 가르지 않는다. 가르면 주소 스캔이 링크의 존재를
 *    확인하는 창구가 된다.
 *  - 반대로 닫힘은 말해 준다. 링크를 **이미 가진 사람**에게만 보이는 정보라 새는 것이 없고,
 *    감추면 외주가 오타로 오해해 연구원에게 문의한다(스토리 21).
 *
 * 스펙이 적었던 `locked`(한도 초과) 사유는 여기 없다. 레이트리밋은 Redis 를 치는 RPC
 * 미들웨어(`withRateLimit('fieldwork-link-auth')`)의 일이고, 코어가 그것을 알면 판정이
 * 외부 자원에 묶인다 — 화면이 보는 「잠시 후 다시」는 그 미들웨어의 TOO_MANY_REQUESTS 다.
 *
 * ## 링크 행을 여기서 또 읽는 이유
 *
 * `server/workspace/services/fieldwork-links` 도 같은 테이블을 읽지만 묻는 것이 다르다 —
 * 저쪽은 `surveyId` 로 「연구원에게 보여줄 링크 상태」를, 이쪽은 `token` 으로 「이 요청이
 * 유효한 세션인가」를 묻고 설문 행까지 함께 본다. 한쪽으로 합치면 관문이 도는 모든 요청이
 * 연구원 화면용 모양을 만들고 버린다.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 링크 행 + 설문 상태
// ─────────────────────────────────────────────────────────────────────────────

interface LinkRow {
  linkId: string;
  surveyId: string;
  surveyTitle: string;
  passwordCipher: string;
  passwordUpdatedAt: Date;
  /** 링크 종료 시각 — 종료된 행은 계보로 남는다(0126 부분 UNIQUE). */
  closedAt: Date | null;
  /** 설문 중단 — 링크의 만료일을 대신한다(ADR-0026). 재개하면 같은 주소로 다시 열린다. */
  isPaused: boolean;
  /**
   * 설문 종료(ADR-0030) — 조사가 끝나 외부 접근을 전부 닫는다. 링크 행의 `closedAt`(이 링크만
   * 닫는다)과 다른 사실이다: 이쪽은 설문 상태에서 파생되고 링크 행을 건드리지 않으므로,
   * 종료를 취소하거나 다시 발행하면 같은 주소·같은 비밀번호로 다시 열린다.
   */
  surveyClosed: boolean;
  /** 어휘는 workspace 계약이 소유한다 — 문자열로 넓히면 오타가 tsc 를 지나간다. */
  assignmentStatus: SurveyAssignmentStatus;
  deletedAt: Date | null;
}

/**
 * 토큰으로 링크 행을 읽는다 — **종료된 행도 읽는다.**
 *
 * `closedAt IS NULL` 을 WHERE 에 걸면 종료된 링크가 「없는 토큰」이 되어 비밀번호 화면이 뜬다.
 * 그러면 외주는 비밀번호를 몇 번이고 다시 넣어 본다 — 닫힘을 말해 주는 판단과 어긋난다.
 */
async function loadLinkRow(token: string): Promise<LinkRow | null> {
  // 모양이 아니면 조회하지 않는다 — 주소에서 온 아무 문자열로 DB 를 치지 않기 위해서이고,
  // 세 진입점이 같은 가드를 각자 쓰지 않게 하려는 것이기도 하다.
  if (!isFieldworkLinkToken(token)) return null;
  const [row] = await db
    .select({
      linkId: surveyFieldworkLinks.id,
      surveyId: surveyFieldworkLinks.surveyId,
      surveyTitle: surveys.title,
      passwordCipher: surveyFieldworkLinks.passwordCipher,
      passwordUpdatedAt: surveyFieldworkLinks.passwordUpdatedAt,
      closedAt: surveyFieldworkLinks.closedAt,
      isPaused: surveys.isPaused,
      surveyClosed: surveyClosedColumn,
      assignmentStatus: surveys.assignmentStatus,
      deletedAt: surveys.deletedAt,
    })
    .from(surveyFieldworkLinks)
    .innerJoin(surveys, eq(surveys.id, surveyFieldworkLinks.surveyId))
    .where(eq(surveyFieldworkLinks.token, token))
    .limit(1);
  return row ?? null;
}

/**
 * 「닫혔는가」 — 다섯 사유가 한 답으로 모인다.
 *
 * 판정 코어(`resolveSurveyCapabilities`)의 링크 분기도 중단·종료·배치 대기를 보고 빈 집합을 준다.
 * 같은 사실을 두 곳이 보는 것이 중복처럼 읽히지만 묻는 시점이 다르다 — 이쪽은 「문을 열어
 * 줄까」이고 저쪽은 「문을 지난 주체가 무엇을 할 수 있는가」다. 이쪽만 있으면 중단 중에
 * 이미 들어와 있던 세션이 계속 움직이고, 저쪽만 있으면 닫힘 화면을 그릴 재료가 없다.
 */
function isClosed(row: LinkRow): boolean {
  return (
    row.closedAt !== null ||
    row.deletedAt !== null ||
    row.isPaused ||
    row.surveyClosed ||
    row.assignmentStatus === 'assignment_pending'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 세션 판정
// ─────────────────────────────────────────────────────────────────────────────

/** 거부 사유 — 화면은 `closed` 만 갈라 보고 나머지는 비밀번호 화면으로 접는다. */
export type LinkActorDenial = 'unknown' | 'closed' | 'unauthenticated';

export type LinkActorResult =
  | { ok: true; actor: LinkActor }
  | { ok: false; reason: LinkActorDenial };

/**
 * 이 요청이 이 링크의 유효한 세션인가 — 관문이 부르는 정본.
 *
 * 쿠키의 `passwordUpdatedAt` 을 **DB 값과 문자열로 대조**하는 것이 세션 폐기 장치다.
 * 비밀번호를 바꾸면 그 컬럼이 갱신되고, 이미 들어와 있던 세션은 다음 요청에서 끊긴다.
 * 시각의 대소를 보지 않으므로 앱·DB 시계가 어긋나도 흔들리지 않는다.
 */
export async function resolveLinkActor(
  token: string,
  headers: Headers,
): Promise<LinkActorResult> {
  const row = await loadLinkRow(token);
  if (!row) return { ok: false, reason: 'unknown' };
  return evaluateSession(row, token, headers);
}

/**
 * 이 설문의 링크 세션을 골라 검증한 결과 — **「없다」와 「죽었다」를 가른다** (티켓 06).
 *
 * 둘을 합치면 호출부가 사유를 고를 수 없다. 이 설문의 쿠키가 아예 없으면 그 설문은 이
 * 주체에게 **존재하지 않는 것**이고(게스트의 미부여 설문과 같다), 있었는데 더는 유효하지
 * 않으면(비밀번호 변경·종료·중단) **다시 접속해야 하는 것**이다. 한 코드로 뭉뚱그리면 타
 * 설문 id 하나가 「세션이 끊겼다」로 보여 외주가 멀쩡한 비밀번호를 다시 넣는다.
 */
export type LinkActorForSurvey =
  | { kind: 'ok'; actor: LinkActor }
  /** 이 설문의 쿠키가 없다 — 이 주체에게 그 설문은 없는 것이다. */
  | { kind: 'no_session' }
  /** 쿠키는 있었지만 더는 서지 않는다 — 다시 접속해야 한다. */
  | { kind: 'invalid' };

/**
 * 요청이 들고 온 링크 세션 중 **이 설문의 것**을 골라 검증한다 — scoped 베이스의 재료 (티켓 06).
 *
 * `resolveLinkActor` 와 묻는 방향이 반대다. 저쪽은 주소의 토큰으로 「이 링크가 열리는가」를
 * 묻고(입구 화면·RSC), 이쪽은 입력의 설문 id 로 「이 요청을 낸 주체가 누구인가」를 묻는다 —
 * RPC 에는 토큰이 실리지 않는다. 그래서 쿠키 **이름**이 아니라 payload 의 `surveyId` 로
 * 고른다: 그 필드를 담아 둔 이유가 여기에 있다(티켓 05 의 주석이 예고한 자리).
 *
 * 고르기만 payload 로 하고 **판정은 전부 행이 한다.** 쿠키의 주장이 행과 어긋나면 거부이고,
 * 주체의 설문은 언제나 `row.surveyId` 다 — 서명된 값이라 위조되지 않지만, 정본을 행에 두면
 * 「쿠키가 말하는 설문」과 「링크가 여는 설문」이 갈릴 여지 자체가 없다.
 *
 * 무효 사유는 **한 값으로 접는다**(`invalid`). 종료·중단·비밀번호 변경을 갈라 돌려주면 그
 * 응답이 곧 링크 상태를 알려 주는 창구가 되고, 호출부가 할 수 있는 일은 어차피 하나다.
 */
export async function resolveLinkActorForSurvey(
  sessions: readonly FieldworkLinkSession[] | undefined,
  surveyId: string,
): Promise<LinkActorForSurvey> {
  const candidate = sessions?.find((session) => session.claim.surveyId === surveyId);
  if (!candidate) return { kind: 'no_session' };
  const row = await loadLinkRow(candidate.token);
  if (!row) return { kind: 'invalid' };
  if (isClosed(row)) return { kind: 'invalid' };
  if (row.surveyId !== surveyId) return { kind: 'invalid' };
  if (candidate.claim.linkId !== row.linkId) return { kind: 'invalid' };
  if (candidate.claim.passwordUpdatedAt !== row.passwordUpdatedAt.toISOString()) {
    return { kind: 'invalid' };
  }
  return { kind: 'ok', actor: { kind: 'link', linkId: row.linkId, surveyId: row.surveyId } };
}

/**
 * 행을 이미 읽은 뒤의 판정 — 입구 화면과 왕복 하나를 나눠 쓴다.
 *
 * DB 를 치지 않을 뿐 순수 함수는 아니다(요청 헤더를 읽는다).
 */
function evaluateSession(row: LinkRow, token: string, headers: Headers): LinkActorResult {
  if (isClosed(row)) return { ok: false, reason: 'closed' };
  // 이 토큰의 쿠키만 본다 — 다른 설문 링크의 세션으로 이 설문이 열리면 칸막이가 없다.
  const session = readFieldworkLinkSessions(headers).find((s) => s.token === token);
  if (!session) return { ok: false, reason: 'unauthenticated' };
  if (session.claim.linkId !== row.linkId) return { ok: false, reason: 'unauthenticated' };
  // `claim.surveyId` 는 **여기서 대조하지 않는다.** 주체의 설문은 언제나 잠긴 행에서 오고
  // (`row.surveyId`) 링크 행의 설문은 바뀌지 않으므로 대조는 항상 참이다. 그 필드를 payload 에
  // 담은 이유는 다른 데 있다 — 쿠키가 여럿인 요청에서 **DB 를 읽기 전에** 어느 쿠키가 이
  // 설문의 것인지 고르는 데 쓴다(티켓 06 의 scoped 관문).

  if (session.claim.passwordUpdatedAt !== row.passwordUpdatedAt.toISOString()) {
    return { ok: false, reason: 'unauthenticated' };
  }
  return { ok: true, actor: { kind: 'link', linkId: row.linkId, surveyId: row.surveyId } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 입구 화면
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 링크 주소를 열었을 때 무엇을 그릴지.
 *
 * `surveyTitle` 이 **없을 수 있는 것이 계약이다** — 없는 토큰에는 보여줄 조사가 없다.
 *
 * 티켓 두 줄이 여기서 서로 당긴다: 스토리 17 은 조사 이름을 요구하고(여러 조사를 병행할 때
 * 어느 링크인지 알아야 한다) 「없는 토큰과 틀린 비밀번호가 같은 화면」은 그 이름을 지우라고
 * 한다. **이름을 보이는 쪽으로 결정했다**(2026-09-29). 근거는 둘이다 — 토큰이 16자 URL-safe
 * (약 95비트)라 주소 스캔으로 실재하는 토큰을 찾는 것 자체가 불가능하고, 공격자가 **반복해서
 * 두드릴 수 있는 유일한 표면**인 비밀번호 검증의 응답은 완전히 같다(`denied` 하나).
 * 남는 차이는 「이미 실재 토큰을 손에 쥔 사람만 얻는 확인」이라 새로 여는 것이 없다.
 * 뒤집으려면 이 함수가 아니라 스토리 17 을 먼저 접어야 한다.
 */
export type FieldworkLinkEntry =
  | { kind: 'authenticated' }
  | { kind: 'password'; surveyTitle: string | null }
  | { kind: 'closed'; surveyTitle: string };

export async function resolveFieldworkLinkEntry(
  token: string,
  headers: Headers,
): Promise<FieldworkLinkEntry> {
  const row = await loadLinkRow(token);
  if (!row) return { kind: 'password', surveyTitle: null };
  if (isClosed(row)) return { kind: 'closed', surveyTitle: row.surveyTitle };
  return evaluateSession(row, token, headers).ok
    ? { kind: 'authenticated' }
    : { kind: 'password', surveyTitle: row.surveyTitle };
}

// ─────────────────────────────────────────────────────────────────────────────
// 비밀번호 검증
// ─────────────────────────────────────────────────────────────────────────────

/** 접속 성공 시 심을 쿠키 — 심는 것은 procedure 가 한다(코어는 응답을 만지지 않는다). */
export interface FieldworkLinkSessionCookie {
  name: string;
  value: string;
  maxAgeSeconds: number;
}

export type FieldworkLinkAuthResult =
  | { ok: true; cookie: FieldworkLinkSessionCookie }
  | { ok: false; reason: 'denied' | 'closed' };

/**
 * 비밀번호 한 칸의 판정.
 *
 * **없는 토큰과 틀린 비밀번호가 같은 `denied` 다.** 사유를 갈라 돌려주면 그 응답이 곧 링크
 * 존재 확인 창구가 된다 — 이 표면은 무차별 대입 대상이므로 갈라서 얻을 편의보다 잃는 것이 크다.
 *
 * 닫힘은 갈라 준다. 비밀번호를 넣기 전에 이미 GET 이 닫힘 화면을 보여 주었을 것이므로 새로
 * 노출하는 것이 없고, 화면이 그 순간 닫힘으로 갈아탈 수 있어야 한다(연구원이 방금 중단한 경우).
 *
 * 앞뒤 공백은 버린다 — 발급 쪽 경계 스키마도 `.trim()` 이라 같은 규칙이어야 「맞는데 안 들어가는」
 * 비밀번호가 생기지 않는다.
 */
export async function authenticateFieldworkLink(
  token: string,
  password: string,
): Promise<FieldworkLinkAuthResult> {
  const row = await loadLinkRow(token);
  if (!row) return { ok: false, reason: 'denied' };
  if (isClosed(row)) return { ok: false, reason: 'closed' };
  if (!constantTimeEquals(decryptSharedSecret(row.passwordCipher), password.trim())) {
    return { ok: false, reason: 'denied' };
  }
  return {
    ok: true,
    cookie: {
      name: fieldworkLinkCookieName(token),
      value: signFieldworkLinkSession({
        linkId: row.linkId,
        surveyId: row.surveyId,
        passwordUpdatedAt: row.passwordUpdatedAt.toISOString(),
      }),
      maxAgeSeconds: FIELDWORK_LINK_SESSION_MAX_AGE_SECONDS,
    },
  };
}
