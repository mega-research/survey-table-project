import type { QuotaConfig, QuotaGate } from '@/shared/contracts/quota';

import { quotaTotalTarget } from './normalize';

/**
 * 쿼터 플랜 → 게이트. 조사 대상 속성형 차원과 「완료」 조건은 문항이 없어 게이트 문항을 만들지 않는다.
 * 미설정·미집행이면 null.
 */
export function buildQuotaGate(config: QuotaConfig | null | undefined): QuotaGate | null {
  if (!config?.enabled) return null;
  const dimensions = Array.isArray(config.dimensions) ? config.dimensions : [];
  const questionDims = dimensions.filter((d) => d.kind !== 'attr' && d.questionId);
  const questionIds = [...new Set(questionDims.map((d) => d.questionId))];

  const cellIdsByQuestion: Record<string, string[]> = {};
  for (const d of questionDims) {
    if (d.kind !== 'text' || !d.cellIds?.length) continue;
    cellIdsByQuestion[d.questionId] = [...(cellIdsByQuestion[d.questionId] ?? []), ...d.cellIds];
  }

  return {
    questionIds,
    ...(Object.keys(cellIdsByQuestion).length > 0 ? { cellIdsByQuestion } : {}),
    // 문항에 묶인 조건이 없으면 기다릴 답이 없다 — 첫 전환에서 확인한다(속성형만, 또는 「완료」 조건만).
    ...(questionIds.length === 0 && (dimensions.length > 0 || quotaTotalTarget(config) !== null)
      ? { checkWithoutQuestions: true }
      : {}),
    // 진행 중 마감 — 집행 중(위 enabled 가드 통과)일 때만 표식이 실린다.
    ...(config.midSurveyClose ? { recheckOnEachStep: true } : {}),
  };
}
