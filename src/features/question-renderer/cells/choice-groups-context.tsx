'use client';

import { createContext, useContext } from 'react';

import type { ChoiceGroup } from '@/types/survey';

/**
 * 보기 그룹 표(table 문항 + choice_opt 셀 + choiceGroups)의 **그룹 정의** 공급.
 *
 * choice_opt 셀은 자기 `choiceGroupId` 만 알고, 그룹의 키·종류(radio/checkbox)는 문항의
 * `choiceGroups` 에 있다. 표를 그리는 호스트는 여럿(데스크톱 격자·모바일 스테퍼·드릴다운·
 * 행별 원본)이고 전부 InteractiveTableResponse 아래 있으므로, 거기서 한 번 공급하고
 * ChoiceOptCell 이 읽는다. 공급이 없으면(보기 그룹 없는 표·빌더 편집 화면) 보기 셀은
 * 지금처럼 글자로만 보인다.
 */
const ChoiceGroupsContext = createContext<readonly ChoiceGroup[] | null>(null);

export const ChoiceGroupsProvider = ChoiceGroupsContext.Provider;

export function useChoiceGroups(): readonly ChoiceGroup[] | null {
  return useContext(ChoiceGroupsContext);
}
