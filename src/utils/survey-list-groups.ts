/**
 * 설문 목록을 「묶음」과 묶이지 않은 설문으로 가른다 — 설문 관리·설문 분석 목록이 함께 쓴다.
 * 묶음은 목록에 처음 나오는 순서, 묶음 안의 설문은 목록 순서 그대로다.
 * 임시 장치다(`lib/survey-list-groups.server.ts` 머리 주석) — staging 병합·승격 때 함께 지운다.
 */
export interface SurveyListGroup<T> {
  name: string;
  surveys: T[];
}

export function partitionSurveyList<T extends { listGroup: string | null }>(
  surveys: readonly T[],
): { groups: SurveyListGroup<T>[]; ungrouped: T[] } {
  const byName = new Map<string, SurveyListGroup<T>>();
  const ungrouped: T[] = [];
  for (const survey of surveys) {
    if (survey.listGroup === null) {
      ungrouped.push(survey);
      continue;
    }
    const group = byName.get(survey.listGroup);
    if (group) group.surveys.push(survey);
    else byName.set(survey.listGroup, { name: survey.listGroup, surveys: [survey] });
  }
  return { groups: [...byName.values()], ungrouped };
}
