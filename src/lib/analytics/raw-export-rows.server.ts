import 'server-only';

import { and, asc, count, eq, inArray, notExists, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveyResponses } from '@/db/schema';
import { notDeletedResponse } from '@/data/response-filters';
import { getQuestionGroupsBySurvey } from '@/data/surveys';
import { loadChangeConfirmQuestionIds } from '@/features/contacts/server/services/contact-prior-answers.service';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';
import { getSurveyContactStats } from '@/lib/operations/contact-stats.server';
import type { RawExportContactColumn } from '@/lib/operations/contacts';
import { decryptPiiForExport } from '@/lib/operations/contacts-export.server';
import {
  responseScopeCondition,
  targetScopeCondition,
  testFlagForScope,
  type OperationsDataScope,
} from '@/lib/operations/data-scope.server';

import { buildQuestionMetaMap, buildStepLabelMap } from './raw-export-helpers';
import {
  buildContactValues,
  buildNonRespondentRow,
  sortRowsForContactPopulation,
} from './raw-export-rows';
import type { RawExportContext, RawExportResponseRow } from './raw-workbook';

// ============================================================
// Raw 내보내기 로더 — raw / raw-split 라우트와 split-preview 가 공유
// ============================================================

export const MAX_EXPORT_RESPONSES = 10000;

export interface RawExportContextOptions {
  /**
   * 「조사 대상 명단 열 포함」 — 붙일 attrs.*·pii.* 열. 비어 있거나 없으면 attrs 를 select 하지
   * 않고 복호화도 하지 않는다 (기존 쿼리 그대로).
   */
  contactColumns?: readonly RawExportContactColumn[];
}

export interface RawExportLoadOptions extends RawExportContextOptions {
  /** 「조사 대상 중 미응답자 포함」 — 응답이 없는 스코프 파티션 조사 대상을 미응답 행으로 넣는다 */
  includeNonRespondents: boolean;
}

export interface RawExportPopulationCount {
  responseCount: number;
  /** 토글 꺼짐이면 0 (쿼리하지 않는다) */
  nonRespondentCount: number;
}

export type RawExportLoadResult =
  | ({ kind: 'ok'; rows: RawExportResponseRow[] } & RawExportPopulationCount)
  | ({ kind: 'too_many' } & RawExportPopulationCount);

/** raw 모수 술어 — 삭제·테스트 제외 전 상태 (진행중·이탈 포함, 상태 컬럼으로 구분). */
function rawResponseWhere(surveyId: string, scope: OperationsDataScope) {
  return and(
    eq(surveyResponses.surveyId, surveyId),
    notDeletedResponse,
    responseScopeCondition(scope),
  );
}

/**
 * 미응답 조사 대상 술어 — 스코프 파티션의 조사 대상 중 raw 모수 응답이 하나도 없는 것.
 * rawWhere 를 그대로 끼워 넣어 모수 정의와 어긋나지 않게 한다. 삭제된 응답만 있는 조사 대상은
 * raw 모수에 행이 없으므로 미응답이다(「행 = 조사 대상 전원」이 성립하려면 이쪽이어야 한다).
 * contact_targets.response_id 역참조는 쓰지 않는다 — 그 컬럼은 매칭 캐시일 뿐이다.
 *
 * 서브쿼리에 db 를 쓰지 않고 sql 템플릿에 테이블·술어를 끼운다 — 라우트 테스트가 db 체인을
 * 가짜로 두므로 중첩 db.select 는 mock 에서 깨진다. ${surveyResponses} 는 테이블명으로 렌더된다.
 * notExists 는 SQL 조각을 괄호 없이 붙이므로 괄호를 직접 쓴다.
 */
function nonRespondentWhere(surveyId: string, scope: OperationsDataScope) {
  return and(
    eq(contactTargets.surveyId, surveyId),
    targetScopeCondition(scope),
    notExists(
      sql`(select 1 from ${surveyResponses} where ${and(
        eq(surveyResponses.contactTargetId, contactTargets.id),
        rawResponseWhere(surveyId, scope),
      )})`,
    ),
  );
}

/**
 * 모수 크기 — 응답 수와(토글 켜짐일 때만) 미응답 조사 대상 수.
 * 한도 초과 판정은 JSONB 페이로드를 물화하기 전에 count 로 먼저 한다 (.sav 경로와 동일).
 * 전 상태 모수 확장으로 행 수가 커질 수 있어, 초과 설문에서 413 대신 서버리스
 * 메모리 고갈/타임아웃이 나는 것을 막는다.
 */
export async function countRawExportPopulation(
  surveyId: string,
  scope: OperationsDataScope,
  options: RawExportLoadOptions,
): Promise<RawExportPopulationCount> {
  const responseRows = await db
    .select({ total: count() })
    .from(surveyResponses)
    .where(rawResponseWhere(surveyId, scope));
  const responseCount = responseRows[0]?.total ?? 0;
  if (!options.includeNonRespondents) return { responseCount, nonRespondentCount: 0 };

  const targetRows = await db
    .select({ total: count() })
    .from(contactTargets)
    .where(nonRespondentWhere(surveyId, scope));
  return { responseCount, nonRespondentCount: targetRows[0]?.total ?? 0 };
}

/** 조사 대상 참조 — 메타 열 값 + (명단 열이 켜졌을 때만) attrs. */
interface ContactRef {
  id: string;
  resid: number;
  groupValue: string | null;
  inviteCode: string | null;
  attrs?: Record<string, string>;
}

const CONTACT_REF_SELECT = {
  id: contactTargets.id,
  resid: contactTargets.resid,
  groupValue: contactTargets.groupValue,
  inviteCode: contactTargets.inviteCode,
};

/**
 * 조사 대상 조회 — 응답의 컨택(inArray)과 미응답 조사 대상(술어 + resid 순)이 같은 열을 싣는다.
 * attrs(JSONB, 컨택당 수백 키) 는 명단 열이 켜졌을 때만 select 목록에 넣는다 — 꺼진 경로의
 * 쿼리는 도입 전과 같다.
 */
async function fetchContactRefs(
  where: SQL | undefined,
  opts: { withAttrs: boolean; orderByResid: boolean },
): Promise<ContactRef[]> {
  if (opts.withAttrs) {
    const query = db
      .select({ ...CONTACT_REF_SELECT, attrs: contactTargets.attrs })
      .from(contactTargets)
      .where(where);
    return opts.orderByResid ? await query.orderBy(asc(contactTargets.resid)) : await query;
  }
  const query = db.select(CONTACT_REF_SELECT).from(contactTargets).where(where);
  return opts.orderByResid ? await query.orderBy(asc(contactTargets.resid)) : await query;
}

/**
 * 조사 대상 명단 열 값 — 컨택 id → contactValues. 응답 수와 무관하게 복호화 1회
 * (decryptPiiForExport 내부 청크 제외) — N+1 없음. pii 열이 없으면 복호화를 부르지 않는다.
 * 조사 대상 엑셀과 같은 복호화 경로라 평문이 나간다 — 호출부(라우트)가 그 사실을 책임진다.
 */
async function loadContactValues(
  contacts: readonly ContactRef[],
  columns: readonly RawExportContactColumn[],
): Promise<Map<string, Record<string, string>>> {
  const piiKeys = columns.filter((c) => c.kind === 'pii').map((c) => c.key);
  const piiMap =
    piiKeys.length > 0
      ? await decryptPiiForExport(
          contacts.map((c) => c.id),
          piiKeys,
        )
      : new Map<string, Record<string, string>>();
  const out = new Map<string, Record<string, string>>();
  for (const c of contacts) {
    out.set(c.id, buildContactValues(columns, c.attrs ?? {}, piiMap.get(c.id)));
  }
  return out;
}

/** 조사 대상이 있는 행에만 contactValues 를 싣는다 — 익명 응답은 키 자체를 넣지 않는다. */
function attachContactValues(
  row: RawExportResponseRow,
  values: Record<string, string> | undefined,
): RawExportResponseRow {
  if (values) row.contactValues = values;
  return row;
}

/**
 * raw/raw-split 공용 응답 로더.
 * 모수: 삭제·테스트 제외 전 상태 (진행중·이탈 포함 — 상태 컬럼으로 구분).
 * .sav 의 완료 전용 모수와 다름 (response-filters.ts 참조).
 * 토글이 켜지면 스코프 파티션의 미응답 조사 대상이 미응답 행으로 더해지고 시스템ID 순으로 정렬된다.
 * 명단 열이 켜지면 조사 대상이 있는 행에 contactValues 가 붙는다 (미응답 행 포함).
 * 두 토글이 꺼진 경로의 SQL 호출과 행 순서는 도입 전과 같다.
 */
export async function loadRawExportRows(
  surveyId: string,
  scope: OperationsDataScope,
  options: RawExportLoadOptions,
): Promise<RawExportLoadResult> {
  const population = await countRawExportPopulation(surveyId, scope, options);
  if (population.responseCount + population.nonRespondentCount > MAX_EXPORT_RESPONSES) {
    return { kind: 'too_many', ...population };
  }

  const rawResponses = await db.query.surveyResponses.findMany({
    where: rawResponseWhere(surveyId, scope),
    orderBy: (r, { asc }) => [asc(r.startedAt)],
  });

  // count 와 fetch 사이 유입 경합 대비 벨트 (정상 경로에서는 no-op)
  if (rawResponses.length + population.nonRespondentCount > MAX_EXPORT_RESPONSES) {
    return { kind: 'too_many', ...population };
  }

  const contactColumns = options.contactColumns ?? [];
  const withAttrs = contactColumns.length > 0;

  const contactIds = rawResponses
    .map((r) => r.contactTargetId)
    .filter((v): v is string => !!v);
  const contactMap = new Map<string, ContactRef>();
  if (contactIds.length > 0) {
    const targets = await fetchContactRefs(inArray(contactTargets.id, contactIds), {
      withAttrs,
      orderByResid: false,
    });
    for (const t of targets) contactMap.set(t.id, t);
  }

  const nonRespondents = options.includeNonRespondents
    ? await fetchContactRefs(nonRespondentWhere(surveyId, scope), { withAttrs, orderByResid: true })
    : [];

  // 같은 컨택이 양쪽에 있을 수 없다 — 미응답 술어가 배제한다. 값 조립은 조사 대상 수만큼 1회.
  const contactValues = withAttrs
    ? await loadContactValues([...contactMap.values(), ...nonRespondents], contactColumns)
    : null;

  const responseRows: RawExportResponseRow[] = rawResponses.map((r) => {
    const c = r.contactTargetId ? contactMap.get(r.contactTargetId) : undefined;
    const row: RawExportResponseRow = {
      id: r.id,
      questionResponses: decryptQuestionResponses(
        (r.questionResponses ?? {}) as Record<string, unknown>,
        { responseId: r.id },
      ),
      groupValue: c?.groupValue ?? null,
      resid: c?.resid ?? null,
      inviteCode: c?.inviteCode ?? null,
      ipHash: r.ipHash,
      currentStepId: r.currentStepId,
      platform: r.platform,
      browser: r.browser,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      totalSeconds: r.totalSeconds,
    };
    return attachContactValues(row, c ? contactValues?.get(c.id) : undefined);
  });

  if (!options.includeNonRespondents) return { kind: 'ok', rows: responseRows, ...population };

  const rows = sortRowsForContactPopulation([
    ...responseRows,
    ...nonRespondents.map((t) =>
      attachContactValues(buildNonRespondentRow(t), contactValues?.get(t.id)),
    ),
  ]);
  return { kind: 'ok', rows, ...population };
}

/**
 * 메타 컬럼 렌더 컨텍스트 — 개별 URL 베이스와 마지막 입력 문항 라벨 맵.
 * options.contactColumns 는 로더에 넘긴 것과 같은 객체를 그대로 싣는다 (열 정의 = 값 키).
 */
export async function buildRawExportContext(
  surveyId: string,
  scope: OperationsDataScope,
  questions: Array<{
    id: string;
    order: number;
    title: string;
    type: string;
    groupId: string | null;
    pageBreakBefore: boolean | null;
    questionCode: string | null;
  }>,
  options: RawExportContextOptions = {},
): Promise<RawExportContext> {
  const groups = await getQuestionGroupsBySurvey(surveyId);
  // 조건부 메타 열 판정 — 설문 설정 기준 (응답 매칭 여부 무관):
  // 컨택 타겟이 없으면 시스템ID 열, 그룹값이 전무하면 조사 대상 그룹 열을 만들지 않는다.
  // raw export 모수는 테스트 응답 제외이므로 컨택 통계도 real 스코프로 한정한다.
  const { hasContacts, hasContactGroups } = await getSurveyContactStats(surveyId, scope);
  // 추적조사 — 이월 응답도 raw export 모수와 같은 스코프 파티션만 본다.
  const changeConfirmQuestionIds = await loadChangeConfirmQuestionIds(surveyId, {
    isTest: testFlagForScope(scope),
  });
  const stepQs = questions.map((q) => ({
    id: q.id,
    order: q.order,
    title: q.title,
    type: q.type,
    groupId: q.groupId,
    pageBreakBefore: q.pageBreakBefore ?? false,
    questionCode: q.questionCode,
  }));
  return {
    appUrl: (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, ''),
    stepLabels: buildStepLabelMap(stepQs, groups),
    hasContacts,
    hasContactGroups,
    questionMeta: buildQuestionMetaMap(questions),
    changeConfirmQuestionIds,
    ...(options.contactColumns ? { contactColumns: options.contactColumns } : {}),
  };
}
