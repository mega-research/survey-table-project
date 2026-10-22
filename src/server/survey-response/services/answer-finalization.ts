import 'server-only';

import { encryptResponsesForStorage, hasPiiTargets, type PiiTargets } from '@/lib/crypto/response-pii';
import { logger } from '@/lib/logger';
import { stripUnreachedQuestionValues } from '@/lib/survey/answer-path';
import { withCalcValues } from '@/lib/survey/cell-formula';
import { stripDisabledCellValues } from '@/lib/survey/cell-gating';
import { resolveVisibleQuestionIds } from '@/lib/survey/question-visibility';
import { sanitizeRootSidecar, splitRootSidecars } from '@/lib/survey/response-sidecars';
import { loadRespondentContactAttrs } from '@/server/read-models/respondent-contact-attrs';
import {
  loadVersionSnapshot,
  snapshotLookups,
  snapshotQuestions,
} from '@/server/read-models/version-snapshot';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import type { Question, QuestionGroup, SurveyLookup } from '@/types/survey';
import { type BranchEvalCtx, responsesToLookupShape } from '@/utils/branch-eval';

import { detectScreenOut } from '../domain/screen-out';
import { loadPiiTargets } from './submitted-answers';

/**
 * 응답 확정 (CONTEXT.md 「응답 확정」) — 완료 제출·관리자 응답 수정이 저장 직전에 최종 평문과
 * 저장값을 만드는 한 곳.
 *
 * 순서가 계약이다: 숨은 문항 strip → 경로 밖 strip(둘을 고정점까지) → 게이팅 strip → calc 재계산
 * → 등록 사이드카만 → 자격미달 판정 → 암호화. 문항이 통째로 사라지면 그 표의 셀 값도 함께
 * 사라져 게이팅 판정의 입력이 달라지고, 수식은 지워진 값 기준으로 계산해야 한다. 판정은 암호화
 * 이전 평문이어야 분기 매칭이 성립한다.
 *
 * 경로 밖 strip(lib/survey/answer-path)은 분기 이동(goto·end)으로 건너뛴 페이지의 답을 지운다 —
 * 남겨 두면 건너뛴 페이지의 자격미달 보기가 정상 완료를 자격미달로 뒤집는다. 경로를 확정할 수
 * 없으면(문항 섞기·인용값을 읽는 조건·기록된 마지막 페이지가 경로 밖) 건너뛴다. calc 은 남은
 * 문항(표시 + 경로 위)에만 새로 채운다 — 가 보지 않은 표에 계산값이 들어가 답한 것처럼 보이지 않게.
 *
 * 세 단계는 설문 구성과 무관하게 늘 돈다 — 계산 칸·게이팅 칸 유무로 건너뛰던 시절에 표시
 * 조건만 있는 설문의 빈 complete 가 숨은 값을 남겼다. 각 단계는 할 일이 없으면 받은 객체를
 * 그대로 돌려주므로 비용이 없고, 그 참조 비교가 곧 `changed` 다.
 *
 * 초안·구간 저장은 거치지 않는다 — 그쪽 answers 는 더티 키만 담은 부분 패치라 조건이 참조하는
 * 상류 문항이 없어 멀쩡한 답을 지운다(주의사항 14).
 */

/** 확정 재료. 호출자는 `snapshot` 만 읽는다(변경 이력 제목 등) — 나머지는 확정 전용이다. */
export interface FinalizationMaterial {
  /** 응답 시점 버전 스냅샷. 없으면(레거시 versionId null·prune) 확정 단계를 건너뛴다. */
  readonly snapshot: SurveyVersionSnapshot | null;
  readonly questions: Question[];
  readonly groups: QuestionGroup[];
  readonly lookups: SurveyLookup[];
  readonly contactAttrs: Record<string, string | undefined>;
  readonly piiTargets: PiiTargets;
  readonly responseId: string;
}

export interface AnswerFinalization {
  /** 확정 평문 — 쿼터 분류·응답 정규화 저장(response_answers)의 재료. */
  plain: Record<string, unknown>;
  /** question_responses 에 그대로 쓸 값(개인정보 문항·셀 암호화). 크기 정책은 호출자 몫이다. */
  stored: Record<string, unknown>;
  /** 확정이 받은 평문을 바꿨는가. 빈 complete 는 이것이 참일 때만 다시 쓴다. */
  changed: boolean;
  /** 자격미달 판정. 스냅샷 질문이 없으면 판정 불능이라 null — 호출자는 기존 상태를 보존한다. */
  screenedOut: boolean | null;
}

/**
 * 확정 재료를 읽는다. 잠금 밖에서 부른다 — 빈 complete 는 응답 행 잠금 아래에서 확정하므로,
 * 여기서 읽어 두지 않으면 잠금을 쥔 채 스냅샷을 읽게 된다.
 *
 * 암호화 대상은 스냅샷이 없어도 읽는다(레거시는 라이브 questions 로 폴백). 명단 값은 스냅샷이
 * 있을 때만 — 쓰는 곳이 표시 조건·수식 평가뿐이다. 응답 화면과 같은 명단 값(개인정보 열 포함)을
 * 넘겨야 LUT·명단 값을 읽는 조건이 서버에서만 다르게 풀리지 않는다.
 */
export async function loadFinalizationMaterial(input: {
  surveyId: string;
  versionId: string | null;
  contactTargetId: string | null;
  responseId: string;
}): Promise<FinalizationMaterial> {
  const [snapshot, piiTargets] = await Promise.all([
    loadVersionSnapshot(input.versionId),
    loadPiiTargets(input.versionId, input.surveyId),
  ]);
  const contactAttrs =
    snapshot && input.contactTargetId
      ? await loadRespondentContactAttrs(input.contactTargetId)
      : {};
  return {
    snapshot,
    // JSONB 드리프트 방어 — 비배열이면 순회에서 크래시해 저장 전체가 실패한다.
    questions: snapshotQuestions(snapshot),
    groups: Array.isArray(snapshot?.groups) ? (snapshot.groups as QuestionGroup[]) : [],
    lookups: snapshotLookups(snapshot),
    contactAttrs,
    piiTargets,
    responseId: input.responseId,
  };
}

/** 평문 응답을 확정한다. 동기 — 응답 행 잠금 아래에서도 부를 수 있다. */
export function finalizeAnswers(
  material: FinalizationMaterial,
  plain: Record<string, unknown>,
  options: {
    /**
     * 숨은 문항 strip 생략 — 관리자 수정의 구버전 응답 이관(migrating) 전용. 재배포로 새로 생기거나
     * 좁혀진 표시 조건이 이미 수집된 답을 소급해 지우면 안 된다. 경로 밖 strip 도 함께 생략한다 —
     * 같은 이유로 재배포가 바꾼 분기가 이미 수집된 답을 지우면 안 된다.
     */
    skipHiddenStrip?: boolean;
    /**
     * 응답 행에 기록된 마지막 페이지(`current_step_id`). 응답자 완료 제출이 넘긴다 — 그 페이지가
     * 계산한 경로 밖이면 응답자가 시뮬레이션대로 걷지 않은 것이라 경로 밖 strip 을 건너뛴다.
     * 관리자 수정은 넘기지 않는다(편집 화면은 첫 페이지부터 분기대로 걷는다).
     */
    lastStepId?: string | null;
  } = {},
): AnswerFinalization {
  const { questions, groups, lookups, contactAttrs } = material;
  const evalCtx = (responses: Record<string, unknown>): BranchEvalCtx => ({
    responses: responsesToLookupShape(responses),
    contactAttrs,
    lookups,
  });

  let current = plain;
  // 스냅샷이 없으면 확정 단계를 건너뛴다 — 응답자·운영자의 저장을 막지 않는 fail-safe.
  if (material.snapshot) {
    let reachedQuestionIds: ReadonlySet<string>;
    if (options.skipHiddenStrip) {
      // 이관은 아무것도 지우지 않는다. 계산값은 표시되는 문항에만 새로 채운다(값이 남은 문항은
      // withCalcValues 가 다시 계산한다).
      reachedQuestionIds = resolveVisibleQuestionIds(questions, current, groups, evalCtx(current));
    } else {
      const reached = stripUnreachedQuestionValues(questions, current, groups, evalCtx(current), {
        settings: material.snapshot.settings,
        lastStepId: options.lastStepId,
      });
      current = reached.responses;
      reachedQuestionIds = reached.reachedQuestionIds;
    }
    current = stripDisabledCellValues(questions, current);
    current = withCalcValues(
      current,
      { questions, responses: current, lookups, contactAttrs },
      { reachedQuestionIds },
    );
  }
  current = keepRegisteredSidecars(current, material);

  const screenedOut =
    questions.length > 0
      ? detectScreenOut(questions, current, { groups, evalCtx: evalCtx(current) })
      : null;

  return {
    plain: current,
    stored: hasPiiTargets(material.piiTargets)
      ? encryptResponsesForStorage(current, material.piiTargets)
      : current,
    changed: current !== plain,
    screenedOut,
  };
}

/**
 * 등록된 루트 사이드카만 남긴다(주의사항 13). 정제 결과가 비면 넣지 않는다 — 완료 저장의 기존
 * 동작이다. 스냅샷이 있으면 그 문항의 항목만 남긴다.
 *
 * 바뀐 것이 없으면 받은 객체를 그대로 돌려준다 — `changed` 판정이 참조 비교라서다.
 */
function keepRegisteredSidecars(
  responses: Record<string, unknown>,
  material: FinalizationMaterial,
): Record<string, unknown> {
  const { sidecarEntries, unknownSidecarKeys } = splitRootSidecars(Object.entries(responses));
  if (sidecarEntries.length === 0 && unknownSidecarKeys.length === 0) return responses;

  if (unknownSidecarKeys.length > 0) {
    logger.warn(
      { responseId: material.responseId, keys: unknownSidecarKeys },
      '[answer-finalization] 등록되지 않은 루트 사이드카 키 — 저장에서 제외',
    );
  }

  const knownIds = material.snapshot ? new Set(material.questions.map((q) => q.id)) : null;
  const isKnownQuestionId = knownIds ? (id: string) => knownIds.has(id) : undefined;

  let out: Record<string, unknown> | null = null;
  const edit = () => (out ??= { ...responses });
  for (const key of unknownSidecarKeys) delete edit()[key];
  for (const [key, raw] of sidecarEntries) {
    const kept = sanitizeRootSidecar(key, raw, isKnownQuestionId);
    if (!kept || Object.keys(kept).length === 0) {
      delete edit()[key];
    } else if (JSON.stringify(kept) !== JSON.stringify(raw)) {
      edit()[key] = kept;
    }
  }
  return out ?? responses;
}
