import type { SurveyDiffPayload } from '@/features/survey-builder/domain/survey-save';
import {
  changesetHasChanges,
  type QuestionChangeset,
} from '@/lib/survey-builder/changeset';
import type { Survey } from '@/types/survey';

/**
 * changeset snapshot + 현재 설문 상태 → SurveyDiffPayload 변환의 단일 거처.
 *
 * payload 조립 지식 — 어떤 store 상태가 어떤 payload 필드가 되는가(메타데이터 조건부
 * 필드 생략 규칙, contactEmail null 폴백, dirtyIds = added∪updated 로 현재 질문 필터,
 * deleted 는 키 목록, reordered 시 전체 질문 id 순서) — 는 이 모듈이 소유한다.
 * use-survey-sync 는 저장 시점 오케스트레이션(스냅샷·재시도·캐시 무효화)만 담당한다.
 *
 * 순수 함수: 입력을 변형하지 않는다. 보낼 변경이 전혀 없으면 null.
 */
export function buildSurveyDiffPayload(
  survey: Survey,
  snapshot: { questionChanges: QuestionChangeset; isMetadataDirty: boolean },
): SurveyDiffPayload | null {
  const { questionChanges: qc, isMetadataDirty } = snapshot;
  const hasQuestionChanges = changesetHasChanges(qc);

  // 변경분이 전혀 없으면 보낼 payload 없음
  if (!isMetadataDirty && !hasQuestionChanges) {
    return null;
  }

  const payload: SurveyDiffPayload = { surveyId: survey.id };

  if (isMetadataDirty) {
    payload.metadata = {
      title: survey.title,
      ...(survey.description !== undefined ? { description: survey.description } : {}),
      ...(survey.slug !== undefined ? { slug: survey.slug } : {}),
      ...(survey.privateToken !== undefined ? { privateToken: survey.privateToken } : {}),
      contactEmail: survey.contactEmail ?? null,
      settings: survey.settings,
      thankYouMessage: survey.settings.thankYouMessage,
    };
    if (survey.groups !== undefined) {
      payload.groups = survey.groups;
    }
  }

  if (hasQuestionChanges) {
    // added∪updated 중 현재 질문 목록에 실재하는 것만 전송 (저장 전 삭제된 dirty id 는 자연 탈락)
    const dirtyIds = new Set([...Object.keys(qc.added), ...Object.keys(qc.updated)]);
    const upserted = survey.questions.filter((q) => dirtyIds.has(q.id));

    payload.questionChanges = {
      upserted,
      deleted: Object.keys(qc.deleted),
      ...(qc.reordered ? { reorderedIds: survey.questions.map((q) => q.id) } : {}),
    };
  }

  return payload;
}
