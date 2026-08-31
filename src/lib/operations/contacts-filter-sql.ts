import { sql, type SQL } from 'drizzle-orm';

import type { MailRecipientStatus } from '@/db/schema/mail';
import type { FilterClause, FilterCondition } from './contacts-filters.server';
import type { NumRange } from './range-list';
import {
  FILTER_SOURCE,
  UNSUBSCRIBE_RESULT_CODE_KEYWORD,
  escapeLikePattern,
  isUnsubscribeResultCode,
} from './filter-shared';

/**
 * 컨택 필터 WHERE 빌더 — DB 의존 없는 순수 SQL 조립 모듈.
 *
 * contacts.server (조사대상목록) 와 campaigns.server (단체 메일 후보) 가 공유한다.
 * `@/db` 를 import 하지 않으므로 단위 테스트에서 db mock 없이 검증 가능하고,
 * campaigns.server 가 무거운 contacts.server 전체를 끌어오지 않게 한다.
 */

// 최신 회차의 result_code — buildClauseSql(enum) 과 contacts.server SELECT 양쪽에서 사용.
// outer correlation 은 명시적 qualifier 필수 — Drizzle 의 sql template literal 안에서
// ${contactTargets.id} 는 unqualified "id" 로 렌더되어 inner contact_attempts.id 와
// 충돌하므로 "contact_targets"."id" 직접 박는다.
export const latestResultCodeExpr = sql<string | null>`(
  SELECT result_code FROM contact_attempts
  WHERE contact_target_id = "contact_targets"."id"
  ORDER BY attempt_no DESC LIMIT 1
)`;

// 조사 대상별 최신(created_at DESC) 메일 수신 상태 1건 — SELECT(메일 컬럼 표시)와
// 필터(mailStatusCondSql)·정렬(mailStatusRankExpr)이 공유.
// outer correlation 은 명시적 qualifier 필수 (latestResultCodeExpr 주석 참고).
// 인덱스: idx_mail_recipients_target_created (contact_target_id, created_at DESC).
export const latestMailStatusExpr = sql<MailRecipientStatus | null>`(
  SELECT mail_recipients.status FROM mail_recipients
  INNER JOIN mail_campaigns ON mail_campaigns.id = mail_recipients.campaign_id
  WHERE mail_recipients.contact_target_id = "contact_targets"."id"
    AND mail_recipients.archived_at IS NULL
    AND mail_campaigns.archived_at IS NULL
    AND mail_campaigns.is_test = "contact_targets"."is_test"
  ORDER BY mail_recipients.created_at DESC LIMIT 1
)`;

/**
 * 유효 메일 상태 — 수신거부 신호(contact_targets.unsubscribed_at 또는 최근
 * 결과코드의 수신거부 기록)가 있으면 발송 이력과 무관하게 'skipped_unsubscribed',
 * 없으면 최신 수신 상태(latestMailStatusExpr).
 *
 * 표시(contacts.server SELECT)·필터(mailStatusCondSql)·정렬(mailStatusRankExpr)이
 * 반드시 이 단일 표현식을 공유해야 한다 — 갈라지면 셀에 수신거부로 보이는 행이
 * 열람/없음 필터에 다시 잡히는 어긋남이 생긴다.
 */
export const effectiveMailStatusExpr = sql<MailRecipientStatus | null>`(CASE
  WHEN "contact_targets".unsubscribed_at IS NOT NULL THEN 'skipped_unsubscribed'
  WHEN ${latestResultCodeExpr} LIKE '%' || ${UNSUBSCRIBE_RESULT_CODE_KEYWORD} || '%' THEN 'skipped_unsubscribed'
  ELSE ${latestMailStatusExpr}
END)`;

/**
 * 세 수신거부 신호(메일 해지 링크 unsubscribed_at · 발송 스킵 상태 · 최근 결과코드
 * 수신거부)를 하나로 접은 단일 판정. 컨택결과 필터의 수신거부 코드 선택도 이 판정을
 * OR 로 결합해, 어느 경로의 수신거부든 같은 조회로 잡히게 한다.
 */
export const isUnsubscribedSql = sql`${effectiveMailStatusExpr} = 'skipped_unsubscribed'`;

/**
 * 최근 결과코드가 수신거부 키워드인지 — 단체메일 배제(후보·preflight·createCampaign)와
 * 수신거부자 명단이 공유하는 축. 결과코드의 status(negative 여부)와 무관하게 성립한다 —
 * 수신거부는 "메일 거부" 의사라 모집단(진척률 분모)에서는 빼지 않되 단체메일에서는
 * 항상 제외해야 하므로, neutral 수신거부 코드도 이 축이 잡는다.
 *
 * COALESCE 필수 — 회차가 없으면 서브쿼리·LIKE 가 NULL 이고, 호출부의 `NOT (...)` 이
 * 3값 논리로 NULL 이 되어 회차 없는 정상 컨택 전부가 WHERE 에서 탈락한다.
 */
export const latestResultUnsubscribedSql = sql`COALESCE(${latestResultCodeExpr} LIKE '%' || ${UNSUBSCRIBE_RESULT_CODE_KEYWORD} || '%', FALSE)`;

/**
 * 메일 필터 값 1개 → SQL 조건. 'none' 은 발송 이력 없음(IS NULL), 그 외는
 * 유효 메일 상태 일치. 값 검증(MAIL_FILTER_VALUES)은 파서 책임.
 *
 * 유효 상태 기준이므로 수신거부 판정자는 'skipped_unsubscribed' 에서만 잡히고,
 * 원래 발송 상태(열람 등)나 'none' 필터에는 다시 잡히지 않는다.
 */
function mailStatusCondSql(value: string): SQL {
  return value === 'none'
    ? sql`${effectiveMailStatusExpr} IS NULL`
    : sql`${effectiveMailStatusExpr} = ${value}`;
}

/**
 * 메일 컬럼 상태 순위 정렬 표현식 — MAIL_FILTER_OPTIONS 순서(잘된 순: 열람 →
 * 전달 완료 → … → 실패)와 동일 축. 발송 이력 없음은 NULL 로 축 밖 — orderExpr 의
 * NULLS LAST 가 방향과 무관하게 항상 마지막에 고정한다 (web 정렬과 같은 규칙).
 * 축은 유효 메일 상태 — 수신거부 판정자는 원래 발송 상태가 아니라 수신거부 순위로 선다.
 */
export const mailStatusRankExpr = sql<number | null>`(CASE ${effectiveMailStatusExpr}
  WHEN 'opened' THEN 1
  WHEN 'delivered' THEN 2
  WHEN 'sent' THEN 3
  WHEN 'sending' THEN 4
  WHEN 'queued' THEN 5
  WHEN 'skipped_unsubscribed' THEN 6
  WHEN 'bounced' THEN 7
  WHEN 'complained' THEN 8
  WHEN 'failed' THEN 9
  ELSE NULL END)`;

/**
 * 절 SQL 이 참조하는 컬럼 주입 — 조사 대상은 `contact_targets` 실컬럼(기본값),
 * 응답 내역은 numbered subquery 의 컨택 LEFT JOIN 컬럼을 넘긴다. attrs/pii/resid
 * 절 로직을 페이지별로 복제하지 않기 위한 이음새.
 */
export interface ClauseColumnRefs {
  /** 시스템ID 정수 컬럼 */
  resid: SQL;
  /** 컨택 attrs JSONB 컬럼 */
  attrs: SQL;
  /** contact_pii 상관용 컨택 id */
  contactId: SQL;
  /**
   * 페이지 전용 source 의 절 빌더 (예: 응답 내역의 idx/browser/status).
   * SQL 을 반환하면 그 절로 확정, null 이면 공용 분기로 계속 진행한다.
   */
  extra?: (cond: FilterCondition) => SQL | null;
}

const CONTACT_TARGET_REFS: ClauseColumnRefs = {
  resid: sql`"contact_targets".resid`,
  attrs: sql`"contact_targets".attrs`,
  // contact_pii 도 id 컬럼이 있어 unquoted id 는 pp.id 로 해석된다 — 반드시 큰따옴표 사용.
  contactId: sql`"contact_targets"."id"`,
};

/**
 * 범위 목록 → 절 SQL. 단건은 IN 한 방(1개면 =), 범위 토큰만 BETWEEN, OR 결합.
 * 붙여넣은 ID 수천 개가 `= $1 OR = $2 OR …` 로 늘어지지 않게 한다.
 * 자체 괄호 — 외부 AND 결합 (eq(surveyId) 또는 다중 절) 시 PG AND>OR 우선순위로
 * 인한 cross-survey 누락/누출 방지.
 */
function rangesToSql(expr: SQL, ranges: NumRange[]): SQL {
  const singles = ranges.filter((r) => r.from === r.to).map((r) => r.from);
  const spans = ranges.filter((r) => r.from !== r.to);
  const parts: SQL[] = [];
  if (singles.length === 1) {
    parts.push(sql`${expr} = ${singles[0]}`);
  } else if (singles.length > 1) {
    parts.push(
      sql`${expr} IN (${sql.join(
        singles.map((v) => sql`${v}`),
        sql`, `,
      )})`,
    );
  }
  for (const r of spans) parts.push(sql`${expr} BETWEEN ${r.from} AND ${r.to}`);
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * 단일 절 SQL. cond.source 와 mode 별로 분기.
 *
 * SECURITY: cond.source 는 호출자에서 contactColumns 화이트리스트 검증 끝난 값만
 * 전달된다고 가정. value/from/to/blindIndex/key 모두 parameter binding 으로 안전.
 *
 * pii.* 평문 미노출 (사전 계산된 blindIndex 만 SQL 에 진입).
 * system.contact_result / system.web 은 contact_targets 전용 상관 서브쿼리라
 * refs 주입과 무관하게 조사 대상 절에서만 유효하다 (응답 내역 파서는 미생성).
 */
export function buildClauseSql(
  cond: FilterCondition,
  refs: ClauseColumnRefs = CONTACT_TARGET_REFS,
): SQL {
  const extraSql = refs.extra?.(cond) ?? null;
  if (extraSql) return extraSql;

  if (cond.source === FILTER_SOURCE.RESID) {
    if (cond.mode === 'idlist') {
      if (!cond.ranges || cond.ranges.length === 0) return sql`FALSE`;
      return rangesToSql(refs.resid, cond.ranges);
    }
    return sql`FALSE`;
  }

  if (cond.mode === 'in') {
    return buildInClauseSql(cond, refs);
  }

  if (cond.mode === 'any') {
    // 전체 컬럼 검색 — 하위 조건 OR 전개. 자체 괄호로 외부 AND 결합에 안전.
    const subs = (cond.subConditions ?? []).map((c) => buildClauseSql(c, refs));
    if (subs.length === 0) return sql`FALSE`;
    return sql`(${sql.join(subs, sql` OR `)})`;
  }

  if (cond.source === FILTER_SOURCE.CONTACT_RESULT && cond.mode === 'enum') {
    // includeNull = "결과 없음" — 회차 이력이 없거나 최신 회차 result_code 가 NULL.
    // 표(latestResultCode ?? '—')와 같은 판정이라 화면과 필터가 어긋나지 않는다.
    if (cond.includeNull === true) return sql`${latestResultCodeExpr} IS NULL`;
    // 수신거부 코드 선택은 메일 경로 수신거부(해지 링크·발송 스킵)까지 함께 잡는다.
    return isUnsubscribeResultCode(cond.value)
      ? sql`(${latestResultCodeExpr} = ${cond.value} OR ${isUnsubscribedSql})`
      : sql`${latestResultCodeExpr} = ${cond.value}`;
  }

  if (cond.source === FILTER_SOURCE.WEB && cond.mode === 'boolean') {
    return webStatusCondSql(cond.value);
  }

  if (cond.source === FILTER_SOURCE.EMAIL && cond.mode === 'boolean') {
    return mailStatusCondSql(cond.value);
  }

  if (cond.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX) && cond.mode === 'idlist') {
    // NO 같은 숫자 attrs 컬럼의 숫자 검색 (예: "3", "10-13, 15").
    if (!cond.ranges || cond.ranges.length === 0) return sql`FALSE`;
    const key = cond.source.slice(FILTER_SOURCE.ATTRS_PREFIX.length);
    // 숫자 가드는 반드시 CASE — `regex AND cast` 는 planner 가 AND 평가 순서를
    // 보장하지 않아 비숫자 값에서 cast 에러가 날 수 있다.
    const numExpr = sql`(CASE WHEN ${refs.attrs}->>${key} ~ '^[0-9]+$' THEN (${refs.attrs}->>${key})::numeric END)`;
    const conds: SQL[] = [rangesToSql(numExpr, cond.ranges)];
    if (cond.textFallback === true && cond.value.length > 0) {
      // 값이 순수 정수가 아닌 행(numExpr IS NULL)만 부분검색으로 건진다 — 숫자 값은
      // 위 숫자 매칭이 전담하므로 "1" 이 1044 를 다시 끌고 오지 않는다.
      const escaped = escapeLikePattern(cond.value);
      conds.push(
        sql`(${numExpr} IS NULL AND ${refs.attrs}->>${key} ILIKE '%' || ${escaped} || '%')`,
      );
    }
    return sql`(${sql.join(conds, sql` OR `)})`;
  }

  if (cond.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX) && cond.mode === 'text') {
    const key = cond.source.slice(FILTER_SOURCE.ATTRS_PREFIX.length);
    const escaped = escapeLikePattern(cond.value);
    return sql`${refs.attrs}->>${key} ILIKE '%' || ${escaped} || '%'`;
  }

  if (cond.source.startsWith(FILTER_SOURCE.PII_PREFIX) && cond.mode === 'exact') {
    if (!cond.blindIndex) return sql`FALSE`;
    const columnKey = cond.source.slice(FILTER_SOURCE.PII_PREFIX.length);
    return sql`EXISTS (
      SELECT 1 FROM contact_pii pp
      WHERE pp.contact_target_id = ${refs.contactId}
        AND pp.column_key = ${columnKey}
        AND pp.blind_index = ${cond.blindIndex}
    )`;
  }

  return sql`FALSE`;
}

/**
 * web 컬럼용 매칭 응답 서브쿼리 — contact_targets.response_id 는 completeResponse
 * (완료 시점)에만 채워지므로 역참조(survey_responses.contact_target_id — 응답 시작
 * 시점부터 존재)로 찾는다. 확정 링크(response_id)가 있으면 그 행 우선, 없으면
 * 최신 활동 행. 표시(contacts.server 의 status/progress SELECT)·정렬(활동 시각
 * responseActivityAtExpr)·필터(webStatusCondSql)가 반드시 같은 매칭을 공유해야
 * 한다 — 갈라지면 화면엔 진행중으로 보이는 행이 필터·정렬에서 응답없음으로
 * 취급되는 어긋남이 생긴다.
 */
export const matchedResponseSubquery = (selectExpr: SQL): SQL => sql`(
  SELECT ${selectExpr} FROM survey_responses
  WHERE contact_target_id = "contact_targets"."id"
    AND deleted_at IS NULL
    AND is_test = "contact_targets"."is_test"
  ORDER BY (id = "contact_targets"."response_id") DESC NULLS LAST,
           last_activity_at DESC NULLS LAST,
           created_at DESC
  LIMIT 1
)`;

/**
 * web 필터 값 1개 → SQL 조건. 상태 어휘(WEB_FILTER_OPTIONS)는 표시/정렬과 같은
 * 매칭(matchedResponseSubquery) 기준, 'none' 은 매칭 응답 없음.
 * 레거시 'true'/'false'(구 URL) 는 기존 respondedAt 이진 의미를 그대로 보존한다 —
 * 'false' 는 미완료 전체(진행중·이탈·미응답)라 'none' 과 다르다.
 */
function webStatusCondSql(value: string): SQL {
  switch (value) {
    case 'completed':
    case 'in_progress':
    case 'drop':
    case 'screened_out':
    case 'quotaful_out':
    case 'bad':
      return sql`${matchedResponseSubquery(sql`status`)} = ${value}`;
    case 'none':
      return sql`${matchedResponseSubquery(sql`status`)} IS NULL`;
    case 'true':
      return sql`"contact_targets".responded_at IS NOT NULL`;
    case 'false':
      return sql`"contact_targets".responded_at IS NULL`;
    default:
      return sql`FALSE`;
  }
}

/**
 * attrs 컬럼 자연 정렬 표현식 쌍 — [숫자 CASE 캐스트, 텍스트 원본].
 *
 * 숫자로만 된 값은 numeric 으로 먼저 정렬되고(비숫자는 NULL → NULLS LAST 로 뒤),
 * 이어서 텍스트 사전순으로 정렬된다. NO 처럼 숫자인 attrs 컬럼이
 * 1, 10, 100, 11 사전순으로 꼬이는 문제를 해결한다.
 */
export function attrsNaturalSortExprs(
  attrsKey: string,
  // 응답 내역은 numbered subquery 의 컨택 LEFT JOIN 컬럼을 주입 (기본값 = 조사 대상).
  attrsRef: SQL = sql`"contact_targets".attrs`,
): [SQL, SQL] {
  const textExpr = sql`${attrsRef}->>${attrsKey}`;
  const numericExpr = sql`(CASE WHEN ${attrsRef}->>${attrsKey} ~ '^[0-9]+(\\.[0-9]+)?$' THEN (${attrsRef}->>${attrsKey})::numeric END)`;
  return [numericExpr, textExpr];
}

/**
 * mode === 'in' (헤더 체크박스 필터) 절 SQL. 컬럼 내 OR = IN 목록.
 *
 * 값은 전부 parameter binding — `ANY(${arr})` 는 length=1 silent unwrap 함정이
 * 있어 sql.join 으로 IN (...) 을 직접 조립한다.
 */
function buildInClauseSql(cond: FilterCondition, refs: ClauseColumnRefs): SQL {
  const values = cond.values ?? [];
  // includeNull("— 인 것만")·excludeNull("— 제외")은 값 없이도 조건이 성립한다.
  if (values.length === 0 && cond.includeNull !== true && cond.excludeNull !== true) {
    return sql`FALSE`;
  }

  if (cond.source === FILTER_SOURCE.CONTACT_RESULT) {
    // 코드 IN 절과 "결과 없음"(IS NULL) 을 OR 로 묶는다 — NULL 은 IN 목록으로 표현 불가.
    const parts: SQL[] = [];
    if (values.length > 0) {
      parts.push(
        sql`${latestResultCodeExpr} IN (${sql.join(
          values.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    }
    if (cond.includeNull === true) parts.push(sql`${latestResultCodeExpr} IS NULL`);
    // 수신거부 코드가 선택에 포함되면 메일 경로 수신거부(해지 링크·발송 스킵)도 함께 잡는다.
    if (values.some((v) => isUnsubscribeResultCode(v))) parts.push(isUnsubscribedSql);
    return sql`(${sql.join(parts, sql` OR `)})`;
  }

  if (cond.source === FILTER_SOURCE.WEB) {
    // 다중 선택은 상태 조건 OR 전개 — 자체 괄호로 외부 AND 결합에 안전.
    const conds = values.map(webStatusCondSql);
    return sql`(${sql.join(conds, sql` OR `)})`;
  }

  if (cond.source === FILTER_SOURCE.EMAIL) {
    // 'none'(IS NULL) 이 섞일 수 있어 IN 목록 대신 조건 OR 전개.
    const conds = values.map(mailStatusCondSql);
    return sql`(${sql.join(conds, sql` OR `)})`;
  }

  if (cond.source.startsWith(FILTER_SOURCE.PII_PREFIX)) {
    // pii 의 in 모드는 "값 없음"/"값 있음" 전용 (파서가 그 외를 통과시키지 않는다).
    // contact_pii 행은 빈 값/정규화 후 빈 값이면 애초에 생성되지 않으므로 행 부재가 곧
    // 미기재다 — 표의 '—' 표시와 같은 판정.
    const columnKey = cond.source.slice(FILTER_SOURCE.PII_PREFIX.length);
    const piiExists = sql`EXISTS (
      SELECT 1 FROM contact_pii pp
      WHERE pp.contact_target_id = ${refs.contactId}
        AND pp.column_key = ${columnKey}
    )`;
    if (cond.excludeNull === true) return piiExists;
    if (cond.includeNull !== true) return sql`FALSE`;
    return sql`NOT ${piiExists}`;
  }

  if (cond.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX)) {
    const key = cond.source.slice(FILTER_SOURCE.ATTRS_PREFIX.length);
    if (cond.excludeNull === true) {
      // 키 부재(NULL)와 빈 문자열을 함께 제외 — 표가 둘 다 '—' 로 그린다.
      return sql`(${refs.attrs}->>${key} IS NOT NULL AND ${refs.attrs}->>${key} <> '')`;
    }
    const parts: SQL[] = [];
    if (values.length > 0) {
      parts.push(
        sql`${refs.attrs}->>${key} IN (${sql.join(
          values.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    }
    if (cond.includeNull === true) {
      // 키 부재(NULL)와 빈 문자열을 함께 접는다 — 표가 둘 다 '—' 로 그린다.
      parts.push(sql`(${refs.attrs}->>${key} IS NULL OR ${refs.attrs}->>${key} = '')`);
    }
    return sql`(${sql.join(parts, sql` OR `)})`;
  }

  // 그 외 in 미지원 source — distinct 열거 자체가 불가하므로 절 성립 불가.
  return sql`FALSE`;
}

/**
 * 절 배열 → WHERE 절. 좌→우 평가, 각 절 (...) 괄호로 우선순위 모호함 제거.
 *
 * 혼합 AND/OR 는 누적마다 명시적 괄호로 그룹화해 좌→우 평가를 강제한다.
 * PG 는 AND > OR 우선순위를 가지므로 `A OR B AND C` 를 평탄 연결하면
 * `A OR (B AND C)` 로 재해석되어 의도한 `(A OR B) AND C` 와 어긋난다.
 * 또한 호출자가 결과를 `and(eq(surveyId), ..., 결과)` 로 결합하므로
 * 그룹화가 빠지면 OR 가지가 surveyId 제약을 탈출해 cross-survey 누출 위험이 있다.
 *
 * 빈 배열 → TRUE (전체 조회).
 */
export function buildContactsFilterSql(
  clauses: FilterClause[],
  refs: ClauseColumnRefs = CONTACT_TARGET_REFS,
): SQL {
  if (clauses.length === 0) return sql`TRUE`;
  const first = clauses[0];
  if (!first) return sql`TRUE`;
  // 첫 절도 괄호로 감싸 buildClauseSql 의 결과가 내부 OR 체인이어도 외부 AND 와 안전하게 결합.
  let expr: SQL = sql`(${buildClauseSql(first.condition, refs)})`;
  for (let i = 1; i < clauses.length; i++) {
    const clause = clauses[i];
    if (!clause) continue;
    const next = buildClauseSql(clause.condition, refs);
    const op = clause.op === 'OR' ? sql.raw('OR') : sql.raw('AND');
    // 누적 결합마다 (...) 로 그룹화 — PG AND>OR 우선순위가 좌→우 평가를 뒤엎지 못하게 한다.
    expr = sql`(${expr} ${op} (${next}))`;
  }
  return expr;
}
