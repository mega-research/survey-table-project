import { analyzeQuestion } from '@/lib/analytics/analyzer';
import type { SurveyResponse } from '@/db/schema';
import type { Question, QuestionGroup } from '@/types/survey';

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
 * 판단 항목의 세 선택지. 전용 질문 유형이 없으므로 **모양으로 판정한다** —
 * 선택지가 정확히 셋이고 그중 정확히 하나가 기타입력(의견)인 단일선택.
 *
 * 척도·장문형이 섞여 있어도 표에서 빼지 않는다. 행은 남기고 비율 칸만 비운다 —
 * 조사표 순서가 끊기면 어디를 보는지 잃는다.
 */
interface JudgementShape {
  needValue: string;
  dropValue: string;
  opinionValue: string;
  opinionOptionId: string;
}

export function resolveJudgementShape(question: Question): JudgementShape | null {
  if (question.type !== 'radio') return null;
  const options = question.options ?? [];
  if (options.length !== 3) return null;
  const opinions = options.filter((o) => o.allowTextInput);
  if (opinions.length !== 1) return null;
  const opinion = opinions[0];
  const rest = options.filter((o) => !o.allowTextInput);
  const need = rest[0];
  const drop = rest[1];
  if (!opinion || !need || !drop) return null;
  return {
    needValue: need.value,
    dropValue: drop.value,
    opinionValue: opinion.value,
    opinionOptionId: opinion.id,
  };
}

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
      // 3지선다 radio 가 아닌 문항 — 행은 남기고 비율 칸을 비운다.
      // 계산되지 않는 값을 0 으로 채우면 "아무도 필요하다고 안 했다"로 오해한다.
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
