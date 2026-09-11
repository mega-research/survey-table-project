import type { GroupedChoiceAnswer } from '@/utils/choice-group-helpers';
import { isGroupedChoiceQuestion } from '@/utils/choice-group-helpers';
import type { Question } from '@/types/survey';

/**
 * 그룹 선택 예약 키 — 보기 그룹 표(table 문항 + choice_opt 셀 + choiceGroups)의 표 응답
 * 객체 **안**에서 보기 그룹 선택을 담는 `__` 접두 하위 키. `__selectedRowIds` 와 같은 층위다.
 *
 *   questionResponses[tableId] = { <cellId>: 값, __selectedRowIds: [...], __choiceGroups: { <groupKey>: cellId | cellId[] } }
 *
 * 표 응답 안에 두는 이유: 표 코드 전반이 이미 `__` 하위 키를 건너뛰어(구조 생존·미접촉 판정·
 * 이월 비어있음 판정·SQL 키 순회·raw 임포트) 문항 단위 삭제·rebase·관리자 diff 가 값 하나로
 * 따라온다. 루트 사이드카로 빼면 저장 경계마다 소속 검증을 또 우회해야 한다(`__optTexts__` 가
 * 그 길로 사고 셋을 냈다).
 */
export const CHOICE_GROUPS_KEY = '__choiceGroups';

/**
 * 보기 그룹 표인가 — 유형이 table 이고 radio/checkbox 그룹이 정의돼 있다.
 * 레거시 형태(radio/checkbox 문항 + 내장 표)와 응답 모양이 달라 술어를 합치지 않는다.
 */
export function isChoiceGroupTableQuestion(question: Question): boolean {
  return question.type === 'table' && isGroupedChoiceQuestion(question);
}

/** 표 응답 객체에서 그룹 선택 맵을 읽는다. 없거나 모양이 아니면 빈 맵. */
export function readTableChoiceGroups(tableValue: unknown): GroupedChoiceAnswer {
  if (!tableValue || typeof tableValue !== 'object' || Array.isArray(tableValue)) return {};
  const raw = (tableValue as Record<string, unknown>)[CHOICE_GROUPS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as GroupedChoiceAnswer;
}

/**
 * 보기 옵션 셀을 가진 문항의 응답에서 **선택된 보기 셀 id 집합**을 뽑는다 — 정본 리더.
 *
 * 응답 모양이 넷이다 — 레거시 checkbox: cell.id[] / 레거시 비그룹 radio: cell.id /
 * 레거시 그룹별: {그룹키: id | id[]} / 보기 그룹 표(table): 표 응답 안 `__choiceGroups` 의 그룹 맵.
 * 렌더·게이팅 평가·저장 strip·검증·내보내기·분기가 같은 집합을 봐야 "화면에선 보이는데
 * 검증은 숨김" 이 안 생긴다 — 여기 한 곳이 정본이고, 호출부는 `__choiceGroups` 를 직접
 * 파헤치지 않는다. 기타 상세기재의 `{selectedValue}` 래핑도 id 로 푼다.
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
  if (question.type === 'table') {
    for (const v of Object.values(readTableChoiceGroups(value))) add(v);
    return out;
  }
  if (isGroupedChoiceQuestion(question)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const v of Object.values(value as GroupedChoiceAnswer)) add(v);
    return out;
  }
  add(value);
  return out;
}
