import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { surveyAccessLinks } from '@/db/schema';
import { decryptSharedSecret, encryptSharedSecret } from '@/lib/crypto/aes';
import { isUniqueViolation } from '@/lib/pg-error';
import {
  type AccessLinkKind,
  normalizeSurveyGuestTabs,
  type SurveyGuestTab,
  type SurveyGuestTabs,
} from '@/shared/contracts/workspace';
import type { AccessLinkView } from '@/shared/contracts/workspace-io';

import {
  AccessLinkAlreadyIssuedError,
  AccessLinkNotFoundError,
  generateAccessLinkPassword,
  generateAccessLinkToken,
} from '../domain/access-link';

/**
 * 외주 실사 링크의 저장소 계층 (ADR-0026).
 *
 * 이 파일이 지는 계약 셋.
 *  ① **활성 링크는 설문당 하나** — 부분 UNIQUE 가 강제하고, 부딪히면 CONFLICT 로 옮긴다.
 *  ② **토큰은 UPDATE 하지 않는다** — 주소가 영구 고정이라는 약속이 여기서 지켜진다.
 *     비밀번호 재설정도 `token` 을 set 하지 않는다.
 *  ③ **비밀번호는 가역 암호화** — 연구원이 다시 읽어 업체에 답해 준다(해시가 아니다).
 *
 * 중단 연동은 이 계층의 일이 아니다 — 판정 코어(server/survey-access)가 `surveys.is_paused` 로
 * 한다. 링크 행에 만료 축을 두지 않은 이유가 그것이고, 여기서 중단을 함께 보면 판정이 두 벌이 된다.
 */

/** 화면이 보는 컬럼 — 암호문은 여기 없다. 조회·발급·재설정·탭 저장이 같은 목록을 쓴다. */
const VIEW_COLUMNS = {
  id: surveyAccessLinks.id,
  kind: surveyAccessLinks.kind,
  token: surveyAccessLinks.token,
  clientTabs: surveyAccessLinks.clientTabs,
  passwordUpdatedAt: surveyAccessLinks.passwordUpdatedAt,
  createdAt: surveyAccessLinks.createdAt,
} as const;

/**
 * drizzle 행 → 화면이 보는 모양. 암호문은 절대 섞지 않는다.
 *
 * 탭은 여기서 정규화를 끝낸다 — 클라이언트 링크는 컬럼이 비어 있어도 기본값(응답 현황 하나)을
 * 받고, 외주 링크는 그 축이 없어 null 이다. 화면이 「비어 있으면 기본값」을 다시 계산하면
 * 서버의 판정(같은 정규화)과 갈릴 자리가 하나 더 생긴다.
 */
function toView(row: {
  id: string;
  kind: AccessLinkKind;
  token: string;
  clientTabs: SurveyGuestTabs | null;
  passwordUpdatedAt: Date;
  createdAt: Date;
}): AccessLinkView {
  return {
    id: row.id,
    kind: row.kind,
    token: row.token,
    clientTabs: row.kind === 'client' ? normalizeSurveyGuestTabs(row.clientTabs) : null,
    passwordUpdatedAt: row.passwordUpdatedAt,
    createdAt: row.createdAt,
  };
}

/**
 * 이 설문의 **그 종류** 활성 링크 조건 — 종료된 행은 감사 계보이므로 조회에서 빠진다.
 *
 * 종류를 함께 거는 것이 칸막이다. 한 설문에 외주 링크와 클라이언트 링크가 함께 서므로, 조건이
 * 빠지면 한쪽의 비밀번호 변경·종료가 다른 쪽 링크에 걸린다(참여 행에서 `kind='guest'` 를
 * WHERE 에 함께 거는 것과 같은 이유다). 필수 인자라 빠뜨린 호출이 컴파일되지 않는다.
 */
function activeLink(surveyId: string, kind: AccessLinkKind) {
  return and(
    eq(surveyAccessLinks.surveyId, surveyId),
    eq(surveyAccessLinks.kind, kind),
    isNull(surveyAccessLinks.closedAt),
  );
}

export async function getAccessLink(
  surveyId: string,
  kind: AccessLinkKind,
): Promise<AccessLinkView | null> {
  const [row] = await db
    .select(VIEW_COLUMNS)
    .from(surveyAccessLinks)
    .where(activeLink(surveyId, kind))
    .limit(1);
  return row ? toView(row) : null;
}

/**
 * 링크 발급 — 비밀번호를 생략하면 읽어 주기 쉬운 값을 만들어 **평문으로 함께 돌려준다.**
 *
 * 평문을 응답에 싣는 유일한 자리가 여기와 재설정이다. 자동 생성을 골랐을 때 연구원이 그 값을
 * 알 방법이 이것뿐이고, 이후 조회는 전용 표면(revealPassword)을 지난다.
 *
 * 중복은 DB 제약으로 받는다. 먼저 SELECT 해서 확인하면 두 요청이 같은 창에서 통과해 둘 다
 * INSERT 를 시도하고, 그때 나는 것은 제약 위반이 아니라 **두 번째 링크**다(제약이 없다면).
 */
export async function issueAccessLink(input: {
  surveyId: string;
  kind: AccessLinkKind;
  password?: string | undefined;
  actorId: string;
}): Promise<{ link: AccessLinkView; password: string }> {
  const password = input.password ?? generateAccessLinkPassword();
  try {
    const [row] = await db
      .insert(surveyAccessLinks)
      .values({
        surveyId: input.surveyId,
        kind: input.kind,
        token: generateAccessLinkToken(),
        passwordCipher: encryptSharedSecret(password),
        passwordUpdatedBy: input.actorId,
        createdBy: input.actorId,
      })
      .returning(VIEW_COLUMNS);
    if (!row) throw new Error('접속 링크 INSERT 실패');
    return { link: toView(row), password };
  } catch (error) {
    if (isUniqueViolation(error)) throw new AccessLinkAlreadyIssuedError();
    throw error;
  }
}

/**
 * 비밀번호 재설정 — **주소는 그대로 두고** 표식만 갱신한다.
 *
 * `passwordUpdatedAt` 을 함께 올리는 것이 세션 폐기다: 링크 세션 쿠키가 그 값을 들고 다니며
 * 매 요청 대조하므로, 이 UPDATE 하나로 이미 들어와 있던 외주 세션 전부가 끊긴다. ADR 의
 * 「사람을 막는 일은 전부 이 비밀번호가 진다」가 이 한 줄에 걸려 있다.
 */
export async function resetAccessLinkPassword(input: {
  surveyId: string;
  kind: AccessLinkKind;
  password?: string | undefined;
  actorId: string;
}): Promise<{ link: AccessLinkView; password: string }> {
  const password = input.password ?? generateAccessLinkPassword();
  const now = new Date();
  const [row] = await db
    .update(surveyAccessLinks)
    .set({
      passwordCipher: encryptSharedSecret(password),
      passwordUpdatedAt: now,
      passwordUpdatedBy: input.actorId,
      updatedAt: now,
    })
    .where(activeLink(input.surveyId, input.kind))
    .returning(VIEW_COLUMNS);
  if (!row) throw new AccessLinkNotFoundError();
  return { link: toView(row), password };
}

/**
 * 클라이언트 링크의 현황 탭 하나를 켜거나 끈다 (ADR-0029).
 *
 * **WHERE 가 클라이언트 종류로 못 박혀 있다.** 이 함수는 종류를 받지 않는다 — 외주 링크에는
 * 탭 축이 없고, 종류를 인자로 열면 호출부의 실수 하나가 외주 링크에 값을 쓰려다 0134 의 CHECK
 * 에 걸려 500 이 된다. 클라이언트 링크가 없으면 NotFound 다(외주 링크만 있는 설문 포함).
 *
 * ## 행을 잠그고 한 칸만 고친다
 *
 * 요청이 말하는 것은 칩 하나뿐이다(`SetClientLinkTabInput` 주석). 나머지 셋은 **잠근 행에서**
 * 읽는다 — 요청자의 화면이 얼마나 낡았든 그 사람이 모르는 칩은 지금 DB 에 있는 값 그대로
 * 남는다. 잠금(`FOR UPDATE`)이 없으면 읽고-고쳐-쓰기가 겹쳐 서로 다른 칩의 동시 저장 중
 * 하나가 사라진다. 잠금을 기다린 뒤 조건을 다시 보므로(READ COMMITTED), 그 사이 링크가
 * 종료됐으면 행이 잡히지 않아 NotFound 다.
 *
 * SQL 한 줄(`client_tabs || jsonb_build_object(...)`)로 쓰지 않은 이유는 둘이다. 컬럼이 비어
 * 있으면 기본값(응답 현황 하나)이라 빈 자리에 칩 하나만 얹으면 나머지 키가 없는 객체가 되고,
 * 정규화가 그것을 false 로 읽어 **응답 현황이 조용히 꺼진다** — 기본값을 SQL 에 한 벌 더
 * 적어야 한다. 그리고 jsonb 문서를 raw SQL 에 바인딩하면 드라이버가 이중 인코딩한다(주의사항
 * 13). 정규화 함수 하나를 거치는 쪽이 두 문제를 함께 없앤다.
 *
 * `updatedAt` 만 올리고 `passwordUpdatedAt` 은 건드리지 않는다 — 탭을 바꾼다고 선 세션이
 * 끊기면 안 된다. 바뀐 탭은 클라이언트의 다음 요청부터 반영된다(세션 판정이 매 요청 이 행을
 * 읽는다 — 쿠키에 탭을 싣지 않는 이유다).
 */
export async function setClientLinkTab(input: {
  surveyId: string;
  tab: SurveyGuestTab;
  enabled: boolean;
}): Promise<AccessLinkView> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: surveyAccessLinks.id, clientTabs: surveyAccessLinks.clientTabs })
      .from(surveyAccessLinks)
      .where(activeLink(input.surveyId, 'client'))
      .for('update');
    if (!current) throw new AccessLinkNotFoundError();

    const clientTabs: SurveyGuestTabs = {
      ...normalizeSurveyGuestTabs(current.clientTabs),
      [input.tab]: input.enabled,
    };
    const [row] = await tx
      .update(surveyAccessLinks)
      .set({ clientTabs, updatedAt: new Date() })
      .where(eq(surveyAccessLinks.id, current.id))
      .returning(VIEW_COLUMNS);
    if (!row) throw new AccessLinkNotFoundError();
    return toView(row);
  });
}

/**
 * 비밀번호 평문 조회 — 조회(get)와 **다른 표면**인 것이 이 함수의 존재 이유다.
 *
 * 목록 응답에 평문을 실으면 그 값이 캐시·로그·RSC payload 로 번지고, 「누가 언제 읽었는가」도
 * 남지 않는다. 따로 두면 rpc-logging 이 호출 한 줄을 기록한다.
 */
export async function revealAccessLinkPassword(
  surveyId: string,
  kind: AccessLinkKind,
): Promise<string> {
  const [row] = await db
    .select({ passwordCipher: surveyAccessLinks.passwordCipher })
    .from(surveyAccessLinks)
    .where(activeLink(surveyId, kind))
    .limit(1);
  if (!row) throw new AccessLinkNotFoundError();
  return decryptSharedSecret(row.passwordCipher);
}

/**
 * 링크 종료 — 행을 지우지 않고 `closedAt` 을 찍는다.
 *
 * 종료된 행이 「그 링크가 무엇을 넣었는가」의 계보이기 때문이다. 활성 UNIQUE 가 부분 인덱스라
 * 종료 뒤 재발급이 된다. 귀속 칸(결과코드 회차·대리 응답)이 붙으면 RESTRICT FK 가 하드 삭제를
 * DB 에서도 막지만 **그 칸은 아직 없다** — 지금 하드 삭제를 막는 것은 이 함수가 그것을 하지
 * 않는다는 사실뿐이다.
 */
export async function closeAccessLink(input: {
  surveyId: string;
  kind: AccessLinkKind;
  actorId: string;
}): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(surveyAccessLinks)
    .set({ closedAt: now, closedBy: input.actorId, updatedAt: now })
    .where(activeLink(input.surveyId, input.kind))
    .returning({ id: surveyAccessLinks.id });
  if (!row) throw new AccessLinkNotFoundError();
}
