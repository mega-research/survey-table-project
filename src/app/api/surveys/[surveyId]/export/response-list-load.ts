import 'server-only';

import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { questions as questionsTable } from '@/db/schema';
import { decryptPiiForTargets } from '@/lib/crypto/contact-pii-repo';
import { maskExportValue } from '@/lib/crypto/export-pii-mask';
import {
  answerKeyOf,
  hydrateProfileColumns,
  visibleProfileColumns,
} from '@/lib/operations/profile-columns-format';
import { buildStepLocationMap } from '@/lib/operations/profiles-format';
import {
  type ResponseListSheetInput,
  buildResponseListTable,
} from '@/lib/operations/response-list-sheet';
import type { OperationsDataScope } from '@/server/data-scope';
import { getSurveyContactStats } from '@/server/operations/services/contact-stats';
import { loadProfileAnswerValues } from '@/server/operations/services/profile-answer-values';
import { listResponsesForProfiles } from '@/server/operations/services/profiles';
import { getContactColumnScheme } from '@/server/read-models/contacts';
import {
  getProfileAnswerChoices,
  getProfileAnswerSources,
  getProfileColumnScheme,
  getProfileEntryParamNames,
} from '@/server/read-models/profile-column-scheme';
import { getQuestionGroupsBySurvey } from '@/server/read-models/survey-structure';

import { MAX_EXPORT_RESPONSES } from './raw-export-load';

/** 응답값·개인정보를 한 번에 묶어 읽는 응답 수 — `inArray` 바인드 파라미터 한계 안쪽. */
const ID_CHUNK = 2000;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type ResponseListLoadResult =
  | { kind: 'ok'; headers: string[]; rows: (string | number)[][] }
  | { kind: 'too_many'; total: number };

/**
 * 응답 내역 목록 엑셀의 재료 — **응답 내역 화면(`operations/profiles/page.tsx`)과 같은 함수들**로 같은
 * 열·같은 값을 만든다. 화면과 다른 것은 쪽을 나누지 않고 전부 읽는다는 것뿐이다(검색·필터 없음,
 * 화면 기본과 같은 순번 내림차순). 열 조립은 `lib/operations/response-list-sheet`.
 *
 * `maskPii`(게스트가 받는 파일)면 개인정보로 암호화해 저장하는 응답값 열과 명단의 개인정보 열을 가린다
 * (`lib/crypto/export-pii-mask` — 성명은 마지막 글자만). 화면은 그 값을 그대로 보이지만 파일은 밖으로
 * 나가는 사본이라 한 단계 더 가린다.
 */
export async function loadResponseListTable(
  surveyId: string,
  scope: OperationsDataScope,
  options: { maskPii: boolean },
): Promise<ResponseListLoadResult> {
  const [contactScheme, profileScheme, entryParamNames, answerSources, answerChoices] =
    await Promise.all([
      getContactColumnScheme(surveyId, scope),
      getProfileColumnScheme(surveyId),
      getProfileEntryParamNames(surveyId),
      getProfileAnswerSources(surveyId),
      getProfileAnswerChoices(surveyId),
    ]);
  const columns = visibleProfileColumns(
    hydrateProfileColumns(
      contactScheme,
      profileScheme,
      entryParamNames,
      new Set(answerSources.map((s) => s.key)),
    ),
  );

  const [{ rows, total }, questionRows, groups, { hasContacts }] = await Promise.all([
    listResponsesForProfiles({
      surveyId,
      scope,
      pageSize: MAX_EXPORT_RESPONSES,
      page: 1,
      status: 'all',
      sort: 'idx',
      dir: 'desc',
      view: 'active',
      clauses: [],
      answerChoices,
    }),
    db
      .select({
        id: questionsTable.id,
        order: questionsTable.order,
        title: questionsTable.title,
        type: questionsTable.type,
        groupId: questionsTable.groupId,
        questionCode: questionsTable.questionCode,
        pageBreakBefore: questionsTable.pageBreakBefore,
      })
      .from(questionsTable)
      .where(eq(questionsTable.surveyId, surveyId))
      .orderBy(asc(questionsTable.order), asc(questionsTable.id)),
    getQuestionGroupsBySurvey(surveyId),
    getSurveyContactStats(surveyId, scope),
  ]);
  if (total > MAX_EXPORT_RESPONSES) return { kind: 'too_many', total };

  const piiKeys = columns
    .filter((c) => c.key.startsWith('pii.'))
    .map((c) => c.key.slice('pii.'.length));
  const piiTargetIds = [
    ...new Set(rows.map((r) => r.contactTargetId).filter((id): id is string => id !== null)),
  ];
  const piiByTarget: Record<string, Record<string, string>> = {};
  if (piiKeys.length > 0) {
    for (const ids of chunks(piiTargetIds, ID_CHUNK)) {
      for (const [id, values] of await decryptPiiForTargets(ids, piiKeys)) piiByTarget[id] = values;
    }
  }

  const answerColumnKeys = columns.map((c) => c.key).filter((k) => answerKeyOf(k) !== null);
  const answerValues: Record<string, Record<string, string>> = {};
  // 저장값이 암호문이던 칸(응답 id → 열 key) — 지금은 개인정보 표시가 꺼진 열이라도 게스트 파일에서 가린다.
  const storedEncrypted = new Map<string, Set<string>>();
  if (answerColumnKeys.length > 0) {
    for (const ids of chunks(
      rows.map((r) => r.id),
      ID_CHUNK,
    )) {
      Object.assign(
        answerValues,
        await loadProfileAnswerValues(ids, answerColumnKeys, answerChoices, (responseId, key) => {
          const keys = storedEncrypted.get(responseId) ?? new Set<string>();
          keys.add(key);
          storedEncrypted.set(responseId, keys);
        }),
      );
    }
  }

  if (options.maskPii) {
    // 명단 개인정보 열 — 종류는 조사 대상 컬럼 스킴의 piiType.
    const piiTypeByKey = new Map(
      (contactScheme?.columns ?? [])
        .filter((c) => c.source.startsWith('pii.'))
        .map((c) => [c.source.slice('pii.'.length), c.piiType] as const),
    );
    for (const values of Object.values(piiByTarget)) {
      for (const key of Object.keys(values)) {
        values[key] = maskExportValue(values[key] ?? '', piiTypeByKey.get(key));
      }
    }
    // 응답값 열 — 지금 개인정보로 표시된 열이거나, 그 응답의 저장값이 암호문이던 칸(표시를 켠 채 받은
    // 답은 표시를 끈 뒤에도 암호문으로 남아 풀려 나온다). 형식을 모르는 글자라 마지막 글자 가리기.
    const encryptedAnswerKeys = new Set(answerSources.filter((s) => s.encrypted).map((s) => s.key));
    for (const [responseId, values] of Object.entries(answerValues)) {
      const stored = storedEncrypted.get(responseId);
      for (const key of Object.keys(values)) {
        if (encryptedAnswerKeys.has(key) || stored?.has(key)) {
          values[key] = maskExportValue(values[key] ?? '', undefined);
        }
      }
    }
  }

  const input: ResponseListSheetInput = {
    columns,
    rows,
    stepLocations: Object.fromEntries(buildStepLocationMap(questionRows, groups)),
    hasContacts,
    piiByTarget,
    answerValues,
  };
  return { kind: 'ok', ...buildResponseListTable(input) };
}
