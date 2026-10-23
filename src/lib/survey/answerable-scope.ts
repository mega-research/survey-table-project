import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import type { Question, QuestionGroup, SurveyLookup } from '@/types/survey';

import { createAnswerEvalCtx } from './answer-eval-ctx';
import { type AnswerPathSkip, stripUnreachedQuestionValues } from './answer-path';
import { stripDisabledCellValues } from './cell-gating';
import { resolveVisibleQuestionIds } from './question-visibility';

/**
 * 답할 수 있는 범위 (CONTEXT.md 「답할 수 있는 범위」) — 지금 답이 될 수 있는 문항·칸. 표시 조건상
 * 보이고, 경로 위에 있고, 게이팅으로 열린 것. 범위 밖 값은 답이 아니다.
 *
 * 응답 확정(완료 제출·빈 complete·관리자 수정)과 Raw 내보내기 마지막 그물이 이 판정을 같이 쓴다 —
 * 둘이 순서를 각자 조립하던 시절, 단계를 더할 때마다 두 곳을 같이 고쳤고 재료(명단 값)가 갈렸다.
 * 응답 확정은 이 결과 위에 계산 칸·사이드카·자격미달·암호화를 얹고, 내보내기는 이것만 쓴다.
 *
 * 순서가 계약이다: **숨은 문항 → 경로 밖 문항(둘을 고정점까지) → 게이팅으로 닫힌 칸.** 문항이
 * 통째로 사라지면 그 표의 셀 값도 함께 사라져 게이팅 판정의 입력이 달라진다. 게이팅이 지운 칸을
 * 조건으로 읽는 문항은 다시 판정하지 않는다(응답 화면과의 수렴은 별도 과제).
 *
 * 조건은 응답 화면과 같은 컨텍스트로 푼다 — 명단 값 위에 응답 인용값(`createAnswerEvalCtx`), 인용값은
 * 지울 때마다 지운 결과로 다시 계산한다. 명단 값은 응답 화면이 보는 것과 같아야 한다(개인정보 열 포함
 * — server/read-models/respondent-contact-attrs).
 *
 * 초안·구간 저장에는 쓰지 않는다 — 부분 패치라 조건이 참조하는 상류 답이 없어 멀쩡한 답을 지운다
 * (주의사항 14). server-only 의존 금지.
 */

/** 범위 판정 재료 — 그 응답이 수집된 버전의 구조 + 응답 화면과 같은 명단 값. */
export interface AnswerableScopeMaterial {
  questions: Question[];
  groups: QuestionGroup[];
  lookups: SurveyLookup[];
  /** 그 버전의 설정 — 문항 섞기가 켜져 있으면 경로를 믿지 않는다. */
  settings: { shuffleQuestions?: boolean | null } | null;
  contactAttrs: Record<string, string | undefined>;
}

export interface AnswerableScope {
  /** 범위 밖 값(숨은 문항·경로 밖 문항의 답과 사이드카 항목, 닫힌 칸)을 뺀 응답. 지울 것이 없으면 입력 참조. */
  responses: Record<string, unknown>;
  /**
   * 범위 안 문항 — 보이는 문항 ∩ 경로 위 문항. 경로를 확정할 수 없으면(문항 섞기·기록된 마지막
   * 페이지가 경로 밖, `pruneHidden: false`) 경로 조건은 빼고 보이는 문항. 계산 칸을 새로 채울 대상이다.
   */
  inScopeQuestionIds: ReadonlySet<string>;
  /** 경로 밖 판정을 건너뛴 사유. null 이면 경로를 확정해 적용했거나 숨은 값을 지우지 않았다(`pruneHidden: false`). */
  pathSkipped: AnswerPathSkip | null;
}

export interface AnswerableScopeOptions {
  /**
   * 응답 행에 기록된 마지막 페이지(`current_step_id`). 응답자 완료 제출·내보내기가 넘긴다 — 그 페이지가
   * 계산한 경로 밖이면 응답자가 시뮬레이션대로 걷지 않은 것이라 경로 밖 판정을 건너뛴다. 관리자
   * 수정은 넘기지 않는다(편집 화면은 첫 페이지부터 분기대로 걷는다).
   */
  lastStepId?: string | null | undefined;
  /**
   * false 면 표시 조건·경로로 숨은 값(숨은 문항·숨은 칸·경로 밖 문항)은 지우지 않는다 — 관리자 수정의
   * 구버전 응답 이관(migrating) 전용. 재배포로 새로 생기거나 좁혀진 조건·분기가 이미 수집된 답을 소급해
   * 지우면 안 된다. 게이팅으로 닫힌 칸은 그래도 지운다(같은 표 안의 구조 규칙이다).
   */
  pruneHidden?: boolean;
}

/**
 * 버전 스냅샷에서 범위 재료를 만든다. 스냅샷이 없거나 문항이 배열이 아니면 null — 「구조가 깨졌다」를
 * 「질문이 없다」와 가르기 위해서다(호출자는 판정을 건너뛴다). 그룹·LUT 은 배열이 아니면 빈 배열.
 */
export function scopeMaterialFromSnapshot(
  snapshot: SurveyVersionSnapshot | null | undefined,
  contactAttrs: Record<string, string | undefined>,
): AnswerableScopeMaterial | null {
  if (!snapshot || !Array.isArray(snapshot.questions)) return null;
  const settings = snapshot.settings as unknown;
  return {
    questions: snapshot.questions as unknown as Question[],
    groups: Array.isArray(snapshot.groups) ? (snapshot.groups as QuestionGroup[]) : [],
    lookups: Array.isArray(snapshot.lookups) ? snapshot.lookups : [],
    settings:
      settings && typeof settings === 'object'
        ? (settings as AnswerableScopeMaterial['settings'])
        : null,
    contactAttrs,
  };
}

/** 응답을 답할 수 있는 범위로 좁힌다. 원본은 변형하지 않는다. */
export function pruneToAnswerableScope(
  material: AnswerableScopeMaterial,
  responses: Record<string, unknown>,
  options: AnswerableScopeOptions = {},
): AnswerableScope {
  const { questions, groups, lookups, contactAttrs, settings } = material;
  const evalCtx = createAnswerEvalCtx({ questions, contactAttrs, lookups });

  if (options.pruneHidden === false) {
    return {
      responses: stripDisabledCellValues(questions, responses),
      inScopeQuestionIds: resolveVisibleQuestionIds(questions, responses, groups, evalCtx),
      pathSkipped: null,
    };
  }

  const reached = stripUnreachedQuestionValues(questions, responses, groups, evalCtx, {
    settings,
    lastStepId: options.lastStepId,
  });
  return {
    responses: stripDisabledCellValues(questions, reached.responses),
    inScopeQuestionIds: reached.inScopeQuestionIds,
    pathSkipped: reached.pathSkipped,
  };
}
