import { analyzeQuestion } from '@/lib/analytics/analyzer';
import { buildRenderSteps } from '@/lib/group-ordering';
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
  /**
   * 답은 했으나 **해석하지 못한** 응답 수.
   *
   * 그 응답이 쓰인 버전에서 이 문항이 판단 항목이 아니었거나(선택지가 달랐거나),
   * 그 버전 스냅샷이 보존 정책으로 정리돼 없을 때다. 분자·분모 어디에도 넣지
   * 않는다 — 대신 여기 세어서 조용히 사라지지 않게 한다.
   */
  uncountedCount: number;
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
 * 응답의 버전에서 그 문항이 어떤 모양이었는지 되찾는다. 없으면 null.
 *
 * **누적 보고서의 핵심이다.** 완료 응답은 재배포 뒤에도 자기 버전에 고정되므로
 * (ADR 0014), 지금 스냅샷의 선택지로 옛 답을 읽으면 0건이 되거나 반대 의미로
 * 집계된다. 그래서 각 응답을 **그 응답이 쓰인 버전의 언어로** 읽는다.
 * 문항 id 는 버전 간 안정적이라 같은 문항을 잇는 기준이 된다.
 */
export type QuestionAsOf = (
  versionId: string | null,
  questionId: string,
) => Question | null;

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
 *
 * **누적 보고서다.** 행은 지금 배포판의 문항이 정하고, 각 응답은 자기 버전의 문항
 * 모양으로 읽어 합친다. 읽지 못한 응답은 버리지 않고 `uncountedCount` 로 센다.
 */
export function buildDemandSummary(
  questions: readonly Question[],
  groups: readonly QuestionGroup[],
  responses: readonly DemandResponseInput[],
  questionAsOf: QuestionAsOf,
): DemandSummaryRow[] {
  const groupById = new Map(groups.map((g) => [g.id, g]));

  // 조사표 순서의 주인은 group-ordering 이다. 그룹 order 는 형제 범위 값이라
  // 전역 정렬하면 하위그룹이 엉뚱한 자리로 간다 — 조사표 목록에서 이미 같은 실수를
  // 했고, 표와 엑셀의 행 순서가 응답 화면과 갈리는 것이 그 대가다.
  const ordered = buildRenderSteps([...questions], [...groups]).flatMap((step) =>
    step.items.map((item) => item.question),
  );

  // 응답을 자기 버전끼리 모은다. 문항과 무관한 분류라 한 번만 한다.
  const byVersion = new Map<string | null, DemandResponseInput[]>();
  for (const response of responses) {
    const key = response.versionId ?? null;
    const bucket = byVersion.get(key);
    if (bucket) bucket.push(response);
    else byVersion.set(key, [response]);
  }

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

    if (!resolveJudgementShape(question)) {
      // 지금 배포판에서 3지선다 radio 가 아니거나 어느 쪽이 '필요함'인지 가릴 수 없는
      // 문항 — 행은 남기고 비율 칸을 비운다. 계산되지 않는 값을 0 으로 채우면
      // "아무도 필요하다고 안 했다"로 오해하고, 추측한 값은 반대로 읽힌다.
      return {
        ...base,
        needCount: null,
        dropCount: null,
        needRate: null,
        opinionCount: 0,
        opinions: [],
        uncountedCount: 0,
      };
    }

    let needCount = 0;
    let dropCount = 0;
    let uncountedCount = 0;
    const opinions: string[] = [];

    // 각 묶음은 **그 버전의 문항 모양**으로 읽는다.
    for (const [versionId, bucket] of byVersion) {
      const asOf = questionAsOf(versionId, question.id);
      const shape = asOf ? resolveJudgementShape(asOf) : null;
      if (!asOf || !shape) {
        // 그 버전에 이 문항이 없었거나 판단 항목이 아니었거나, 스냅샷이 정리됐다.
        // 답이 있는 것만 센다 — 애초에 답하지 않은 응답은 셀 것이 없다.
        uncountedCount += bucket.filter((response) => {
          const value = (response.questionResponses as Record<string, unknown>)[question.id];
          return value !== undefined && value !== null && value !== '';
        }).length;
        continue;
      }

      // 필요 n·불필요 n 은 새로 세지 않는다 — 기존 분석 모듈의 단일선택 분포가
      // 이미 내는 값이다. 노출 필터(exposedQuestionIds)도 그쪽 규칙을 그대로 따른다.
      const analytics = analyzeQuestion(asOf, bucket);
      const countOf = (value: string) =>
        analytics.type === 'single'
          ? (analytics.distribution.find((d) => d.value === value)?.count ?? 0)
          : 0;
      needCount += countOf(shape.needValue);
      dropCount += countOf(shape.dropValue);

      // 의견만 여기서 센다. 서술은 사이드카에 있어 분석 모듈이 볼 수 없고,
      // 서술이 비면 답으로 치지 않는다는 규칙도 이 형식 고유다.
      for (const response of bucket) {
        const answer = (response.questionResponses as Record<string, unknown>)[question.id];
        if (answer !== shape.opinionValue) continue;
        const text = readOpinionText(response, question.id, shape.opinionOptionId);
        if (text) opinions.push(text);
      }
    }

    const answered = needCount + dropCount + opinions.length;
    return {
      ...base,
      needCount,
      dropCount,
      needRate: answered > 0 ? (needCount / answered) * 100 : null,
      opinionCount: opinions.length,
      opinions,
      uncountedCount,
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
