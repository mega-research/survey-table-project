import 'server-only';

import { and, asc, count, eq, inArray, notExists, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveyResponses, surveyVersions } from '@/db/schema';
import { notDeletedResponse } from '@/data/response-filters';
import { getQuestionGroupsBySurvey } from '@/data/surveys';
import {
  loadChangeConfirmQuestionIds,
  loadPriorAnswersByContactTargets,
} from '@/features/contacts/server/services/contact-prior-answers.service';
import { decryptQuestionResponses, isEncryptedAnswerValue } from '@/lib/crypto/response-pii';
import { getSurveyContactStats } from '@/lib/operations/contact-stats.server';
import type { RawExportContactColumn } from '@/lib/operations/contacts';
import { decryptPiiForExport } from '@/lib/operations/contacts-export.server';
import {
  responseScopeCondition,
  targetScopeCondition,
  testFlagForScope,
  type OperationsDataScope,
} from '@/lib/operations/data-scope.server';
import type { Question } from '@/types/survey';

import { buildQuestionMetaMap, buildStepLabelMap } from './raw-export-helpers';
import {
  type ExportStripContext,
  buildContactValues,
  buildNonRespondentRow,
  mergePriorAnswersIntoResponses,
  mergePriorAnswersIntoRows,
  omitDisabledPriorAnswersByContact,
  sortRowsForContactPopulation,
  stripHiddenFromExportRows,
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
  /**
   * 「이월 응답 포함」 — 조사 대상에 붙은 지난 회차 답으로 빈 문항을 채운다. 이번 회차에
   * 키가 있는 문항은 건드리지 않는다 (mergePriorAnswersIntoResponses). 미응답 행은 통째로
   * 이월값이 된다. 꺼져 있으면 쿼리하지 않는다.
   */
  includePriorAnswers?: boolean;
  /**
   * 「이월값 불러오기」를 끈 문항 판정용 현재 문항 목록. includePriorAnswers 일 때만 쓰며,
   * 없으면 걷어내지 않는다 (omitDisabledPriorAnswersByContact).
   */
  questions?: readonly Question[];
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
  inviteCode: string | null;
  attrs?: Record<string, string>;
}

const CONTACT_REF_SELECT = {
  id: contactTargets.id,
  resid: contactTargets.resid,
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

/** strip 판정에 필요한 응답 행의 최소 모양 — findMany 결과의 부분집합. */
interface StripCandidate {
  id: string;
  status: string;
  versionId: string | null;
  lastEditedAt: Date | null;
  contactTargetId: string | null;
}

/**
 * 숨은 문항 strip 대상 — **어떤 strip 경계도 지나지 않은 부분저장 행**뿐이다.
 *
 * `is_completed` 로 고르면 안 된다. 자격미달(`screened_out`)은 제출을 끝낸 종결 응답인데도
 * `is_completed=false` 라(response.service 의 같은 지적 참조) 확정된 답을 지금 attrs 로 다시
 * 판정하게 된다 — 명단을 재업로드해 attrs 가 바뀌었으면 멀쩡한 답이 조용히 사라진다.
 * 그래서 종결 상태(completed/screened_out/quotaful_out/bad)를 전부 빼고 화이트리스트로 고른다.
 *
 * 어드민이 손댄 행(`lastEditedAt`)도 뺀다. 그 경로는 이미 strip 을 돌렸고, 구버전 이관
 * (`migrating`)일 때는 **일부러 걸지 않은** 채 versionId 를 현재 버전으로 재핀한다
 * (response-edit.service 스펙 결정 5). 여기서 새 스냅샷으로 다시 판정하면 이관이 보존한
 * 답을 정면으로 지운다.
 *
 * versionId 가 없는 레거시 행은 판정 기준 자체가 없어 제외한다.
 */
const STRIPPABLE_STATUSES: ReadonlySet<string> = new Set(['in_progress', 'drop']);

function stripCandidates(rows: readonly StripCandidate[]): StripCandidate[] {
  return rows.filter(
    (r) =>
      STRIPPABLE_STATUSES.has(r.status) && r.versionId !== null && r.lastEditedAt === null,
  );
}

/**
 * 복호화가 안 풀린 값이 남았는지 — 남았으면 그 행은 판정하지 않는다.
 *
 * `decryptQuestionResponses` 는 키 오류 등으로 실패하면 예외를 삼키고 `vN:` 암호문을 그대로
 * 돌려준다(export 가 죽지 않는 것이 우선). 가시성 평가기는 그 암호문을 "판정 불가"가 아니라
 * 그냥 문자열로 비교하므로, 암호화된 문항이 표시 조건의 컨트롤러면 조건이 거짓으로 풀려
 * 멀쩡한 하류 답까지 지워진다. 복호화 장애 한 건이 다른 답의 손실로 번지지 않게 막는다.
 */
function hasResidualCiphertext(answers: Record<string, unknown>): boolean {
  for (const value of Object.values(answers)) {
    if (isEncryptedAnswerValue(value)) return true;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const cellValue of Object.values(value as Record<string, unknown>)) {
        if (isEncryptedAnswerValue(cellValue)) return true;
      }
    }
  }
  return false;
}

/**
 * strip 대상 행별 평가 재료 — **그 응답이 수집된 버전**의 스냅샷 + 컨택 attrs.
 * 최신 버전으로 판정하면 나중에 좁아진 조건이 이미 수집된 답을 소급해 지운다
 * (어드민 수정이 `migrating` 을 제외하는 것과 같은 이유). 스냅샷이 prune 됐거나
 * questions 가 배열이 아니면 그 행은 컨텍스트를 안 만들어 원본 그대로 내보낸다.
 * 대상이 없으면 버전 조회 자체를 하지 않는다.
 *
 * **attrs 는 응답 시점이 아니라 현재 값이다 — 알고 받아들인 한계다(2026-09-09 결정).**
 * `contact_targets.attrs` 는 현재 값 한 벌뿐이고 이력이 없어 응답 시점 attrs 를 되살릴
 * 방법이 없다. 그래서 명단을 재업로드해 attrs 가 바뀌면, 응답 당시에는 보였던 문항의 답이
 * 지금 기준으로는 숨은 것이 되어 내보내기에서 빠질 수 있다.
 *
 * 대상이 제출 전 초안뿐이라 대개는 문제가 아니다 — 그 응답자가 제출하면 서버도 똑같이
 * 현재 attrs 로 지우므로 내보내기가 제출 결과를 미리 보여주는 셈이다. 손해가 남는 곳은
 * 영영 제출하지 않는 이탈 응답 하나뿐이고, 그 경우 실제로 답한 값을 내보내기에서만 잃는다.
 * attrs 조건이 걸린 문항을 통째로 제외하는 안은 검토 후 미채택 — 이 설문 형식에서는
 * 이월 판정 문항 대부분이 attrs 조건이라 걸러내기 자체가 무력해진다.
 */
async function loadStripContexts(
  candidates: readonly StripCandidate[],
  contactMap: ReadonlyMap<string, ContactRef>,
): Promise<Map<string, ExportStripContext>> {
  const out = new Map<string, ExportStripContext>();
  if (candidates.length === 0) return out;

  const versionIds = [...new Set(candidates.map((r) => r.versionId as string))];
  const versionRows = await db.query.surveyVersions.findMany({
    where: inArray(surveyVersions.id, versionIds),
    columns: { id: true, snapshot: true },
  });
  const snapshotById = new Map(versionRows.map((v) => [v.id, v.snapshot]));

  for (const r of candidates) {
    const snap = snapshotById.get(r.versionId as string) as
      | { questions?: unknown; groups?: unknown; lookups?: unknown }
      | null
      | undefined;
    if (!snap || !Array.isArray(snap.questions)) continue;
    const attrs = r.contactTargetId ? contactMap.get(r.contactTargetId)?.attrs : undefined;
    out.set(r.id, {
      questions: snap.questions as ExportStripContext['questions'],
      groups: Array.isArray(snap.groups)
        ? (snap.groups as ExportStripContext['groups'])
        : undefined,
      lookups: Array.isArray(snap.lookups)
        ? (snap.lookups as ExportStripContext['lookups'])
        : undefined,
      contactAttrs: attrs,
    });
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
  const withContactColumns = contactColumns.length > 0;

  // 숨은 문항 판정은 attrs 를 보는 조건(`attr` 피연산자)을 풀어야 한다 — attrs 없이 판정하면
  // 그 조건이 통째로 뒤집혀 멀쩡한 답이 지워진다. 그래서 명단 열이 꺼져 있어도 strip 대상에
  // 컨택이 붙어 있으면 attrs 를 읽는다. 대상이 없으면 쿼리는 도입 전과 같다.
  // 복호화를 먼저 한다 — strip 후보 판정이 "복호화가 안 풀린 값이 남았는가"를 봐야 하고,
  // 그 판정이 attrs 를 읽을지(withAttrs) 를 정하기 때문이다. 복호화는 컨택과 무관하다.
  const decryptedById = new Map<string, Record<string, unknown>>(
    rawResponses.map((r) => [
      r.id,
      decryptQuestionResponses((r.questionResponses ?? {}) as Record<string, unknown>, {
        responseId: r.id,
      }),
    ]),
  );
  const candidates = stripCandidates(rawResponses).filter(
    (r) => !hasResidualCiphertext(decryptedById.get(r.id) ?? {}),
  );
  const withAttrs = withContactColumns || candidates.some((r) => r.contactTargetId !== null);

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
    ? await fetchContactRefs(nonRespondentWhere(surveyId, scope), {
        withAttrs: withContactColumns,
        orderByResid: true,
      })
    : [];

  // 같은 컨택이 양쪽에 있을 수 없다 — 미응답 술어가 배제한다. 값 조립은 조사 대상 수만큼 1회.
  // 명단 열이 꺼져 있으면 부르지 않는다 — 빈 열 목록으로 부르면 모든 행에 빈 contactValues 가
  // 붙어 도입 전과 파일이 달라진다.
  const contactValues = withContactColumns
    ? await loadContactValues([...contactMap.values(), ...nonRespondents], contactColumns)
    : null;

  const stripContexts = await loadStripContexts(candidates, contactMap);

  const responseRows: RawExportResponseRow[] = rawResponses.map((r) => {
    const c = r.contactTargetId ? contactMap.get(r.contactTargetId) : undefined;
    const row: RawExportResponseRow = {
      id: r.id,
      questionResponses: decryptedById.get(r.id) ?? {},
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

  // 숨은 문항 값은 내보내는 값에서만 뺀다 — DB 는 건드리지 않는다.
  const strippedRows = stripHiddenFromExportRows(responseRows, stripContexts);

  // 이월 응답 합치기 — 숨은 문항 strip **뒤**다. 이월값은 이번 조사표의 조건과 무관하게
  // 싣기로 했으므로(다이얼로그 설명 참조) strip 이 이월값을 보면 안 된다.
  const loadedPrior = options.includePriorAnswers
    ? await loadPriorAnswersByContactTargets([
        ...contactMap.keys(),
        ...nonRespondents.map((t) => t.id),
      ])
    : null;
  // 「이월값 불러오기」를 끈 문항은 응답 행·미응답 행 모두 비워 둔다.
  const priorByContactId =
    loadedPrior && options.questions
      ? omitDisabledPriorAnswersByContact(loadedPrior, options.questions)
      : loadedPrior;
  const contactIdByRowId = new Map(rawResponses.map((r) => [r.id, r.contactTargetId]));
  const mergedRows = priorByContactId
    ? mergePriorAnswersIntoRows(
        strippedRows,
        priorByContactId,
        (row) => contactIdByRowId.get(row.id) ?? null,
      )
    : strippedRows;

  if (!options.includeNonRespondents) return { kind: 'ok', rows: mergedRows, ...population };

  // 미응답 행은 이번 회차 답이 없으므로 이월값이 통째로 실린다.
  const nonRespondentRows = nonRespondents.map((t) => {
    const base = buildNonRespondentRow(t);
    const withPrior = priorByContactId
      ? { ...base, questionResponses: mergePriorAnswersIntoResponses(base.questionResponses, priorByContactId.get(t.id)) }
      : base;
    return attachContactValues(withPrior, contactValues?.get(t.id));
  });
  const rows = sortRowsForContactPopulation([...mergedRows, ...nonRespondentRows]);
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
  // 컨택 타겟이 없으면 시스템ID 열을 만들지 않는다. 컨택 통계도 같은 스코프 파티션으로 센다.
  const { hasContacts } = await getSurveyContactStats(surveyId, scope);
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
    questionMeta: buildQuestionMetaMap(questions),
    changeConfirmQuestionIds,
    ...(options.contactColumns ? { contactColumns: options.contactColumns } : {}),
  };
}
