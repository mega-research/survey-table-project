/**
 * 관리자 응답 수정(admin-edit) 전용 — "빈 필수" 완화 판정 순수 로직.
 *
 * 배경: 관리자 수정 화면이 최신 배포 버전 형식으로 렌더되면서, 구버전 응답에는
 * 신규 필수 셀이 비어있는 채로 남는다(버전 이관 시 구조 생존 프리필이 다른 구조는
 * 비운다). 관리자는 그 값을 알 수 없어 채울 수 없으므로, "다음"/제출을 영구히
 * 막으면 수정 자체가 불가능해진다(v80/81 141건 실측 — 2026-08-13 재결정).
 *
 * 완화 대상은 "필수인데 비어있음"(kind: required-cells | required-detail)뿐이다.
 * 값이 들어간 칸의 차단형 검증(kind: range | sum | formula)은 admin-edit 에서도
 * 계속 차단한다 — 완화가 잘못된 값의 저장을 허용해서는 안 된다.
 *
 * 응답자/미리보기/테스트 흐름은 이 모듈을 전혀 참조하지 않는다(무변경 보장).
 */
import type { NumericIssue } from './numeric-validation';

/** 이슈 kind → "빈 필수"(완화 대상) 여부. range/sum/formula 는 차단형(완화 불가). */
export function isRelaxableRequiredIssueKind(kind: NumericIssue['kind']): boolean {
  return kind === 'required-cells' || kind === 'required-detail';
}

export interface StepRelaxClassification {
  /** 값이 들어간 칸의 범위/합계/수식 위반 존재 여부 — 참이면 admin-edit 에서도 항상 차단. */
  hasBlockingIssue: boolean;
  /** 완화 가능한 "빈 필수" 개수 (질문 단위 미응답 + 셀/상세 단위 누락 합산). */
  emptyRequiredCount: number;
}

/**
 * 한 스텝(페이지)의 두 검증 신호 —
 * (1) 질문 단위 미응답 질문 id 목록(question.required && !isQuestionAnswered — 테이블은
 *     응답 자체가 전무한 경우, 비-테이블은 상세기입 누락도 포함해 이미 미응답으로 잡힘),
 * (2) collectNumericIssues 가 질문별로 반환한 셀/합계/범위/수식 이슈 —
 * 를 "차단형" vs "빈 필수(완화 대상)"로 분류한다.
 *
 * 비-테이블 질문(radio/checkbox/text 등)의 상세기입 누락은 (1)과 (2) 양쪽에서 동시에
 * 잡힌다 — isQuestionAnswered 자체가 collectRequiredOptionTextIssues.questionMissing 을
 * 이미 반영하기 때문이다(survey-response-flow.tsx 의 isQuestionAnswered 콜백 참고).
 * 같은 질문이 두 신호 모두에 잡히면 이중 계산되지 않도록, 이미 (1)에 포함된 질문의
 * (2) 쪽 완화 카운트는 건너뛴다(질문별 Map 인자로 매칭). hasBlockingIssue 는 질문
 * 매칭과 무관하게 항상 스캔한다.
 *
 * hasBlockingIssue 가 true 면 emptyRequiredCount 값과 무관하게 완화 불가 — 호출부는
 * 항상 기존 차단 동작을 그대로 유지해야 한다.
 */
export function classifyStepIssues(
  unansweredQuestionIds: readonly string[],
  numericIssuesByQuestion: ReadonlyMap<string, readonly NumericIssue[]>,
): StepRelaxClassification {
  const unansweredSet = new Set(unansweredQuestionIds);
  let hasBlockingIssue = false;
  let relaxableCount = unansweredSet.size;
  for (const [questionId, issues] of numericIssuesByQuestion) {
    for (const issue of issues) {
      if (!isRelaxableRequiredIssueKind(issue.kind)) {
        hasBlockingIssue = true;
        continue;
      }
      if (unansweredSet.has(questionId)) continue; // (1)에서 이미 집계된 질문 — 중복 방지
      relaxableCount += issue.cellIds?.length ?? 1;
    }
  }
  return { hasBlockingIssue, emptyRequiredCount: relaxableCount };
}

/**
 * 스텝의 질문 응답값 스냅샷 — "같은 페이지에서 값이 그대로인 채 재클릭했는가"를
 * 판정하기 위한 안정적 지문. 키 순서(질문 목록 순회 순서)에 흔들리지 않도록
 * questionId 기준 정렬 후 직렬화한다. 스텝 이동·값 변경 시 자연히 다른 문자열이
 * 나오므로 "경고 상태 리셋"은 별도 클리어 로직 없이 이 스냅샷 불일치로 성립한다.
 */
export function snapshotStepResponses(
  questionIds: readonly string[],
  responses: Record<string, unknown>,
): string {
  return JSON.stringify(
    [...questionIds].sort().map((id) => [id, responses[id]]),
  );
}

/** admin-edit 경고 배너 문구. */
export function buildAdminEmptyRequiredWarningMessage(count: number): string {
  return `빈 필수 응답 ${count}개 — '다음 →' 한 번 더 누르면 그대로 넘어갑니다`;
}
