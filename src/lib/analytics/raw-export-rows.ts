import type { RawExportContactColumn } from '@/lib/operations/contacts';
import { NOT_RESPONDED_STATUS } from '@/lib/operations/profiles';
import { stripDisabledCellValues } from '@/lib/survey/cell-gating';
import { omitDisabledPriorAnswers } from '@/lib/survey/prior-answer-condition';
import { stripHiddenQuestionValues } from '@/lib/survey/question-visibility';
import { OPT_TEXTS_KEY } from '@/lib/survey/response-sidecars';
import type { Question, QuestionGroup, SurveyLookup } from '@/types/survey';
import { responsesToLookupShape } from '@/utils/branch-eval';

import type { RawExportResponseRow } from './raw-workbook';

// ============================================================
// Raw 내보내기 — 조사 대상 기준 모수·명단 열의 순수 조각
// (미응답 행 생성 + 정렬 + 명단 값 조립. DB 조회는 raw-export-rows.server.ts)
// ============================================================

export interface NonRespondentTarget {
  id: string;
  resid: number;
  inviteCode: string | null;
}

/** 응답이 없는 조사 대상 → 미응답 행. 문항 열은 비고 응답 메타는 전부 null. */
export function buildNonRespondentRow(target: NonRespondentTarget): RawExportResponseRow {
  return {
    id: target.id,
    questionResponses: {},
    resid: target.resid,
    inviteCode: target.inviteCode,
    ipHash: null,
    currentStepId: null,
    platform: null,
    browser: null,
    status: NOT_RESPONDED_STATUS,
    startedAt: null,
    completedAt: null,
    totalSeconds: null,
  };
}

/**
 * 조사 대상 기준 모수의 정렬 — 시스템ID 오름차순, 같은 시스템ID(복수 응답 허용 설문)는
 * 시작일시 오름차순, 시스템ID 없는 익명 응답은 뒤에 시작일시 오름차순. 입력 배열은 건드리지 않는다.
 * 토글이 꺼진 경로는 이 함수를 부르지 않는다 — findMany 의 startedAt 순서가 그대로 파일 순서다.
 */
export function sortRowsForContactPopulation(
  rows: readonly RawExportResponseRow[],
): RawExportResponseRow[] {
  return [...rows].sort((a, b) => {
    if (a.resid != null && b.resid != null) {
      if (a.resid !== b.resid) return a.resid - b.resid;
    } else if (a.resid != null) {
      return -1;
    } else if (b.resid != null) {
      return 1;
    }
    return (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0);
  });
}

/**
 * 조사 대상 한 명의 명단 열 값 — 열 정의 순서대로 source → 값.
 * attrs 는 contact_targets.attrs 그대로, pii 는 복호화 평문. 스킴에 있으나 값이 없는 키는 ''.
 * 값이 전부 '' 여도 객체를 돌려준다 — 컨택이 있다는 뜻이다(익명 응답과 구분).
 */
export function buildContactValues(
  columns: readonly RawExportContactColumn[],
  attrs: Readonly<Record<string, string>>,
  piiPlain: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of columns) {
    out[col.source] = col.kind === 'attrs' ? (attrs[col.key] ?? '') : (piiPlain?.[col.key] ?? '');
  }
  return out;
}

/**
 * 한 행의 숨은 문항 판정에 필요한 재료 — 그 응답이 **수집된 버전**의 스냅샷 + 컨택 attrs.
 * 응답 페이지·제출·어드민 수정이 쓰는 평가 컨텍스트와 같은 재료다. 하나라도 빠지면
 * LUT·attrs·수식을 쓰는 조건이 여기서만 다르게 풀려 멀쩡한 답이 지워진다.
 */
export interface ExportStripContext {
  questions: Question[];
  groups?: QuestionGroup[] | undefined;
  lookups?: SurveyLookup[] | undefined;
  contactAttrs?: Record<string, string | undefined> | undefined;
}

/**
 * 숨은 문항 값 걸러내기 — 제출(completeResponse)도 어드민 수정도 안 거친 행이 rawdata 로
 * 나갈 때의 마지막 그물이다. 초안·구간 저장에는 strip 을 걸지 않으므로(AGENTS.md 주의사항
 * 14) 진행중·이탈 응답의 DB 값에는 숨은 문항 답이 남아 있다.
 *
 * **DB 는 건드리지 않는다.** 내보내는 값에서만 뺀다 — 되돌릴 수 있게 두려는 것이다.
 *
 * 순서는 저장 경계와 같다 — **숨은 문항 strip → 게이팅 strip**. 문항이 통째로 사라지면 그
 * 표의 셀 값도 함께 사라져 게이팅 판정의 입력이 달라지므로 순서를 바꾸면 안 된다. 저장
 * 경계의 세 번째 단계인 calc 재계산은 **일부러 뺐다** — 앞 둘은 값을 지우기만 하지만 calc 는
 * 저장된 적 없는 새 값을 써넣는다. 내보내기가 원본에 없던 숫자를 만들어내면 안 된다.
 *
 * **대상 선별은 호출부가 한다.** 컨텍스트가 없는 행은 원본 객체 그대로 통과시킨다.
 * 로더가 미완료 행에만 컨텍스트를 만들어 넘긴다 — 완료본은 제출 시점에 이미 정리됐고,
 * 스냅샷이 prune 된 버전은 판정 재료 자체가 없다. 그리고 컨텍스트는 **그 응답이 수집된
 * 버전**의 것이어야 한다. 최신 버전으로 판정하면 나중에 좁아진 조건이 이미 수집된 답을
 * 소급해 지운다 — 어드민 수정이 `migrating` 을 strip 대상에서 빼는 것과 같은 이유다.
 */
export function stripHiddenFromExportRows(
  rows: readonly RawExportResponseRow[],
  contextByRowId: ReadonlyMap<string, ExportStripContext>,
): RawExportResponseRow[] {
  return rows.map((row) => {
    const ctx = contextByRowId.get(row.id);
    if (!ctx) return row;
    const hiddenStripped = stripHiddenQuestionValues(
      ctx.questions,
      row.questionResponses,
      ctx.groups,
      {
        responses: responsesToLookupShape(row.questionResponses),
        contactAttrs: ctx.contactAttrs ?? {},
        lookups: ctx.lookups ?? [],
      },
    );
    const stripped = stripDisabledCellValues(ctx.questions, hiddenStripped);
    return stripped === row.questionResponses ? row : { ...row, questionResponses: stripped };
  });
}

/**
 * 이월 응답을 행에 합친다 — 「이월 응답 포함」 옵션.
 *
 * 규칙은 하나다: **이번 회차에 키가 있으면 이번 회차가 이긴다.** 값이 비어 있어도('' 등)
 * 그렇다 — 프리필된 이월값을 응답자가 일부러 지운 것을 내보내기가 되살리면 조사 결과가
 * 왜곡된다. 이월은 키 자체가 없는 문항만 채운다.
 *
 * 숨은 문항은 걸러내지 않는다 — 이번 조사표의 조건에 맞지 않는 문항의 지난 답도 그대로
 * 실린다(2026-09-10 결정, 다이얼로그 설명에 명시). 그래서 호출부는 이 함수를 숨은 문항
 * strip **뒤에** 부른다. 앞에 부르면 strip 이 이월값까지 지운다.
 *
 * 사이드카는 `__optTexts__`(보기 상세 기재)만, 문항 단위로 같은 규칙으로 합친다.
 * 변동 확인·동적 행 선택은 이번 회차의 행위 기록이라 이월에서 가져오지 않는다.
 *
 * @returns 바뀐 것이 없으면 원본 객체 그대로 (호출부 비교용)
 */
export function mergePriorAnswersIntoResponses(
  current: Record<string, unknown>,
  prior: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!prior) return current;
  let out: Record<string, unknown> | null = null;
  const ensure = () => (out ??= { ...current });

  for (const [key, value] of Object.entries(prior)) {
    if (key.startsWith('__')) continue;
    if (Object.prototype.hasOwnProperty.call(current, key)) continue;
    ensure()[key] = value;
  }

  const priorTexts = prior[OPT_TEXTS_KEY];
  if (priorTexts && typeof priorTexts === 'object' && !Array.isArray(priorTexts)) {
    const currentTexts = current[OPT_TEXTS_KEY];
    const base =
      currentTexts && typeof currentTexts === 'object' && !Array.isArray(currentTexts)
        ? (currentTexts as Record<string, unknown>)
        : {};
    let merged: Record<string, unknown> | null = null;
    for (const [questionId, texts] of Object.entries(priorTexts as Record<string, unknown>)) {
      if (Object.prototype.hasOwnProperty.call(base, questionId)) continue;
      (merged ??= { ...base })[questionId] = texts;
    }
    if (merged) ensure()[OPT_TEXTS_KEY] = merged;
  }

  return out ?? current;
}

/**
 * 「이월값 불러오기」를 끈 문항의 값을 조사 대상별 이월 응답에서 걷어낸다 — 병합 전에 한 번.
 *
 * 응답 화면이 그 문항에 이월값을 깔지 않듯 내보내기도 싣지 않는다(2026-09-10 결정). 스위치는
 * 응답과 무관한 정적 설정이라 응답 행·미응답 행을 가리지 않고 같은 판정이고, 판정 문항은
 * **현재 빌더 설정**이다 — 이건 응답 데이터가 아니라 "내보낼 때 무엇을 채울지"의 정책이다.
 * 문항별 이월값 **조건**(priorAnswerCondition)은 보지 않는다 — 스위치만 따르기로 했다.
 * 보기 상세기재 사이드카도 같은 문항 판정으로 함께 걷힌다(omitDisabledPriorAnswers).
 */
export function omitDisabledPriorAnswersByContact(
  priorByContactId: ReadonlyMap<string, Record<string, unknown>>,
  questions: readonly Question[],
): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const [contactId, prior] of priorByContactId) {
    out.set(contactId, omitDisabledPriorAnswers(prior, questions) ?? {});
  }
  return out;
}

/** 행 목록에 이월 응답을 합친다. 조사 대상이 없거나 이월이 없는 행은 그대로. */
export function mergePriorAnswersIntoRows(
  rows: readonly RawExportResponseRow[],
  priorByContactId: ReadonlyMap<string, Record<string, unknown>>,
  contactIdOfRow: (row: RawExportResponseRow) => string | null,
): RawExportResponseRow[] {
  return rows.map((row) => {
    const contactId = contactIdOfRow(row);
    const prior = contactId ? priorByContactId.get(contactId) : undefined;
    const merged = mergePriorAnswersIntoResponses(row.questionResponses, prior);
    return merged === row.questionResponses ? row : { ...row, questionResponses: merged };
  });
}
