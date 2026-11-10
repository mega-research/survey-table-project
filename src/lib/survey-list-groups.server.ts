import 'server-only';

const ENV_KEY = 'SURVEY_LIST_GROUPS';

/**
 * 설문 목록의 「묶음」 — 한꺼번에 들어온 수십 개의 설문을 목록에서 카드 한 장으로 접어 두는 임시 장치다.
 *
 * `SURVEY_LIST_GROUPS="<묶음 이름>=<surveyId>,<surveyId>;<묶음 이름>=<surveyId>"` 로 적는다.
 * 묶음 이름에는 `=` 와 `;` 를 쓸 수 없다. 형식이 틀린 항목은 무시한다 — 그 설문은 묶이지 않은 채
 * 목록에 그대로 보인다(잘못 적어서 설문이 사라지는 쪽이 아니라 안 묶이는 쪽으로 틀린다).
 * 한 설문을 두 묶음에 적으면 먼저 적은 묶음이 이긴다.
 *
 * **권한도 숨김도 아니다.** 접어 둘 뿐이고 누구나 펼쳐서 연다.
 *
 * **staging 을 병합하거나 승격할 때 버린다**(2026-11-10 사용자 결정). staging 에는 설문 그룹이 따로 있어
 * 이 env·`listGroup` 필드·목록 화면의 묶음 구역을 그쪽 것으로 갈아 끼우지 않고 통째로 지운다.
 */
export function parseSurveyListGroups(raw?: string): Map<string, string> {
  const groupBySurveyId = new Map<string, string>();
  if (!raw) return groupBySurveyId;
  for (const entry of raw.split(';')) {
    const sep = entry.indexOf('=');
    if (sep <= 0) continue;
    const name = entry.slice(0, sep).trim();
    if (!name) continue;
    for (const part of entry.slice(sep + 1).split(',')) {
      const surveyId = part.trim();
      if (!surveyId || groupBySurveyId.has(surveyId)) continue;
      groupBySurveyId.set(surveyId, name);
    }
  }
  return groupBySurveyId;
}

/** 목록 행마다 그 설문이 든 묶음 이름(`listGroup`)을 붙인다 — 묶이지 않았으면 null. */
export function withSurveyListGroup<T extends { id: string }>(
  rows: readonly T[],
): Array<T & { listGroup: string | null }> {
  const groupBySurveyId = parseSurveyListGroups(process.env[ENV_KEY]);
  return rows.map((row) => ({ ...row, listGroup: groupBySurveyId.get(row.id) ?? null }));
}
