import type { GroupedChoiceAnswer } from '@/utils/choice-group-helpers';
import { isGroupedChoiceQuestion } from '@/utils/choice-group-helpers';
import type { Question } from '@/types/survey';

/**
 * 보기 소스 표(radio/checkbox + tableRowsData) 문항의 응답에서 **선택된 보기 셀 id 집합**을 뽑는다.
 *
 * 응답 모양이 셋이다 — checkbox: cell.id[] / 비그룹 radio: cell.id / 그룹별: {그룹키: id | id[]}.
 * 렌더(choice-table-response)·게이팅 평가·저장 strip·검증이 같은 집합을 봐야 "화면에선
 * 보이는데 검증은 숨김" 이 안 생긴다 — 여기 한 곳이 정본이다.
 * 기타 상세기재의 `{selectedValue}` 래핑도 id 로 푼다.
 */
export function collectSelectedChoiceCellIds(question: Question, value: unknown): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string') {
      if (v) out.add(v);
    } else if (Array.isArray(v)) {
      for (const item of v) add(item);
    } else if (v && typeof v === 'object' && 'selectedValue' in v) {
      add((v as { selectedValue?: unknown }).selectedValue);
    }
  };
  if (isGroupedChoiceQuestion(question)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const v of Object.values(value as GroupedChoiceAnswer)) add(v);
    return out;
  }
  add(value);
  return out;
}
