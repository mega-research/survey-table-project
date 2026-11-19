import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import 'server-only';

import { contactTargets } from '@/db/schema';
import { getGuestSurveyIds, getGuestTargetShare } from '@/lib/auth/guest-grants';

/**
 * 담당 범위 해석 — 운영 버전(main)의 **게스트 계정판** (`.scratch/guest-target-share/PRD.md`, 2026-11-19).
 *
 * 열람자가 이 설문에서 **어느 조사 대상을 볼 수 있는가**를 셋 중 하나로 접는다.
 *
 * - `all` — 설문 전체. 관리자, 그리고 담당 범위 등재(`guest-grants` 의 `GUEST_TARGET_SHARES`)가 없는 게스트.
 * - `targets` — 명단의 `attrsKey` 열이 `value` 인 대상만. 그런 대상이 하나도 없으면 0명이다(넓어지지 않는다).
 * - `none` — 0명으로 닫는다. 게스트가 **자기 grant 밖 설문**을 물을 때다(관문이 먼저 막지만 해석이 혼자
 *   불려도 넓어지지 않게 fail closed).
 *
 * 「운영 데이터 스코프」(실데이터/테스트 파티션, `data-scope`) 옆에 서는 **두 번째 축**이다. 파티션을 대체하지 않고
 * (게스트는 늘 실데이터), 관문(`assertSurveyAccess` 계열·`requireSurveyConsolePage`)도 대체하지 않는다 — 소비자는
 * 관문을 지난 뒤 이 술어를 **추가로** 건다.
 *
 * 응답·회차·메일은 모두 「그 대상의 것」으로 걸러진다. 조사 대상에 묶이지 않은 응답은 `all` 일 때만 보인다.
 *
 * **모양은 staging 의 외주 링크 담당 범위(ADR-0035)와 같다** — 타입·함수 이름과 서비스 함수의 `share` 인자를
 * 그대로 맞춰 두었다. 다른 것은 주체(외주 링크 → 게스트 계정)와 범위의 재료(대상×링크 표 → 명단 열 값)뿐이라,
 * 승격 때 이 파일을 staging 것으로 바꾸면 소비자 줄은 그대로 남는다. 술어를 표면마다 새로 쓰지 말고 여기
 * 헬퍼를 쓸 것(사본이 생기면 한쪽만 고쳐진다).
 *
 * 어느 표면이 거르고 어느 것이 닫혀 있는지는 `tests/helpers/guest-share-surfaces.ts` 등재표가 쥔다.
 */
export type FieldworkShare =
  | { kind: 'all' }
  | { kind: 'targets'; surveyId: string; attrsKey: string; value: string }
  | { kind: 'none' };

export const FIELDWORK_SHARE_ALL: FieldworkShare = { kind: 'all' };

/**
 * 계정·설문 → 담당 범위. DB 를 치지 않는다 — 등재는 코드에 있고 대상은 소비자의 쿼리가 서브쿼리로 건다.
 * 그래서 관리자가 명단 값을 바꾸면 다음 요청에 반영된다.
 *
 * 주체를 받지 않는 호출(백그라운드 잡·관리자만 지나는 내부 RSC)은 `FIELDWORK_SHARE_ALL` 을 직접 쓴다.
 */
export function resolveGuestShare(userId: string, surveyId: string): FieldworkShare {
  const granted = getGuestSurveyIds(userId);
  // 관리자(grant 없음) — 설문 전체. 관리자인지는 관문이 이미 확인했다.
  if (granted.length === 0) return FIELDWORK_SHARE_ALL;
  if (!granted.includes(surveyId)) return { kind: 'none' };
  const share = getGuestTargetShare(userId, surveyId);
  if (!share) return FIELDWORK_SHARE_ALL;
  // 등재가 비어 있으면 넓히지 않고 닫는다
  if (!share.attrsKey || !share.value) return { kind: 'none' };
  return { kind: 'targets', surveyId, attrsKey: share.attrsKey, value: share.value };
}

/** 이 해석이 무언가를 거르는가 — `all` 이면 술어를 붙일 필요가 없다. */
export function isShareRestricted(share: FieldworkShare): boolean {
  return share.kind !== 'all';
}

/**
 * 범위 게스트가 만드는 대상에 찍을 명단 값 — `targets` 면 `{ 열: 값 }`, 아니면 null.
 * 대상 추가·수정 서비스가 범위 열을 지키는 데 쓴다(게스트가 자기 범위 밖 대상을 만들거나 옮기지 못하게).
 */
export function shareAttrStamp(share: FieldworkShare): { attrsKey: string; value: string } | null {
  return share.kind === 'targets' ? { attrsKey: share.attrsKey, value: share.value } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 범위 열 가리기 — 범위를 가르는 명단 열 자체는 범위 게스트에게 보이지 않는다 (2026-11-20 요청)
// ─────────────────────────────────────────────────────────────────────────────
//
// 「어느 업체에 맡겼는가」는 관리자만 안다. 범위 게스트의 화면에는 그 열이 목록 열·필터 후보·값 목록·상세·
// 수정 기록 어디에도 실리지 않는다(값도 RSC props 로 나가지 않는다). 컨택원 열을 게스트에게 감추는 것과 같은 결이다.
// 운영판(게스트 계정 + 명단 열 값)에만 있는 조각이다 — staging 의 외주 링크 담당 범위는 범위가 명단 열이 아니라
// 따로 둔 표라 감출 열이 없다. 승격 때 이 절과 이 헬퍼를 부르는 줄을 함께 걷는다.

/** 범위 게스트에게 감출 명단 열 이름(`attrs` 의 키) — 범위가 걸리지 않았으면 null. */
export function shareHiddenAttrsKey(share: FieldworkShare): string | null {
  return share.kind === 'targets' ? share.attrsKey : null;
}

/** 범위 열을 뺀 컬럼 스킴 — 없으면 그대로. 원본을 고치지 않는다(스킴은 요청 안에서 캐시된다). */
export function withoutShareColumn<T extends { columns: ReadonlyArray<{ source: string }> }>(
  scheme: T | null,
  share: FieldworkShare,
): T | null {
  const key = shareHiddenAttrsKey(share);
  if (!scheme || key === null) return scheme;
  const source = `attrs.${key}`;
  if (!scheme.columns.some((c) => c.source === source)) return scheme;
  return { ...scheme, columns: scheme.columns.filter((c) => c.source !== source) };
}

/** 범위 열 값을 뺀 명단 값 — 화면으로 내보내기 직전에 부른다. 원본을 고치지 않는다. */
export function withoutShareAttr<T extends Record<string, string> | null | undefined>(
  attrs: T,
  share: FieldworkShare,
): T {
  const key = shareHiddenAttrsKey(share);
  if (!attrs || key === null || !(key in attrs)) return attrs;
  const { [key]: _hidden, ...rest } = attrs;
  return rest as T;
}

/**
 * 조사 대상 id 칸에 거는 술어 — `all` 이면 `undefined`(drizzle `and()` 가 건너뛴다).
 *
 * `column` 은 조사 대상 id 를 담은 칸이다: 대상 표면 `contact_targets.id`(기본), 응답 표면은
 * `survey_responses.contact_target_id` 처럼. 응답 칸이 NULL(조사 대상에 묶이지 않은 공개 링크 응답)이면
 * `IN` 이 참이 아니므로 **범위 게스트에게서 자연히 빠진다** — `all` 일 때만 보인다.
 * 결과는 NULL 이 섞이지 않는 불리언이다(`NOT` 으로 뒤집어도 3값 논리로 새지 않게).
 */
export function shareTargetCondition(
  share: FieldworkShare,
  column: PgColumn | SQL = contactTargets.id,
): SQL | undefined {
  if (share.kind === 'all') return undefined;
  if (share.kind === 'none') return sql`FALSE`;
  return targetInShare(share, column);
}

/**
 * 위 술어를 **언제나 SQL 로** — `all` 이면 `TRUE`. 날 SQL 문장 안(`AND ${…}`)이나 `sql<boolean>` 칸처럼
 * `undefined` 를 받을 수 없는 자리에 쓴다(호출부마다 `TRUE` 폴백을 적지 않게).
 */
export function shareTargetSql(
  share: FieldworkShare,
  column: PgColumn | SQL = contactTargets.id,
): SQL {
  return shareTargetCondition(share, column) ?? sql`TRUE`;
}

// 서브쿼리의 표는 별칭을 박아 쓴다 — drizzle 관계 쿼리(`db.query.<표>.findFirst`)는 where 의 sql 조각에 든
// 다른 표의 칸까지 바깥 표 별칭으로 고쳐 써서 칸 객체를 넣으면 깨진다. 칸 이름은 schema 객체에서 읽어 개명이
// 따라오게 한다. 상수가 아니라 함수인 것은 모듈 평가 시점에 스키마 객체를 읽지 않기 위해서다 — `@/db/schema` 를
// 통째로 목으로 세운 테스트에서 import 만으로 깨지지 않게.
const gst = () => ({
  id: sql.identifier(contactTargets.id.name),
  surveyId: sql.identifier(contactTargets.surveyId.name),
  isTest: sql.identifier(contactTargets.isTest.name),
  attrs: sql.identifier(contactTargets.attrs.name),
});

/**
 * 이 대상(`column`)이 범위에 있는가 — NULL 없는 불리언.
 * 범위는 실데이터 대상만이다(게스트는 테스트 파티션을 보지 않는다). 값 비교는 글자 그대로다(공백·대소문자 구분).
 */
function targetInShare(
  share: Extract<FieldworkShare, { kind: 'targets' }>,
  column: PgColumn | SQL,
): SQL {
  const c = gst();
  return sql`COALESCE(${column} IN (
    SELECT gst.${c.id} FROM ${contactTargets} gst
    WHERE gst.${c.surveyId} = ${share.surveyId}
      AND gst.${c.isTest} = FALSE
      AND gst.${c.attrs} ->> ${share.attrsKey} = ${share.value}
  ), FALSE)`;
}
