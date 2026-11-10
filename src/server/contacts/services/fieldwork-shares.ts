import { ORPCError } from '@orpc/server';
import { type SQL, and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { fieldworkLinkShares, surveyAccessLinks } from '@/db/schema';
import { logger } from '@/lib/logger';
import { EXTERNAL_VIEWER_DATA_SCOPE } from '@/server/data-scope';
import {
  FIELDWORK_SHARE_ALL,
  linkShareCount,
  otherOpenLinkIds,
  targetInLinkShare,
  targetInOtherOpenLinkShare,
} from '@/server/fieldwork-share-scope';
import {
  lockShareTargets,
  lockShareWriteScope,
  releaseLinkShares,
  retryShareWrite,
} from '@/server/fieldwork-share-write';
import {
  type ResolvedContactFilter,
  loadContactFilterContext,
  resolveContactFilter,
  resolvedContactFilterSql,
} from '@/server/read-models/contact-filter-resolution';
import { listContactsForSurvey } from '@/server/read-models/contacts';
import { loadFieldworkLinkNames } from '@/server/read-models/fieldwork-link-names';
import type { ContactAssignmentClause } from '@/shared/contracts/contacts';
import type {
  FieldworkShareApplyResult,
  FieldworkShareChangeSummary,
  FieldworkShareListResult,
  FieldworkShareMatchesResult,
} from '@/shared/contracts/contacts-io';

import type {
  FieldworkShareApplyInput,
  FieldworkShareClausesInput,
  FieldworkShareMatchesInput,
  FieldworkShareTargetInput,
} from '../domain/fieldwork-share';

/**
 * 외주 담당 범위 나누기 (CONTEXT.md 「담당 범위」, ADR-0035, fieldwork-multi-company 티켓 03).
 *
 * 연구원이 외주 링크 하나를 골라 조건을 적용하면 **그 링크의 담당 범위 = 조건 결과**가 된다(결과 상태
 * 지정 — 같은 요청 두 번이 같은 결과다). 조건 밖이던 기존 대상은 그 링크에서만 빠진다.
 *
 * - **컨택원과 다른 층이다.** 이 파일은 `contact_targets.assignment_id` 를 읽지도 쓰지도 않고, 컨택원
 *   교체 적용도 이 표를 건드리지 않는다. 그래서 조건 편집기의 열 후보에서 「현재 컨택원」을 뺀다
 *   (`isExternal: true` 로 컨텍스트를 읽는 이유) — 범위를 컨택원으로 고르게 두면 일 나누기가 업체
 *   접근을 정하는 입구가 된다.
 * - **실데이터만.** 외부 주체는 늘 실데이터를 보므로 범위도 실데이터 대상에만 선다. 연구원 브라우저가
 *   「테스트 데이터 보기」를 켜 두어도 이 화면은 실데이터다(`EXTERNAL_VIEWER_DATA_SCOPE`).
 * - **겹침**은 조건 결과 중 이 링크에 아직 없고 다른 **열린** 외주 링크에 있는 대상이다(종료된 링크는
 *   몫이 없다, 이미 같이 맡은 대상은 겹침이 아니다). 적용 입력의 필수 값 `overlap` 이 처리를 정한다 —
 *   가져오기(그 링크에서 뺀다)·남겨 두기(이쪽에 넣지 않는다)·같이 맡기기(양쪽에 둔다). 의미론의 정본은
 *   `features/operations/contacts/shares/share-overlap` 의 `shareTargetOutcome` 이고 적용 SQL 은 그 표를 옮긴 것이다
 *   (티켓 04). 같이 맡은 대상에는 외주 쪽 표식이 없다 — 외주 표면은 「이 링크에 있는가」만 본다.
 * - 조건은 조사 대상 필터 해석의 **쓰기 모드**로 읽는다 — 해석 안 되는 절은 거부한다(버리면 조건이
 *   넓어져 연락처가 엉뚱한 업체로 간다).
 *
 * 무결성 중 DB 가 못 거는 교차 테이블 조건(외주 링크만 · 같은 설문 · 실데이터 대상만)은 이 파일이
 * 잠근 행에서 다시 본다 — 범위 표에 **행을 넣는** 자리는 여기 적용 하나뿐이다. 행을 **지우는** 자리는 이 파일의
 * 적용(조건 밖·가져오기)과, 링크 하나를 통째로 푸는 `releaseLinkShares`(코어 `server/fieldwork-share-write` —
 * 「담당 범위 없애기」와 링크 종료가 함께 부른다) 둘이다. 잠금 순서·세기·재시도도 그 코어 한 벌이다.
 */

const SHARE_SCOPE = EXTERNAL_VIEWER_DATA_SCOPE;

/** 이 설문의 열린 외주 링크 하나 — 종류·설문·열림 셋이 다 맞아야 한다(존재 은닉 — 전부 NOT_FOUND). */
function openFieldworkLink(surveyId: string, linkId: string): SQL {
  return and(
    eq(surveyAccessLinks.id, linkId),
    eq(surveyAccessLinks.surveyId, surveyId),
    eq(surveyAccessLinks.kind, 'fieldwork'),
    isNull(surveyAccessLinks.closedAt),
  )!;
}

function linkNotFound(): ORPCError<'NOT_FOUND', unknown> {
  return new ORPCError('NOT_FOUND', {
    message:
      '외주 링크를 찾을 수 없습니다. 이미 종료된 링크일 수 있으니 목록을 다시 확인해 주세요.',
  });
}

/** 잠그지 않는 조회(미리보기·대상 목록)의 입구 — 열린 외주 링크가 아니면 NOT_FOUND. */
async function assertOpenFieldworkLink(surveyId: string, linkId: string): Promise<void> {
  const rows = await db
    .select({ id: surveyAccessLinks.id })
    .from(surveyAccessLinks)
    .where(openFieldworkLink(surveyId, linkId))
    .limit(1);
  if (rows.length === 0) throw linkNotFound();
}

/** 쓰기의 입구 — 잠금 순서 앞 둘(설문 → 링크)을 잡고, 없으면 NOT_FOUND. */
async function lockOpenFieldworkLink(tx: DbOrTx, surveyId: string, linkId: string): Promise<void> {
  const locked = await lockShareWriteScope(tx, surveyId, openFieldworkLink(surveyId, linkId));
  if (locked === 'survey_not_found') {
    throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });
  }
  if (locked === 'link_not_found') throw linkNotFound();
}

/** 조건 줄 → 쓰기 해석. 컨택원 축은 싣지 않는다(위 머리 주석). */
async function resolveShareFilter(
  surveyId: string,
  clauses: ContactAssignmentClause[],
  executor: DbOrTx = db,
): Promise<ResolvedContactFilter<'write'>> {
  const ctx = await loadContactFilterContext(surveyId, SHARE_SCOPE, {
    isExternal: true,
    surface: 'contacts',
    // 연구원 화면이라 담당 범위 축이 없다 — 나누는 대상은 설문 전체다.
    share: FIELDWORK_SHARE_ALL,
    executor,
  });
  return resolveContactFilter(ctx, { clauses }, { mode: 'write', executor });
}

/** 조건을 이 화면의 조건 편집기에 그릴 재료 — 페이지가 같은 컨텍스트로 열 후보를 그린다. */
export function loadFieldworkShareFilterContext(surveyId: string) {
  return loadContactFilterContext(surveyId, SHARE_SCOPE, {
    isExternal: true,
    surface: 'contacts',
    share: FIELDWORK_SHARE_ALL,
  });
}

/** NULL 없는 불리언 — 조건 밖을 셀 때·뺄 때 3값 논리로 빠지는 행이 없게. */
function matchOf(filter: ResolvedContactFilter<'write'>): SQL {
  return sql`COALESCE((${resolvedContactFilterSql(filter)}), FALSE)`;
}

const targetsInScope = (surveyId: string): SQL =>
  sql`"contact_targets".survey_id = ${surveyId} AND "contact_targets".is_test = FALSE`;

/** 날 SQL 문장의 대상 칸 — 아래 문장은 전부 `contact_targets` 를 별칭 없이 읽는다. */
const TARGET_ID = sql`"contact_targets".id`;
const inLink = (linkId: string): SQL => targetInLinkShare(linkId, TARGET_ID);
const inOtherOpenLink = (surveyId: string, linkId: string): SQL =>
  targetInOtherOpenLinkShare(surveyId, linkId, TARGET_ID);

async function summarize(
  executor: DbOrTx,
  surveyId: string,
  linkId: string,
  match: SQL,
): Promise<FieldworkShareChangeSummary> {
  const [totals, others, names] = await Promise.all([
    executor.execute(sql`
      SELECT
        count(*) FILTER (WHERE ${match})::int AS matched,
        count(*) FILTER (WHERE ${inLink(linkId)})::int AS current,
        count(*) FILTER (
          WHERE ${match} AND NOT ${inLink(linkId)} AND NOT ${inOtherOpenLink(surveyId, linkId)}
        )::int AS incoming,
        count(*) FILTER (
          WHERE ${match} AND NOT ${inLink(linkId)} AND ${inOtherOpenLink(surveyId, linkId)}
        )::int AS overlap,
        count(*) FILTER (WHERE NOT ${match} AND ${inLink(linkId)})::int AS leaving
      FROM contact_targets
      WHERE ${targetsInScope(surveyId)}
    `),
    executor.execute(sql`
      SELECT s.link_id, count(*)::int AS n
      FROM contact_targets
      JOIN ${fieldworkLinkShares} s ON s.contact_target_id = ${TARGET_ID}
      WHERE ${targetsInScope(surveyId)} AND ${match} AND NOT ${inLink(linkId)}
        AND s.link_id IN ${otherOpenLinkIds(surveyId, linkId)}
      GROUP BY s.link_id
    `),
    loadFieldworkLinkNames(surveyId, executor),
  ]);
  const t = (totals as unknown as Array<Record<string, unknown>>)[0] ?? {};
  // 링크별 인원은 발급 순 — 이름 맵이 같은 정렬(`created_at`, `id`)로 서 있다.
  const order = [...names.keys()];
  const otherRows = (others as unknown as Array<Record<string, unknown>>)
    .map((r) => ({ linkId: String(r['link_id']), count: Number(r['n']) }))
    .sort((a, b) => order.indexOf(a.linkId) - order.indexOf(b.linkId));
  return {
    matched: Number(t['matched'] ?? 0),
    current: Number(t['current'] ?? 0),
    incoming: Number(t['incoming'] ?? 0),
    overlap: Number(t['overlap'] ?? 0),
    leaving: Number(t['leaving'] ?? 0),
    fromOthers: otherRows.map((r) => ({ ...r, name: names.get(r.linkId) ?? '' })),
  };
}

/** 링크별 범위 요약 — 「외주 담당 범위」 탭의 목록. 열린 외주 링크만, 발급 순. */
export async function listFieldworkShares(surveyId: string): Promise<FieldworkShareListResult> {
  const [rows, names] = await Promise.all([
    db
      .select({
        linkId: surveyAccessLinks.id,
        appliedAt: surveyAccessLinks.shareAppliedAt,
        count: linkShareCount(),
      })
      .from(surveyAccessLinks)
      .where(
        and(
          eq(surveyAccessLinks.surveyId, surveyId),
          eq(surveyAccessLinks.kind, 'fieldwork'),
          isNull(surveyAccessLinks.closedAt),
        ),
      )
      .orderBy(asc(surveyAccessLinks.createdAt), asc(surveyAccessLinks.id)),
    loadFieldworkLinkNames(surveyId),
  ]);
  return {
    links: rows.map((r) => ({
      linkId: r.linkId,
      name: names.get(r.linkId) ?? '',
      divided: r.appliedAt !== null,
      count: Number(r.count),
      appliedAt: r.appliedAt,
    })),
  };
}

/** 수정 화면의 재료 — 이름·나눈 적 있음·지금 인원·마지막 조건. 이 설문의 열린 외주 링크가 아니면 null. */
export async function getFieldworkShareForEdit(
  surveyId: string,
  linkId: string,
): Promise<{
  linkId: string;
  name: string;
  divided: boolean;
  count: number;
  lastClauses: ContactAssignmentClause[] | null;
} | null> {
  const [row] = await db
    .select({
      appliedAt: surveyAccessLinks.shareAppliedAt,
      clauses: surveyAccessLinks.shareClauses,
      count: linkShareCount(),
    })
    .from(surveyAccessLinks)
    .where(openFieldworkLink(surveyId, linkId))
    .limit(1);
  if (!row) return null;
  const names = await loadFieldworkLinkNames(surveyId);
  return {
    linkId,
    name: names.get(linkId) ?? '',
    divided: row.appliedAt !== null,
    count: Number(row.count),
    lastClauses: row.clauses ?? null,
  };
}

/** 미리보기 — 조건에 맞는 인원과 적용하면 바뀌는 인원. 아무것도 쓰지 않는다. */
export async function previewFieldworkShare(
  input: FieldworkShareClausesInput,
): Promise<FieldworkShareChangeSummary> {
  await assertOpenFieldworkLink(input.surveyId, input.linkId);
  const filter = await resolveShareFilter(input.surveyId, input.clauses);
  return summarize(db, input.surveyId, input.linkId, matchOf(filter));
}

/**
 * 적용 — 한 트랜잭션. 잠금 순서는 **설문 스코프(FOR SHARE) → 링크(FOR UPDATE) → 대상(id 오름차순 FOR NO
 * KEY UPDATE)** 다(PRD 「동시성」). 조건은 잠금 뒤에 다시 계산한다 — 미리보기 이후 명단이 바뀌어도 적용
 * 시점이 정본이고, 실제 결과 집계를 돌려준다. 교착·직렬화 실패는 처음부터 다시(조건도 새로).
 * 결과가 0명이어도 적용한다 — 나눈 링크는 0명을 본다.
 *
 * 대상 잠금이 `FOR NO KEY UPDATE` 인 이유(티켓 04, `fieldwork-share-overlap.realdb` 가 둘 다 실측한다):
 * - 스스로와 부딪히는 가장 약한 행 잠금이다 — 같은 대상을 두 링크에 동시에 적용하면 뒤의 적용이 앞의
 *   커밋을 기다렸다가 그 결과(대상이 이미 앞 링크에 있음 = 겹침)를 보고 고른 대로 처리한다. `FOR SHARE`
 *   는 서로 부딪히지 않아 둘이 동시에 「어느 링크에도 없음」을 보고 양쪽에 넣는다.
 * - `FOR UPDATE` 와 달리 키 공유 잠금(FK 검사)과 부딪히지 않는다 — 적용 중에도 그 대상을 가리키는 응답
 *   행(초대 링크로 들어온 응답자)·회차 행 삽입이 줄 서지 않는다. 대상 행 자체를 고치는 쓰기(메모·결과
 *   코드·응답 확정의 상태 갱신)는 여전히 이 적용이 끝날 때까지 기다린다.
 */
export async function applyFieldworkShare(
  input: FieldworkShareApplyInput,
): Promise<FieldworkShareApplyResult> {
  const write = { rpc: 'contacts.fieldworkShares.apply', ...input };
  const result = await retryShareWrite(write, () =>
    db.transaction(async (tx) => {
      await lockOpenFieldworkLink(tx, input.surveyId, input.linkId);

      const filter = await resolveShareFilter(input.surveyId, input.clauses, tx);
      const match = matchOf(filter);
      const scope = targetsInScope(input.surveyId);
      const linkId = input.linkId;
      const others = inOtherOpenLink(input.surveyId, linkId);

      // 이번에 범위가 움직일 수 있는 대상 — 조건 결과와 지금 이 링크의 범위. id 순으로 잠가 두 적용이
      // 같은 대상을 다른 순서로 잡지 않게 한다.
      await lockShareTargets(tx, sql`${scope} AND (${match} OR ${inLink(linkId)})`);

      const summary = await summarize(tx, input.surveyId, linkId, match);

      // 아래 셋은 `shareTargetOutcome` 표를 옮긴 것이다. 겹침 = 조건 결과 ∧ 이 링크에 없음 ∧ 다른 열린
      // 링크에 있음 — ①이 조건 결과를 지우지 않으므로 ②·③의 「이 링크에 없음」은 적용 전 상태다.
      // ① 조건 밖 — 이 링크에서만 뺀다(처리와 무관).
      await tx.execute(sql`
        DELETE FROM ${fieldworkLinkShares} s
        USING contact_targets
        WHERE s.link_id = ${linkId}
          AND s.contact_target_id = ${TARGET_ID}
          AND NOT ${match}
      `);
      // ② 가져오기 — 겹치는 대상을 다른 열린 링크에서 뺀다. 이미 같이 맡은 대상(이 링크에도 있음)은 둔다.
      if (input.overlap === 'take') {
        await tx.execute(sql`
          DELETE FROM ${fieldworkLinkShares} s
          USING contact_targets
          WHERE s.contact_target_id = ${TARGET_ID}
            AND s.link_id IN ${otherOpenLinkIds(input.surveyId, linkId)}
            AND ${scope}
            AND ${match}
            AND NOT ${inLink(linkId)}
        `);
      }
      // ③ 조건 결과를 이 링크로 — 남겨 두기면 겹치는 대상은 넣지 않는다. 이미 있는 줄은 그대로.
      await tx.execute(sql`
        INSERT INTO ${fieldworkLinkShares} (link_id, contact_target_id)
        SELECT ${linkId}::uuid, ${TARGET_ID} FROM contact_targets
        WHERE ${scope} AND ${match}
          ${input.overlap === 'keep' ? sql`AND (${inLink(linkId)} OR NOT ${others})` : sql``}
        ON CONFLICT DO NOTHING
      `);
      const now = new Date();
      await tx
        .update(surveyAccessLinks)
        .set({ shareAppliedAt: now, shareClauses: input.clauses, updatedAt: now })
        .where(eq(surveyAccessLinks.id, linkId));
      const [after] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(fieldworkLinkShares)
        .where(eq(fieldworkLinkShares.linkId, linkId));
      return { ...summary, overlapChoice: input.overlap, after: Number(after?.n ?? 0) };
    }),
  );
  // 적용 인원·겹침 처리 — rpc 1줄 로그는 출력을 싣지 않아 여기서 한 줄 더. 대상 id·조건 값은 싣지 않는다.
  logger.info(
    {
      rpc: 'contacts.fieldworkShares.apply',
      surveyId: input.surveyId,
      targetLinkId: input.linkId,
      overlapChoice: result.overlapChoice,
      matched: result.matched,
      overlap: result.overlap,
      after: result.after,
      leaving: result.leaving,
    },
    '[fieldwork-share] 담당 범위 적용',
  );
  return result;
}

/**
 * 담당 범위 없애기 — 범위 행을 지우고 「나눈 적 있음」을 되돌린다. 그 링크는 다시 **설문 전체**를 본다.
 * 0명 범위와 달리 넓어지는 동작이라 명시적 버튼으로만 온다.
 */
export async function clearFieldworkShare(
  input: FieldworkShareTargetInput,
): Promise<{ released: number }> {
  return retryShareWrite({ rpc: 'contacts.fieldworkShares.clear', ...input }, () =>
    db.transaction(async (tx) => {
      await lockOpenFieldworkLink(tx, input.surveyId, input.linkId);
      const released = await releaseLinkShares(tx, input.linkId);
      const now = new Date();
      await tx
        .update(surveyAccessLinks)
        .set({ shareAppliedAt: null, shareClauses: null, updatedAt: now })
        .where(eq(surveyAccessLinks.id, input.linkId));
      return { released };
    }),
  );
}

export const FIELDWORK_SHARE_MATCHES_PAGE_SIZE = 10;

/**
 * 조건에 맞는 대상 목록(시스템ID 순, 10명씩) — 수정 화면 오른쪽. 조사 대상 목록과 같은 read model 을
 * 써서 같은 조건이면 같은 사람이 나오고 개인정보 열은 마스킹 힌트만 싣는다. 각 줄에 그 대상이 지금
 * 속한 **열린** 외주 링크 이름을 붙인다(내부 화면 — 이름표가 실려도 된다).
 */
export async function listFieldworkShareMatches(
  input: FieldworkShareMatchesInput,
): Promise<FieldworkShareMatchesResult> {
  await assertOpenFieldworkLink(input.surveyId, input.linkId);
  const filter = await resolveShareFilter(input.surveyId, input.clauses);
  const { rows, total, page } = await listContactsForSurvey({
    surveyId: input.surveyId,
    scope: SHARE_SCOPE,
    filter,
    page: input.page,
    pageSize: FIELDWORK_SHARE_MATCHES_PAGE_SIZE,
    sort: 'resid',
    dir: 'asc',
    includeAssignment: false,
  });
  const ids = rows.map((r) => r.id);
  const [shareRows, names] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({
            targetId: fieldworkLinkShares.contactTargetId,
            linkId: fieldworkLinkShares.linkId,
          })
          .from(fieldworkLinkShares)
          .innerJoin(surveyAccessLinks, eq(surveyAccessLinks.id, fieldworkLinkShares.linkId))
          .where(
            and(
              inArray(fieldworkLinkShares.contactTargetId, ids),
              eq(surveyAccessLinks.surveyId, input.surveyId),
              isNull(surveyAccessLinks.closedAt),
            ),
          )
          .orderBy(asc(surveyAccessLinks.createdAt)),
    loadFieldworkLinkNames(input.surveyId),
  ]);
  const linksByTarget = new Map<string, string[]>();
  for (const s of shareRows) {
    const list = linksByTarget.get(s.targetId) ?? [];
    list.push(names.get(s.linkId) ?? '');
    linksByTarget.set(s.targetId, list);
  }
  return {
    rows: rows.map((r) => ({
      id: r.id,
      resid: r.resid,
      attrs: r.attrs,
      piiMaskHints: r.piiMaskHints,
      links: linksByTarget.get(r.id) ?? [],
    })),
    total,
    page,
    pageSize: FIELDWORK_SHARE_MATCHES_PAGE_SIZE,
  };
}
