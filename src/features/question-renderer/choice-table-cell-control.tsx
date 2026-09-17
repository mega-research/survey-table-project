'use client';

import { useCallback } from 'react';

import { useOptionTexts, useResponseSources } from '@/features/question-renderer/response-sources';
import {
  decodeChoiceTableCellValue,
  encodeChoiceTableCellValue,
} from '@/lib/survey/choice-table-cell-value';
import { usePriorHighlight } from '@/features/question-renderer/prior-answers-context';
import { priorOptionText } from '@/lib/survey/prior-answers';
import type { TableCell } from '@/types/survey';

import { CheckboxCell, RadioCell, SelectCell } from './cells';

// useSyncExternalStore 안정 참조 — 원본이 undefined 를 줄 때 쓰는 고정 빈 맵
const EMPTY_OPTION_TEXTS: Record<string, string> = {};

/**
 * 보기-소스 표(ChoiceTableResponse) 안의 선택형 셀.
 *
 * 이 표를 그리는 문항은 `radio`/`checkbox` 이지 `table` 이 아니라, 응답이
 * `{그룹키: 셀id}` 모양이다 — 셀 id 를 키로 하는 자리가 없다. 그래서 값은 단답형 셀과
 * 같은 `__optTexts__` 사이드카에 **셀 id** 로 넣는다. 그 맵은 이미 같은 표 안에서
 * 유일한 셀 id 를 쓰고 있어 충돌이 없고, 초안·재진입 복원·버전 rebase·관리자 편집
 * diff·내보내기가 그대로 동작한다.
 *
 * 사이드카가 실제로 어디에 사는지는 주입된 옵션 텍스트 원본(response-sources)이 정한다 —
 * 렌더러는 저장소를 모른다.
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
  const { optionTexts: optionTextSource } = useResponseSources();
  const optionTexts = useOptionTexts(optionTextSource, questionId) ?? EMPTY_OPTION_TEXTS;
  const setOptionText = optionTextSource.write;
  const priorHighlight = usePriorHighlight();

  const onUpdateValue = useCallback(
    (value: string | string[] | object) => {
      setOptionText(questionId, cell.id, encodeChoiceTableCellValue(value));
    },
    [cell.id, questionId, setOptionText],
  );

  const cellResponse = decodeChoiceTableCellValue(optionTexts[cell.id] ?? '', cell.type);
  // 이월 표시 — 이 값은 이월 응답의 제자리가 아니라 사이드카에 인코딩돼 있으므로
  // 저장할 때와 같은 디코더로 되돌려 셀에 조각으로 넘긴다. 셀이 스스로 찾으면
  // `prior[questionId][cell.id]` 를 보게 되어 언제나 빈손이다.
  const priorChoiceValue = decodeChoiceTableCellValue(
    priorOptionText(priorHighlight, questionId, cell.id) ?? '',
    cell.type,
  );
  const shared = {
    cell,
    cellResponse,
    onUpdateValue,
    questionId,
    priorChoiceValue,
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
