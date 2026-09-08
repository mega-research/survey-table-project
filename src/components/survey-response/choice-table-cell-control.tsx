'use client';

import { useCallback } from 'react';

import { CheckboxCell, RadioCell, SelectCell } from '@/components/survey-builder/cells';
import {
  decodeChoiceTableCellValue,
  encodeChoiceTableCellValue,
} from '@/lib/survey/choice-table-cell-value';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { TableCell } from '@/types/survey';

// useSyncExternalStore 안정 참조 — selector 안에서 `?? {}` 를 쓰면 무한 루프 경고가 난다.
const EMPTY_OPTION_TEXTS: Record<string, string> = {};

/**
 * 보기-소스 표(ChoiceTableResponse) 안의 선택형 셀.
 *
 * 이 표를 그리는 문항은 `radio`/`checkbox` 이지 `table` 이 아니라, 응답이
 * `{그룹키: 셀id}` 모양이다 — 셀 id 를 키로 하는 자리가 없다. 그래서 값은 단답형 셀과
 * 같은 `__optTexts__` 사이드카에 **셀 id** 로 넣는다. 그 맵은 이미 같은 표 안에서
 * 유일한 셀 id 를 쓰고 있어 충돌이 없고, 초안·재진입 복원·버전 rebase·관리자 편집
 * diff·내보내기가 그대로 동작한다.
 */
export function ChoiceTableCellControl({
  cell,
  questionId,
  inputIdScope,
}: {
  cell: TableCell;
  questionId: string;
  inputIdScope?: string | undefined;
}) {
  const optionTexts =
    useSurveyResponseStore((s) => s.optionTexts[questionId]) ?? EMPTY_OPTION_TEXTS;
  const setOptionText = useSurveyResponseStore((s) => s.setOptionText);

  const onUpdateValue = useCallback(
    (value: string | string[] | object) => {
      setOptionText(questionId, cell.id, encodeChoiceTableCellValue(value));
    },
    [cell.id, questionId, setOptionText],
  );

  const cellResponse = decodeChoiceTableCellValue(optionTexts[cell.id] ?? '', cell.type);
  const shared = {
    cell,
    cellResponse,
    onUpdateValue,
    questionId,
    ...(inputIdScope !== undefined ? { inputIdScope } : {}),
  };

  // radio 셀은 같은 셀 안의 보기끼리만 묶는다 — 표 문항의 radioGroupName(행 단위 묶음)은
  // 여기에 없다. 셀 id 를 name 으로 쓰면 브라우저 네이티브 단일 선택이 그대로 동작한다.
  if (cell.type === 'radio') {
    return <RadioCell {...shared} groupName={`${questionId}-${cell.id}`} />;
  }
  if (cell.type === 'checkbox') return <CheckboxCell {...shared} />;
  return <SelectCell {...shared} />;
}
