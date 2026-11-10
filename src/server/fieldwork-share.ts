import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import 'server-only';

import { contactTargets, fieldworkLinkShares } from '@/db/schema';

import { type Actor, isLinkActor } from './survey-access';

/**
 * 담당 범위 해석 (CONTEXT.md 「담당 범위」, ADR-0035, fieldwork-multi-company 티켓 03).
 *
 * 요청 주체가 이 설문에서 **어느 조사 대상을 볼 수 있는가**를 셋 중 하나로 접는다.
 *
 * - `all` — 설문 전체. 계정 주체, 클라이언트 링크(담당 범위가 없는 종류), 그리고 **한 번도 나누지 않은**
 *   외주 링크(업체 하나인 설문은 아무것도 하지 않아도 지금과 같다).
 * - `targets` — 그 링크의 담당 범위 표에 든 대상만. 나눈 적 있는 링크는 표가 비어도(다른 링크가 다
 *   가져가도, 명단 교체 업로드로 풀려도) 0명이다 — 빼앗긴 쪽이 전체로 넓어지면 안 된다.
 * - `none` — 0명으로 닫는다. 링크 주체가 **자기 설문이 아닌 설문**을 물을 때다(관문이 먼저 막지만
 *   해석이 혼자 불려도 넓어지지 않게 fail closed).
 *
 * 「운영 데이터 스코프」(실데이터/테스트 파티션) 옆에 서는 **두 번째 축**이다. 파티션을 대체하지 않는다 —
 * 외부 주체는 늘 실데이터이고, 담당 범위 표도 실데이터 대상만 담는다. 관문(capability)도 대체하지 않는다:
 * 소비자는 관문을 지난 뒤 이 술어를 **추가로** 건다.
 *
 * 매 요청 DB 에서 읽는다 — 「나눈 적 있음」은 세션 판정이 링크 행에서 읽어 주체에 싣고(`shareDivided`),
 * 대상은 소비자의 쿼리가 서브쿼리로 건다. 쿠키에 싣지 않으므로 범위를 바꾸면 다음 요청에 반영된다.
 *
 * **소비자는 외주 링크가 지나는 모든 표면이다.** 어느 표면이 거르고 어느 것이 해당 없는지(사유)는
 * `tests/helpers/fieldwork-share-surfaces.ts` 등재표가 쥐고, 외주 링크 음성 스위트가 라우터·`/fw` 트리와
 * 합을 맞춘다 — 새 표면이 링크에 열리면 등재하기 전까지 빨개진다. 술어를 표면마다 새로 쓰지 말고
 * 여기 헬퍼를 쓸 것(사본이 생기면 한쪽만 고쳐진다).
 */
export type FieldworkShare =
  | { kind: 'all' }
  | { kind: 'targets'; linkId: string }
  | { kind: 'none' };

export const FIELDWORK_SHARE_ALL: FieldworkShare = { kind: 'all' };

/**
 * 주체·설문 → 담당 범위. DB 를 치지 않는다 — 「나눈 적 있음」은 주체에 이미 실려 있다.
 *
 * 주체를 받지 않는 호출(백그라운드 잡·계정만 지나는 내부 RSC)은 `FIELDWORK_SHARE_ALL` 을 직접 쓴다.
 */
export function resolveFieldworkShare(actor: Actor, surveyId: string): FieldworkShare {
  if (!isLinkActor(actor)) return FIELDWORK_SHARE_ALL;
  if (actor.surveyId !== surveyId) return { kind: 'none' };
  // 클라이언트 링크에는 담당 범위 축이 없다 — 조사 대상(마스킹본) 탭은 설문 전체를 본다(ADR-0029).
  if (actor.linkKind === 'client') return FIELDWORK_SHARE_ALL;
  return actor.shareDivided ? { kind: 'targets', linkId: actor.linkId } : FIELDWORK_SHARE_ALL;
}

/** 이 해석이 무언가를 거르는가 — `all` 이면 술어를 붙일 필요가 없다. */
export function isShareRestricted(share: FieldworkShare): boolean {
  return share.kind !== 'all';
}

/**
 * 조사 대상 id 칸에 거는 술어 — `all` 이면 `undefined`(drizzle `and()` 가 건너뛴다).
 *
 * `column` 은 조사 대상 id 를 담은 칸이다: 대상 표면 `contact_targets.id`(기본), 응답 표면은
 * `survey_responses.contact_target_id` 처럼. 응답 칸이 NULL(조사 대상에 묶이지 않은 공개 링크 응답)이면
 * `IN` 이 참이 아니므로 **나눈 링크에서 자연히 빠진다** — `all` 일 때만 보인다(CONTEXT 「담당 범위」).
 * 결과는 NULL 이 섞이지 않는 불리언이다(`NOT` 으로 뒤집어도 3값 논리로 새지 않게).
 */
export function shareTargetCondition(
  share: FieldworkShare,
  column: PgColumn | SQL = contactTargets.id,
): SQL | undefined {
  if (share.kind === 'all') return undefined;
  if (share.kind === 'none') return sql`FALSE`;
  // 서브쿼리의 표는 별칭을 박아 쓴다 — drizzle 관계 쿼리(`db.query.<표>.findFirst`)는 where 의 sql 조각에
  // 든 **다른 표의 칸까지** 바깥 표 별칭으로 고쳐 써서(`"surveyResponses"."link_id"`) 칸 객체를 넣으면
  // 깨진다(티켓 06 에서 응답 단건 조회가 밟았다). 표·칸 이름은 schema 객체에서 읽어 개명이 따라오게 한다.
  return sql`COALESCE(${column} IN (
    SELECT fls.${sql.identifier(fieldworkLinkShares.contactTargetId.name)}
    FROM ${fieldworkLinkShares} fls
    WHERE fls.${sql.identifier(fieldworkLinkShares.linkId.name)} = ${share.linkId}
  ), FALSE)`;
}
