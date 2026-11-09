import {
  type Column,
  type SQL,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  sql,
} from 'drizzle-orm';
import type { PgSelect } from 'drizzle-orm/pg-core';
import 'server-only';

import { db } from '@/db';
import {
  personalSurveyTagLinks,
  personalSurveyTags,
  surveyFavorites,
  surveyGroups,
  surveyParticipants,
  surveyResponses,
  surveys,
  teams,
  users,
} from '@/db/schema';
import { escapeLikePattern } from '@/lib/operations/filter-shared';
import { surveyListLifecycleSql } from '@/server/read-models/survey-list-lifecycle';
import {
  scopedSurveyWhere,
  surveyListColumns,
  visibleGroupId,
} from '@/server/read-models/survey-structure';
import { notDeletedResponse, notTestResponse } from '@/server/response-filters';
import type { SurveyScopeFilter } from '@/server/work-scope';
import {
  SURVEY_LIST_PAGE_SIZE,
  SURVEY_SUGGEST_LIMIT,
  type SurveyListAdvancedFilters,
  type SurveyListLifecycleFilter,
  type SurveyListOwner,
  type SurveyListPageQuery,
  type SurveyListSortBy,
  type SurveyListWhose,
  type SurveySuggestion,
  splitSurveyListSearchWords,
} from '@/shared/contracts/survey-builder-io';

// ─────────────────────────────────────────────────────────────────────────────
// 설문 목록 페이지 — 서버 페이지네이션 (설문 즐겨찾기·태그 티켓 03)
//
// 조건은 세 겹이다.
//   ① 원천(source)   — 작업 범위(`scopedSurveyWhere`) 또는 휴지통(`deleted_at IS NOT NULL`)
//   ② 좁힘(narrowing) — 그룹 화면·팀 좁힘·미분류·「내 설문」. 여기까지가 세그먼트 숫자·소유자 목록의 기준
//   ③ 거르기(filters) — 검색·목록 상태·상세 검색·즐겨찾기·검색 칩(태그). `total` 과 페이지 항목은 셋 모두를 적용한다
//
// 즐겨찾기(티켓 06)·내 태그(티켓 07)는 요청자 본인의 행만 본다(`viewerId`) — 동료의 별·태그는
// 조건에도 숫자에도 카드 표시에도 들어오지 않는다. 표는 workspace 도메인 소유지만 타 도메인 테이블
// 직접 쿼리로 읽는다.
//
// 응답 수는 여기서 세지 않는다 — 페이지 항목의 응답 수는 서비스가 그 id 만으로 센다. 예외는
// 응답순 정렬과 상세 검색 「응답 수 범위」로, 범위 전체의 응답 수가 있어야 해서 그때만 상관
// 서브쿼리(`responseCountSql`)를 붙인다.
// ─────────────────────────────────────────────────────────────────────────────

type ScopedFilter = Exclude<SurveyScopeFilter, { kind: 'none' }>;

/**
 * 목록의 원천 — 작업 범위가 보는 설문, 또는 휴지통(슈퍼어드민 시스템 범위 전용, 판정은 호출자).
 *
 * 요청자는 원천이 쥔다 — 범위 목록은 범위 필터의 `viewerId`, 휴지통은 `viewerId`. 개인 표시(별·태그)와
 * 참여 칸을 읽는 기준은 `viewerOf` 하나다(따로 받으면 두 값이 갈릴 수 있다).
 */
export type SurveyListSource =
  { kind: 'scoped'; filter: ScopedFilter } | { kind: 'deleted'; viewerId: string };

/** `whose` 는 서비스가 정한 값이다(주소에 없으면 저장된 선택·역할 기본값) — 여기서는 null 이 없다. */
export type SurveyListPageParams = Omit<SurveyListPageQuery, 'deleted' | 'whose'> & {
  source: SurveyListSource;
  whose: SurveyListWhose;
};

export interface SurveyListPageRows {
  rows: Awaited<ReturnType<typeof selectPage>>;
  total: number;
  page: number;
  totalPages: number;
  lifecycleCounts: Record<SurveyListLifecycleFilter, number>;
  favoriteCount: number;
  owners: SurveyListOwner[];
  activeTeam: { id: string; name: string | null } | null;
  /** 「내 설문」일 때 같은 조건의 팀 전체 결과 수 — 팀 전체 보기에서는 null. */
  teamWideTotal: number | null;
}

/** 원천의 요청자. */
function viewerOf(source: SurveyListSource): string {
  return source.kind === 'scoped' ? source.filter.viewerId : source.viewerId;
}

/** 원천 조건. */
function sourceWhere(source: SurveyListSource): SQL {
  return source.kind === 'deleted'
    ? isNotNull(surveys.deletedAt)
    : scopedSurveyWhere(source.filter);
}

/**
 * 원천별 그룹 열 — 범위 목록은 팀이 다른 그룹을 미분류로 접고(`visibleGroupId`), 휴지통은 늘
 * null 이다(삭제된 설문의 폴더는 갈 곳 없는 링크다). 그룹 좁힘도 이 열로 한다 — 카드에 보이는
 * 그룹과 그룹 화면이 고르는 그룹이 같아야 한다.
 */
function groupColumn(source: SurveyListSource): SQL<string | null> {
  return source.kind === 'deleted' ? sql<string | null>`null::uuid` : visibleGroupId();
}

/** 카드에 보이는 이름 — `surveyCardTitle` 의 SQL 판(카드 제목이 없으면 설문지 제목). 제목순 정렬이 본다. */
const cardTitleSql = sql<string>`coalesce(${surveys.cardTitle}, ${surveys.title})`;

/**
 * 범위 전체 기준 응답 수 — 응답순 정렬·응답 수 범위에서만 붙인다. 페이지 항목의 응답 수
 * (`getResponseCountsGroupedBySurvey`)와 같은 파티션이다: 휴지통 응답·테스트 응답 제외.
 */
const responseCountSql = sql<number>`(select count(*) from ${surveyResponses} where ${surveyResponses.surveyId} = ${surveys.id} and ${notDeletedResponse} and ${notTestResponse})`;

/**
 * 요청자 태그의 연결 — `from 연결 join 태그 where 태그.user_id = 요청자`. 검색(태그 이름)·카드 태그 id·
 * 검색 칩 세 서브쿼리가 이 조각에서 출발한다 — 하나라도 user_id 조건을 빠뜨리면 동료의 태그가 샌다.
 * 뒤에 `and …` 로 조건을 잇는다.
 */
function fromMyTagLinks(viewerId: string): SQL {
  return sql`from ${personalSurveyTagLinks} join ${personalSurveyTags} on ${personalSurveyTags.id} = ${personalSurveyTagLinks.tagId} where ${personalSurveyTags.userId} = ${viewerId}`;
}

/**
 * 한 단어가 맞는가 — 카드 제목 · 설문지 제목 · 설명 · 소유자 이름 · **요청자의** 태그 이름 중 하나라도
 * 부분일치(대소문자 무시). 소유자 이름은 `users` 조인(`withListJoins`)이 걸린 문장에서만 쓸 수 있다.
 *
 * 태그 이름은 요청자 본인의 태그만 본다(티켓 09) — 동료가 붙인 태그 이름으로는 내 검색이 맞지 않는다.
 * 설문별 연결(`personal_survey_tag_links_survey_idx`)에서 출발해 태그 PK 로 이름을 본다.
 * `tagViewerId` 가 null 이면(휴지통) 태그 이름 조각을 뺀다 — 휴지통 카드에는 태그가 없어서, 태그
 * 이름으로 맞으면 왜 맞았는지 보이지 않는 결과가 된다.
 */
function surveyListWordMatchSql(word: string, tagViewerId: string | null): SQL {
  const pattern = `%${escapeLikePattern(word)}%`;
  const fields = sql`${surveys.cardTitle} ilike ${pattern} or ${surveys.title} ilike ${pattern} or ${surveys.description} ilike ${pattern} or ${users.name} ilike ${pattern}`;
  if (tagViewerId === null) return sql`(${fields})`;
  const myTagName = sql`exists (select 1 ${fromMyTagLinks(tagViewerId)} and ${personalSurveyTagLinks.surveyId} = ${surveys.id} and ${personalSurveyTags.name} ilike ${pattern})`;
  return sql`(${fields} or ${myTagName})`;
}

/**
 * 검색 조각 — 검색어를 공백으로 나눈 단어마다 `surveyListWordMatchSql`, 단어끼리 AND. 빈 검색어면
 * 조건 없음. 목록 페이지와 자동완성(티켓 05)이 같은 조각을 쓰도록 여기 하나만 둔다. `tagViewerId` 는
 * 내 태그 이름을 볼 요청자다(휴지통은 null).
 *
 * 단어 수·글자 수 상한은 입력 스키마가 막는다(`SurveyListPageQuerySchema`) — 여기서는 받은 대로 쓴다.
 */
function surveyListSearchSql(q: string, tagViewerId: string | null): SQL | undefined {
  const words = splitSurveyListSearchWords(q);
  if (words.length === 0) return undefined;
  return and(...words.map((word) => surveyListWordMatchSql(word, tagViewerId)));
}

/**
 * 「내 설문」 — 요청자가 소유하거나 참여자로 초대된 설문. 참여는 survey_participants(survey_id, user_id)
 * 유일 행 한 번 찾기다. 원천(작업 범위) 안에서만 거른다 — 범위 밖 설문을 여기로 끌어오지 않는다.
 */
function isMineSql(viewerId: string): SQL {
  return sql`(${surveys.ownerUserId} = ${viewerId} or exists (select 1 from ${surveyParticipants} where ${surveyParticipants.surveyId} = ${surveys.id} and ${surveyParticipants.userId} = ${viewerId}))`;
}

/** 요청자가 이 설문에 별을 켰는가 — PK(user_id, survey_id) 한 번 찾기. */
function isFavoriteSql(viewerId: string): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${surveyFavorites} where ${surveyFavorites.userId} = ${viewerId} and ${surveyFavorites.surveyId} = ${surveys.id})`;
}

/**
 * 요청자가 이 설문에 붙인 태그 id — 붙인 순서(연결 생성순, 같으면 태그 id). 동료의 태그는
 * 들어오지 않는다(태그의 user_id 로 건다). 카드가 이름·색을 내 태그 목록(`mine`)에서 찾아 그린다.
 */
function myTagIdsSql(viewerId: string): SQL<string[]> {
  return sql<
    string[]
  >`coalesce((select json_agg(${personalSurveyTagLinks.tagId} order by ${personalSurveyTagLinks.createdAt}, ${personalSurveyTagLinks.tagId}) ${fromMyTagLinks(viewerId)} and ${personalSurveyTagLinks.surveyId} = ${surveys.id}), '[]'::json)`;
}

/**
 * 검색 칩(티켓 09) — 지정한 내 태그가 **모두** 붙은 설문. 연결 표 PK(tag_id, survey_id)로 고른 줄을
 * 설문별로 세어 칩 수와 같은 것만 남긴다. 태그의 user_id 를 함께 걸어 남의 태그 연결은 세지 않는다
 * (소유 확인은 서비스가 먼저 해서 거부하지만, 조건 자체도 요청자 것만 본다). id 는 중복 없이 온다(입력 스키마).
 */
function allTagsAttachedSql(viewerId: string, tagIds: readonly string[]): SQL {
  return sql`${surveys.id} in (select ${personalSurveyTagLinks.surveyId} ${fromMyTagLinks(viewerId)} and ${inArray(personalSurveyTagLinks.tagId, [...tagIds])} group by ${personalSurveyTagLinks.surveyId} having count(*) = ${tagIds.length})`;
}

/** 요청자 소유인 태그 id — 서비스가 검색 칩의 소유를 확인할 때 쓴다(남의 것·없는 것은 빠진다). */
export async function selectOwnedTagIds(
  viewerId: string,
  tagIds: readonly string[],
): Promise<Set<string>> {
  if (tagIds.length === 0) return new Set();
  const rows = await db
    .select({ id: personalSurveyTags.id })
    .from(personalSurveyTags)
    .where(
      and(eq(personalSurveyTags.userId, viewerId), inArray(personalSurveyTags.id, [...tagIds])),
    );
  return new Set(rows.map((r) => r.id));
}

const DATE_COLUMNS = {
  updatedAt: surveys.updatedAt,
  createdAt: surveys.createdAt,
  endDate: surveys.endDate,
} as const;

/**
 * 상세 검색 조건. 날짜는 **한국 시간 하루**로 읽는다 — 시작일 00:00 부터 종료일 24:00 전까지.
 * 기준 칸이 비어 있는 설문(마감일 없음)은 기간을 걸면 빠진다.
 */
function advancedConditions(advanced: SurveyListAdvancedFilters): SQL[] {
  const out: SQL[] = [];
  const column = DATE_COLUMNS[advanced.dateField];
  if (advanced.dateFrom) {
    out.push(sql`${column} >= (${advanced.dateFrom}::date::timestamp at time zone 'Asia/Seoul')`);
  }
  if (advanced.dateTo) {
    out.push(
      sql`${column} < ((${advanced.dateTo}::date + 1)::timestamp at time zone 'Asia/Seoul')`,
    );
  }
  if (advanced.ownerUserId) out.push(eq(surveys.ownerUserId, advanced.ownerUserId));
  if (advanced.visibility) out.push(eq(surveys.visibility, advanced.visibility));
  if (advanced.responsesMin !== null) out.push(gte(responseCountSql, advanced.responsesMin));
  if (advanced.responsesMax !== null) out.push(lte(responseCountSql, advanced.responsesMax));
  return out;
}

/**
 * 정렬 — 값마다 방향 고정. 같은 값끼리는 생성 최신 → id 로 끊어 페이지 경계가 흔들리지 않게 한다.
 * 제목순은 한국어 ICU 정렬(`ko-x-icu`)이라 옛 화면의 `localeCompare(…, 'ko')` 와 같은 순서다.
 */
function orderBy(sort: SurveyListSortBy): SQL[] {
  const tail = [desc(surveys.createdAt), asc(surveys.id)];
  switch (sort) {
    case 'updatedAt':
      return [desc(surveys.updatedAt), ...tail];
    case 'createdAt':
      return tail;
    case 'title':
      return [sql`${cardTitleSql} collate "ko-x-icu" asc`, ...tail];
    case 'responses':
      return [sql`${responseCountSql} desc`, ...tail];
  }
}

/**
 * 즐겨찾기 고정 — 요청자가 별을 켠 설문을 맨 위에 모으고, 그 안은 고른 정렬과 무관하게 늘
 * 최신 수정순(같으면 생성 최신 → id)이다. 나머지는 고른 정렬 그대로다.
 *
 * 걸지 않는 곳이 둘이다 — 휴지통(별을 보이지 않는다)과 「즐겨찾기만」(전부 별이라 고정할 것이
 * 없고, 그 화면에서는 고른 정렬이 즐겨찾기 사이의 순서를 정해야 한다). 별 판정은 PK 한 번
 * 찾기라 정렬 키에 몇 번 들어가도 싸다.
 */
function pinnedFavoritesOrder(params: SurveyListPageParams): SQL[] {
  if (params.source.kind === 'deleted' || params.favorites) return [];
  const starred = isFavoriteSql(params.source.filter.viewerId);
  const ifStarred = (column: Column) => sql`case when ${starred} then ${column} end`;
  return [
    sql`${starred} desc`,
    sql`${ifStarred(surveys.updatedAt)} desc nulls last`,
    sql`${ifStarred(surveys.createdAt)} desc nulls last`,
    sql`${ifStarred(surveys.id)} asc nulls last`,
  ];
}

/** 목록 행이 쓰는 조인 — 팀 이름·소유자 이름·그룹 접기. 숫자·소유자 조회도 같은 조인을 탄다. */
function withListJoins<T extends PgSelect>(qb: T) {
  return qb
    .leftJoin(teams, eq(teams.id, surveys.teamId))
    .leftJoin(users, eq(users.id, surveys.ownerUserId))
    .leftJoin(surveyGroups, eq(surveyGroups.id, surveys.surveyGroupId));
}

function selectPage(params: SurveyListPageParams, where: SQL, page: number) {
  const { source } = params;
  const viewerId = viewerOf(source);
  // 휴지통 카드는 참여 칸을 읽지 않는다 — 복구 말고 할 수 있는 일이 없다(`surveyListColumns`).
  const leaderTeamIds =
    source.kind === 'scoped' && source.filter.kind === 'team' ? source.filter.leaderTeamIds : [];
  return withListJoins(
    db
      .select({
        ...surveyListColumns(source.kind === 'scoped' ? viewerId : null, leaderTeamIds),
        surveyGroupId: groupColumn(source),
        isFavorite: isFavoriteSql(viewerId),
        myTagIds: myTagIdsSql(viewerId),
      })
      .from(surveys)
      .$dynamic(),
  )
    .where(where)
    .orderBy(...pinnedFavoritesOrder(params), ...orderBy(params.sort))
    .limit(SURVEY_LIST_PAGE_SIZE)
    .offset((page - 1) * SURVEY_LIST_PAGE_SIZE);
}

/**
 * 팀 좁힘을 실제로 걸 팀 — 지목한 팀의 설문이 원천에 하나도 없으면 좁히지 않는다(참여가 끝난
 * 팀 주소를 새로고침해도 빈 화면에 갇히지 않게, 옛 화면 `narrowToTeam` 의 폴백).
 */
async function resolveActiveTeam(
  source: SurveyListSource,
  teamId: string | null,
): Promise<{ id: string; name: string | null } | null> {
  if (!teamId) return null;
  const [row] = await db
    .select({ name: teams.name })
    .from(surveys)
    .leftJoin(teams, eq(teams.id, surveys.teamId))
    .where(and(sourceWhere(source), eq(surveys.teamId, teamId)))
    .limit(1);
  return row ? { id: teamId, name: row.name } : null;
}

/** 원천 + 그룹·팀·미분류 좁힘 — 세그먼트 숫자·소유자 목록의 기준. */
function narrowedWhere(params: SurveyListPageParams, activeTeam: { id: string } | null): SQL {
  const conditions: SQL[] = [sourceWhere(params.source)];
  if (params.groupId) conditions.push(sql`${groupColumn(params.source)} = ${params.groupId}`);
  if (activeTeam) {
    conditions.push(eq(surveys.teamId, activeTeam.id));
    if (params.ungrouped) conditions.push(sql`${groupColumn(params.source)} is null`);
  }
  return and(...conditions)!;
}

async function countLifecycles(where: SQL): Promise<Record<SurveyListLifecycleFilter, number>> {
  const lifecycle = surveyListLifecycleSql();
  const [row] = await withListJoins(
    db
      .select({
        all: count(),
        draft: sql<number>`count(*) filter (where ${lifecycle} = 'draft')`.mapWith(Number),
        running: sql<number>`count(*) filter (where ${lifecycle} = 'running')`.mapWith(Number),
        closed: sql<number>`count(*) filter (where ${lifecycle} = 'closed')`.mapWith(Number),
      })
      .from(surveys)
      .$dynamic(),
  ).where(where);
  return {
    all: row?.all ?? 0,
    draft: row?.draft ?? 0,
    running: row?.running ?? 0,
    closed: row?.closed ?? 0,
  };
}

/** 범위 안 소유자 — 소유자 없는 옛 설문은 후보가 될 수 없어 뺀다. 이름순(한국어). */
async function listOwners(where: SQL): Promise<SurveyListOwner[]> {
  const rows = await withListJoins(
    db.select({ id: surveys.ownerUserId, name: users.name }).from(surveys).$dynamic(),
  )
    .where(and(where, isNotNull(surveys.ownerUserId)))
    .groupBy(surveys.ownerUserId, users.name);
  return rows
    .map((r) => ({ id: r.id!, name: r.name ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 원천이 휴지통이면 별을 세지 않는다 — 휴지통에는 즐겨찾기 단추가 없다. */
async function countFavorites(params: SurveyListPageParams, narrowed: SQL): Promise<number> {
  if (params.source.kind === 'deleted') return 0;
  return countMatches(and(narrowed, isFavoriteSql(viewerOf(params.source)))!);
}

async function countMatches(where: SQL): Promise<number> {
  const [row] = await withListJoins(db.select({ value: count() }).from(surveys).$dynamic()).where(
    where,
  );
  return row?.value ?? 0;
}

/**
 * 목록 한 페이지 — 항목 + 전체 결과 수 + 세그먼트 숫자 + 소유자 목록.
 *
 * 항목은 요청한 페이지를 먼저 낙관적으로 함께 읽는다. 요청 페이지가 범위를 넘었을 때만 마지막
 * 페이지를 한 번 더 읽는다(평소에는 왕복 한 번).
 *
 * 문장들은 한 트랜잭션이 아니다 — 그 사이 쓰기로 숫자와 항목이 한 칸 어긋날 수 있으나 표시용이라
 * 받아들인다(다음 조회가 맞춘다).
 */
export async function querySurveyListPage(
  params: SurveyListPageParams,
): Promise<SurveyListPageRows> {
  const activeTeam = await resolveActiveTeam(params.source, params.teamId);
  const viewerId = viewerOf(params.source);
  // 「내 설문」은 좁힘 단계다 — 세그먼트 숫자·별 숫자·소유자 목록도 내 설문만 센다. 휴지통에는 없다.
  const mine = params.whose === 'mine' && params.source.kind === 'scoped';
  const teamWide = narrowedWhere(params, activeTeam);
  const narrowed = mine ? and(teamWide, isMineSql(viewerId))! : teamWide;

  const filters: SQL[] = [];
  const search = surveyListSearchSql(params.q, params.source.kind === 'deleted' ? null : viewerId);
  if (search) filters.push(search);
  if (params.lifecycle !== 'all') {
    filters.push(sql`${surveyListLifecycleSql()} = ${params.lifecycle}`);
  }
  filters.push(...advancedConditions(params.advanced));
  if (params.favorites) filters.push(isFavoriteSql(viewerId));
  if (params.tagIds.length > 0) filters.push(allTagsAttachedSql(viewerId, params.tagIds));
  const where = and(narrowed, ...filters)!;

  const requestedPage = Math.max(1, params.page);
  const [total, lifecycleCounts, favoriteCount, owners, optimisticRows, teamWideTotal] =
    await Promise.all([
      countMatches(where),
      countLifecycles(narrowed),
      countFavorites(params, narrowed),
      listOwners(narrowed),
      selectPage(params, where, requestedPage),
      mine ? countMatches(and(teamWide, ...filters)!) : Promise.resolve(null),
    ]);
  const totalPages = Math.max(1, Math.ceil(total / SURVEY_LIST_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const rows = page === requestedPage ? optimisticRows : await selectPage(params, where, page);

  return {
    rows,
    total,
    page,
    totalPages,
    lifecycleCounts,
    favoriteCount,
    owners,
    activeTeam,
    teamWideTotal,
  };
}

/**
 * 자동완성 설문 후보 (티켓 05) — 범위 안에서 검색어가 맞는 설문을 최근 수정순으로 최대 5건.
 *
 * 목록 페이지와 **같은 원천 조건(`scopedSurveyWhere`)과 같은 검색 조각(`surveyListSearchSql`)**을 쓴다 —
 * 후보에 뜬 설문이 Enter 로 연 목록에 없거나, 목록에 없는 설문이 후보로 새는 일이 없게. 검색 조각이
 * 소유자 이름을 읽으므로 `users` 조인을 건다. 응답 수는 세지 않는다. 빈 검색어면 조회 없이 빈 후보다.
 */
export async function querySurveySuggestions(
  filter: ScopedFilter,
  q: string,
): Promise<SurveySuggestion[]> {
  const search = surveyListSearchSql(q, filter.viewerId);
  if (!search) return [];
  return db
    .select({
      id: surveys.id,
      displayTitle: cardTitleSql,
      ownerName: users.name,
      lifecycle: surveyListLifecycleSql(),
    })
    .from(surveys)
    .leftJoin(users, eq(users.id, surveys.ownerUserId))
    .where(and(scopedSurveyWhere(filter), search))
    .orderBy(desc(surveys.updatedAt), desc(surveys.createdAt), asc(surveys.id))
    .limit(SURVEY_SUGGEST_LIMIT);
}
