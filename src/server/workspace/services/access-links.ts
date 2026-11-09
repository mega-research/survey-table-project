import 'server-only';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveyAccessLinks } from '@/db/schema';
import { decryptSharedSecret, encryptSharedSecret } from '@/lib/crypto/aes';
import { logger } from '@/lib/logger';
import { resolveClientResponseColumnKeys } from '@/lib/operations/client-response-columns-format';
import { isUniqueViolation } from '@/lib/pg-error';
import {
  type ClientResponseColumnMaterial,
  loadClientResponseColumnMaterial,
} from '@/server/read-models/client-response-columns';
import {
  type AccessLinkKind,
  type ClientLinkTab,
  type ClientLinkTabs,
  type ClientResponseColumns,
  CLIENT_RESPONSE_FIRST_COLUMN_KEY,
  normalizeClientLinkTabs,
  normalizeClientResponseColumns,
} from '@/shared/contracts/workspace';
import type {
  AccessLinkListItem,
  AccessLinkView,
  ClientResponseColumnsOutput,
} from '@/shared/contracts/workspace-io';

import {
  AccessLinkAlreadyIssuedError,
  AccessLinkNotFoundError,
  ClientResponseColumnNotAllowedError,
  ClientResponseColumnsConflictError,
  generateAccessLinkPassword,
  generateAccessLinkToken,
} from '../domain/access-link';

/**
 * 외주 실사 링크의 저장소 계층 (ADR-0026).
 *
 * 이 파일이 지는 계약 넷.
 *  ① **활성 클라이언트 링크는 설문당 하나** — 부분 UNIQUE 가 강제하고, 부딪히면 CONFLICT 로 옮긴다.
 *     외주 링크는 업체 수만큼 선다(0159, ADR-0035) — 발급이 부딪히지 않는다.
 *  ② **토큰은 UPDATE 하지 않는다** — 주소가 영구 고정이라는 약속이 여기서 지켜진다.
 *     비밀번호 재설정도 `token` 을 set 하지 않는다.
 *  ③ **비밀번호는 가역 암호화** — 연구원이 다시 읽어 업체에 답해 준다(해시가 아니다).
 *  ④ **이미 있는 링크는 id 로 집는다** — 비밀번호 열람·변경·종료(`activeLinkById`). 「설문 +
 *     종류」로 찾는 것은 아직 링크를 모르는 조회·발급과, 종류가 축인 클라이언트 탭·열 설정뿐이다.
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
  label: surveyAccessLinks.label,
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
  clientTabs: ClientLinkTabs | null;
  label: string | null;
  passwordUpdatedAt: Date;
  createdAt: Date;
}): AccessLinkView {
  return {
    id: row.id,
    kind: row.kind,
    token: row.token,
    clientTabs: row.kind === 'client' ? normalizeClientLinkTabs(row.clientTabs) : null,
    label: row.label,
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

/**
 * 지목한 링크 하나 — **이 설문의 열린** 그 id (fieldwork-multi-company 티켓 01).
 *
 * 이미 있는 링크를 움직이는 표면(비밀번호 열람·변경·종료)은 종류가 아니라 이 조건으로 집는다.
 * 외주 링크가 설문당 여럿이 되면 「설문 + 종류」는 하나를 가리키지 못한다.
 *
 * 세 조건이 하나도 빠지면 안 된다.
 *  - `surveyId` — 관문은 경로의 설문만 본다. 빠지면 내 설문 관문을 지난 뒤 남의 설문 링크 id 로
 *    그 비밀번호를 읽고 바꾸고 닫는다(「내 설문 + 남의 하위 행」, 링크 id 는 전역 PK 다).
 *  - `closedAt IS NULL` — 종료된 행은 계보다. 빠지면 닫힌 링크의 비밀번호를 바꿔 그 행의
 *    `password_updated_at` 이 움직이고, 다시 「종료」하면 `closed_at` 이 덮인다.
 *  - 종류는 걸지 않는다 — id 가 이미 종류를 정한다.
 * 셋 중 무엇에 걸렸는지 가르지 않는다 — 전부 NotFound 다(존재 은닉).
 */
function activeLinkById(surveyId: string, linkId: string) {
  return and(
    eq(surveyAccessLinks.id, linkId),
    eq(surveyAccessLinks.surveyId, surveyId),
    isNull(surveyAccessLinks.closedAt),
  );
}

/**
 * 이 설문의 그 종류 **열린** 링크 목록 — 발급 순(`created_at`, `id`) (fieldwork-multi-company 티켓 02).
 *
 * 클라이언트 링크는 0~1개, 외주 링크는 업체 수만큼이다. 각 줄에 **발급 순번**을 싣는다 — 이름표 없는
 * 링크도 「링크 2」로 구별되게 하려는 것이고(`fieldworkLinkName`), 순번은 **종료된 링크까지 센다**:
 * 하나를 종료해도 남은 링크의 이름이 바뀌지 않아야 지난 기록의 「외주 · 링크 2」가 같은 링크를
 * 가리킨다. 그래서 종료된 행까지 읽어 센 뒤 열린 것만 돌려준다(설문당 링크 수는 업체 수 정도다).
 * 내부 기록의 이름(`read-models/fieldwork-link-names`)도 같은 정렬로 센다.
 */
export async function listAccessLinks(
  surveyId: string,
  kind: AccessLinkKind,
): Promise<AccessLinkListItem[]> {
  const rows = await db
    .select({
      ...VIEW_COLUMNS,
      closedAt: surveyAccessLinks.closedAt,
      shareAppliedAt: surveyAccessLinks.shareAppliedAt,
      // 담당 범위 인원 — 담당 범위 표는 contacts 의 쓰기지만 읽기는 「타 도메인 테이블 직접 쿼리」로 둔다.
      shareCount: sql<number>`(
        SELECT count(*)::int FROM fieldwork_link_shares s WHERE s.link_id = ${surveyAccessLinks.id}
      )`,
    })
    .from(surveyAccessLinks)
    .where(and(eq(surveyAccessLinks.surveyId, surveyId), eq(surveyAccessLinks.kind, kind)))
    .orderBy(asc(surveyAccessLinks.createdAt), asc(surveyAccessLinks.id));
  return rows.flatMap(({ closedAt, shareAppliedAt, shareCount, ...row }, index) =>
    closedAt === null
      ? [
          {
            ...toView(row),
            ordinal: index + 1,
            // 카드의 범위 요약(「설문 전체」 / 「나눔 · N명」) — 외주 링크만 이 축이 있다(티켓 03).
            share:
              row.kind === 'fieldwork'
                ? { divided: shareAppliedAt !== null, count: Number(shareCount) }
                : null,
          },
        ]
      : [],
  );
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
  /** 외주 링크의 이름표 — 클라이언트 링크에는 경계 스키마가 받지 않는다(0159 CHECK 도 막는다). */
  label?: string | null | undefined;
  actorId: string;
}): Promise<{ link: AccessLinkView; password: string }> {
  const password = input.password ?? generateAccessLinkPassword();
  try {
    const [row] = await db
      .insert(surveyAccessLinks)
      .values({
        surveyId: input.surveyId,
        kind: input.kind,
        label: input.label ?? null,
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
  linkId: string;
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
    .where(activeLinkById(input.surveyId, input.linkId))
    .returning(VIEW_COLUMNS);
  if (!row) throw new AccessLinkNotFoundError();
  return { link: toView(row), password };
}

/**
 * 외주 링크의 이름표를 저장한다 — null 이면 지운다 (fieldwork-multi-company 티켓 02).
 *
 * **외주 종류로 못 박는다.** 이름표는 외주 링크의 축이라 클라이언트 링크 id 는 없는 링크와 같은
 * NotFound 다(그대로 쓰면 0159 의 CHECK 에 걸려 500). 지목은 다른 관리 표면과 같은 `activeLinkById`
 * — 남의 설문 링크·종료된 링크는 NotFound 다.
 *
 * `passwordUpdatedAt` 은 건드리지 않는다 — 이름표를 고친다고 선 세션이 끊기면 안 된다. 업체가
 * 바뀌어 이름표를 고칠 때 세션을 끊는 일은 비밀번호 변경이 따로 진다.
 */
export async function setAccessLinkLabel(input: {
  surveyId: string;
  linkId: string;
  label: string | null;
}): Promise<AccessLinkView> {
  const [row] = await db
    .update(surveyAccessLinks)
    .set({ label: input.label, updatedAt: new Date() })
    .where(
      and(activeLinkById(input.surveyId, input.linkId), eq(surveyAccessLinks.kind, 'fieldwork')),
    )
    .returning(VIEW_COLUMNS);
  if (!row) throw new AccessLinkNotFoundError();
  return toView(row);
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
  tab: ClientLinkTab;
  enabled: boolean;
}): Promise<AccessLinkView> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: surveyAccessLinks.id, clientTabs: surveyAccessLinks.clientTabs })
      .from(surveyAccessLinks)
      .where(activeLink(input.surveyId, 'client'))
      .for('update');
    if (!current) throw new AccessLinkNotFoundError();

    const clientTabs: ClientLinkTabs = {
      ...normalizeClientLinkTabs(current.clientTabs),
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
 * 저장값 → 고르는 화면의 모양. 저장된 키를 지금 구조로 다시 거른다 — 저장 뒤 문항이 지워지거나
 * 암호화로 바뀌었으면 그 열은 화면에서도 빠진다. 후보에 없는 키(조사 대상 없는 설문의 시스템ID)도
 * 뺀다: 화면이 고를 수 없는 체크를 들고 있으면 저장 때마다 남는다.
 */
function toColumnsView(
  saved: ClientResponseColumns,
  material: ClientResponseColumnMaterial,
): ClientResponseColumnsOutput {
  const candidateKeys = new Set(material.candidates.map((c) => c.key));
  const { keys } = resolveClientResponseColumnKeys(saved.keys, material.sources);
  return {
    candidates: material.candidates,
    keys: keys.filter((key) => candidateKeys.has(key)),
    version: saved.version,
  };
}

/**
 * 클라이언트 링크 응답 내역의 열 설정 — 후보 + 지금 저장값 + version (티켓 04).
 * 탭과 같이 클라이언트 링크가 없으면 NotFound 다(외주 링크만 있는 설문 포함).
 */
export async function getClientResponseColumns(
  surveyId: string,
): Promise<ClientResponseColumnsOutput> {
  const [[row], material] = await Promise.all([
    db
      .select({ columns: surveyAccessLinks.clientResponseColumns })
      .from(surveyAccessLinks)
      .where(activeLink(surveyId, 'client'))
      .limit(1),
    loadClientResponseColumnMaterial(surveyId),
  ]);
  if (!row) throw new AccessLinkNotFoundError();
  return toColumnsView(normalizeClientResponseColumns(row.columns), material);
}

/**
 * 열 설정 저장 — 잠근 행의 version 과 대조하고, 허용 밖 열이 하나라도 있으면 거부한다.
 *
 * ## 순서
 *
 * 1. 허용 재료(설문 구조·명단 스킴)를 **잠그기 전에** 읽는다 — 링크 행을 잡은 채 여러 테이블을
 *    도는 시간을 줄인다. 재료가 그 사이 바뀌어도 읽기가 같은 판정으로 다시 거르므로 새지 않는다.
 * 2. 활성 클라이언트 링크 행을 `FOR UPDATE` 로 잡고 version 을 **잠근 행에서** 다시 읽는다.
 *    두 연구원이 같은 version 으로 저장하면 뒤에 온 쪽은 잠금을 기다린 뒤 올라간 version 을 보고
 *    CONFLICT 다. 기다리는 사이 링크가 종료됐으면 행이 안 잡혀 NotFound(탭 저장과 같다).
 * 3. 키 판정 — 허용 밖이 하나라도 있으면 **저장하지 않고 거부**한다. 순번은 언제나 맨 앞에 둔다.
 *
 * `passwordUpdatedAt` 은 건드리지 않는다 — 열을 바꾼다고 선 세션이 끊기면 안 된다. 바뀐 열은
 * 클라이언트의 다음 화면 이동부터 보인다(목록이 매 요청 이 행을 읽는다).
 */
export async function setClientResponseColumns(input: {
  surveyId: string;
  keys: readonly string[];
  expectedVersion: number;
}): Promise<ClientResponseColumnsOutput> {
  const material = await loadClientResponseColumnMaterial(input.surveyId);
  const requested = input.keys.filter((key) => key !== CLIENT_RESPONSE_FIRST_COLUMN_KEY);
  const { keys, dropped } = resolveClientResponseColumnKeys(requested, material.sources);
  const candidateKeys = new Set(material.candidates.map((c) => c.key));
  const outside = [...dropped, ...keys.filter((key) => !candidateKeys.has(key))];

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: surveyAccessLinks.id, columns: surveyAccessLinks.clientResponseColumns })
      .from(surveyAccessLinks)
      .where(activeLink(input.surveyId, 'client'))
      .for('update');
    if (!current) throw new AccessLinkNotFoundError();

    const saved = normalizeClientResponseColumns(current.columns);
    // 충돌을 먼저 본다 — 낡은 화면이 보낸 키는 판정할 가치가 없다(새로 불러와 다시 고른다).
    if (saved.version !== input.expectedVersion) throw new ClientResponseColumnsConflictError();
    if (outside.length > 0) {
      logger.warn(
        { surveyId: input.surveyId, keys: outside },
        'client response columns rejected — not allowed for client',
      );
      throw new ClientResponseColumnNotAllowedError(outside);
    }

    const next: ClientResponseColumns = { version: saved.version + 1, keys };
    const [row] = await tx
      .update(surveyAccessLinks)
      .set({ clientResponseColumns: next, updatedAt: new Date() })
      .where(eq(surveyAccessLinks.id, current.id))
      .returning({ id: surveyAccessLinks.id });
    if (!row) throw new AccessLinkNotFoundError();
    return toColumnsView(next, material);
  });
}

/**
 * 비밀번호 평문 조회 — 조회(get)와 **다른 표면**인 것이 이 함수의 존재 이유다.
 *
 * 목록 응답에 평문을 실으면 그 값이 캐시·로그·RSC payload 로 번지고, 「누가 언제 읽었는가」도
 * 남지 않는다. 따로 두면 rpc-logging 이 호출 한 줄을 기록한다.
 */
export async function revealAccessLinkPassword(input: {
  surveyId: string;
  linkId: string;
}): Promise<string> {
  const [row] = await db
    .select({ passwordCipher: surveyAccessLinks.passwordCipher })
    .from(surveyAccessLinks)
    .where(activeLinkById(input.surveyId, input.linkId))
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
  linkId: string;
  actorId: string;
}): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(surveyAccessLinks)
    .set({ closedAt: now, closedBy: input.actorId, updatedAt: now })
    .where(activeLinkById(input.surveyId, input.linkId))
    .returning({ id: surveyAccessLinks.id });
  if (!row) throw new AccessLinkNotFoundError();
}
