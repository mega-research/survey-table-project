import { analyzeQuestion } from '@/lib/analytics/analyzer';
import { resolveJudgementShape } from '@/lib/survey/judgement-item';
import type { SurveyResponse } from '@/db/schema';
import type { Question, QuestionGroup } from '@/types/survey';

export { resolveJudgementShape };

/**
 * 문항 수요조사 집계 — 순수 계산부.
 *
 * **문항 하나가 표의 한 줄이다.** 기존 분석은 질문 하나당 카드 하나를 세로로
 * 쌓는데, 조사표 83문항이면 카드가 83개 쌓이고 정작 "무엇을 뺄까"를 못 고른다.
 * 그래서 이 티켓은 집계 로직이 아니라 **모양**의 문제였다.
 *
 * 그룹은 **소계 행을 만들지 않는다** — 구분면·접기·필터 축으로만 쓴다.
 * 블록째 묻고 싶으면 기획자가 "이 영역 전체가 필요한가" 질문을 하나 만들면 되고,
 * 그건 신설이 없다.
 */

/** 응답의 옵션 텍스트 사이드카 예약 키. **실존 질문 id 가 아니다.** */
const OPTION_TEXTS_KEY = '__optTexts__';

export interface DemandSummaryRow {
  questionId: string;
  questionCode: string | null;
  title: string;
  groupId: string | null;
  groupName: string | null;
  /** 조사표 순서 — 정렬을 풀었을 때 돌아갈 자리. */
  order: number;
  /** 3지선다 radio 가 아니면 전부 null — 비율 칸을 비운다. */
  needCount: number | null;
  dropCount: number | null;
  /** 0~100. 분모는 이 문항에 실제로 답한 사람 수(의견은 서술이 있을 때만 센다). */
  needRate: number | null;
  /** 서술이 있는 의견의 수. 3지선다가 아니면 0. */
  opinionCount: number;
  /** 의견 전문 — 행을 펼치면 그 자리에서 읽는다. 별도 화면을 만들지 않는다. */
  opinions: string[];
}

/**
 * 집계에 필요한 응답 한 건. 통계 기준은 **JSONB 원본**이다(정규화 응답 테이블이 아니다).
 * 필요 n·불필요 n 은 기존 분석 모듈(`analyzeQuestion`)의 단일선택 분포를 그대로 쓰므로
 * 그 모듈이 요구하는 모양을 그대로 받는다.
 */
export type DemandResponseInput = SurveyResponse;

/**
 * 응답 하나에서 그 문항의 의견 서술을 읽는다.
 *
 * 값은 질문 답과 **형제로 놓인 예약 키**(`__optTexts__`) 아래에 있고 실존 질문
 * id 가 아니다. 질문 id 로 순회하는 집계가 이 값을 조용히 건너뛰거나 예외를
 * 던지는 것이 이 형식의 알려진 지뢰라 여기서 한 번 분기한다.
 */
function readOpinionText(
  response: { questionResponses: unknown },
  questionId: string,
  optionId: string,
): string | null {
  const responses = response.questionResponses as Record<string, unknown> | null;
  const sidecar = responses?.[OPTION_TEXTS_KEY];
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) return null;
  const byQuestion = (sidecar as Record<string, unknown>)[questionId];
  if (!byQuestion || typeof byQuestion !== 'object' || Array.isArray(byQuestion)) return null;
  const text = (byQuestion as Record<string, unknown>)[optionId];
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 문항 한 줄짜리 집계표를 만든다. 순서는 조사표 순서(그룹 순서 → 그룹 안 문항 순서).
 */
export function buildDemandSummary(
  questions: readonly Question[],
  groups: readonly QuestionGroup[],
  responses: readonly DemandResponseInput[],
): DemandSummaryRow[] {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupRank = new Map(
    [...groups]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((g, index) => [g.id, index]),
  );

  const ordered = [...questions].sort((a, b) => {
    const ra = a.groupId ? (groupRank.get(a.groupId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const rb = b.groupId ? (groupRank.get(b.groupId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    return ra - rb || a.order - b.order || a.id.localeCompare(b.id);
  });

  return ordered.map((question, index) => {
    const group = question.groupId ? groupById.get(question.groupId) : undefined;
    const base = {
      questionId: question.id,
      questionCode: question.questionCode ?? null,
      title: question.title,
      groupId: group?.id ?? null,
      groupName: group?.name ?? null,
      order: index,
    };

    const shape = resolveJudgementShape(question);
    if (!shape) {
      // 3지선다 radio 가 아니거나 어느 쪽이 '필요함'인지 가릴 수 없는 문항 —
      // 행은 남기고 비율 칸을 비운다. 계산되지 않는 값을 0 으로 채우면
      // "아무도 필요하다고 안 했다"로 오해하고, 추측한 값은 반대로 읽힌다.
      return { ...base, needCount: null, dropCount: null, needRate: null, opinionCount: 0, opinions: [] };
    }

    // 필요 n·불필요 n 은 새로 세지 않는다 — 기존 분석 모듈의 단일선택 분포가
    // 이미 내는 값이다. 노출 필터(exposedQuestionIds)도 그쪽 규칙을 그대로 따른다.
    const analytics = analyzeQuestion(question, responses as SurveyResponse[]);
    const countOf = (value: string) =>
      analytics.type === 'single'
        ? (analytics.distribution.find((d) => d.value === value)?.count ?? 0)
        : 0;
    const needCount = countOf(shape.needValue);
    const dropCount = countOf(shape.dropValue);

    // 의견만 여기서 센다. 서술은 사이드카에 있어 분석 모듈이 볼 수 없고,
    // 서술이 비면 답으로 치지 않는다는 규칙도 이 형식 고유다.
    const opinions: string[] = [];
    for (const response of responses) {
      const answer = (response.questionResponses as Record<string, unknown>)[question.id];
      if (answer !== shape.opinionValue) continue;
      const text = readOpinionText(response, question.id, shape.opinionOptionId);
      if (text) opinions.push(text);
    }

    const answered = needCount + dropCount + opinions.length;
    return {
      ...base,
      needCount,
      dropCount,
      needRate: answered > 0 ? (needCount / answered) * 100 : null,
      opinionCount: opinions.length,
      opinions,
    };
  });
}

/**
 * 화면이 지금 보여주는 상태. 엑셀이 같은 표를 내려면 같은 값을 받아야 한다.
 */
export type DemandSortMode = 'sheet' | 'need-asc' | 'need-desc';

export interface DemandView {
  sort: DemandSortMode;
  /** null = 전체 그룹. */
  groupId: string | null;
}

/** 문자열 하나를 정렬 모드로. 모르는 값은 조사표 순서로 떨어진다. */
export function parseDemandSortMode(raw: string | null | undefined): DemandSortMode {
  return raw === 'need-asc' || raw === 'need-desc' ? raw : 'sheet';
}

/**
 * 필터 + 정렬을 한 번에. **화면과 엑셀이 이 함수 하나를 공유한다** — 정렬을 양쪽에
 * 따로 적으면 한쪽만 바뀌었을 때 "화면과 다른 파일"이 조용히 나온다.
 */
export function applyDemandView(
  rows: readonly DemandSummaryRow[],
  view: DemandView,
): DemandSummaryRow[] {
  const filtered = view.groupId ? rows.filter((row) => row.groupId === view.groupId) : rows;
  if (view.sort === 'sheet') return [...filtered].sort((a, b) => a.order - b.order);
  return sortByNeedRate(filtered, view.sort === 'need-asc' ? 'asc' : 'desc');
}

/** 필요율 정렬. 비율이 없는 행(3지선다가 아닌 문항)은 언제나 뒤로 밀린다. */
export function sortByNeedRate(
  rows: readonly DemandSummaryRow[],
  direction: 'asc' | 'desc' = 'asc',
): DemandSummaryRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.needRate === null && b.needRate === null) return a.order - b.order;
    if (a.needRate === null) return 1;
    if (b.needRate === null) return -1;
    return sign * (a.needRate - b.needRate) || a.order - b.order;
  });
}
