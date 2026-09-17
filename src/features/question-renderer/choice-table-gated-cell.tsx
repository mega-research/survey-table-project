'use client';

import type { ReactNode } from 'react';

import { useOptionTexts, useResponseSources } from '@/features/question-renderer/response-sources';
import { useMobileView } from '@/hooks/use-media-query';
import { isCellEnabled } from '@/lib/survey/cell-gating';
import type { TableCell } from '@/types/survey';

// useSyncExternalStore 안정 참조 — 원본이 undefined 를 줄 때 쓰는 고정 빈 맵
const EMPTY_OPTION_TEXTS: Record<string, string> = {};

/**
 * 보기 소스 표(ChoiceTableResponse) 안 게이팅 셀의 문지기.
 *
 * 이 표의 input·선택형 셀은 값이 `__optTexts__` 사이드카에 있고, 컨트롤러가 보기 옵션이면
 * 그 값은 문항 응답(선택된 보기 id 집합)에 있다. 표 문항의 InteractiveCell 과 같은 규칙으로
 * 미충족이면 **컨트롤만 숨긴다**. 데스크톱 표는 칸이 비어 보이지 않게 `-` 를 두고, 모바일
 * 카드는 자리 자체가 없으니 아무것도 그리지 않는다. 남은 값 정리는 표 컴포넌트의 sweep 이,
 * 저장 경계는 stripDisabledCellValues 가 같은 판정으로 보증한다.
 *
 * 사이드카 값은 주입된 옵션 텍스트 원본(response-sources)에서 읽는다 — 렌더러는 저장소를 모른다.
 */
export function ChoiceTableGatedCell({
  cell,
  questionId,
  tableCells,
  selectedChoiceIds,
  children,
}: {
  cell: TableCell;
  questionId: string;
  tableCells: readonly TableCell[];
  selectedChoiceIds: ReadonlySet<string>;
  children: ReactNode;
}) {
  const { optionTexts: optionTextSource } = useResponseSources();
  const texts = useOptionTexts(optionTextSource, questionId) ?? EMPTY_OPTION_TEXTS;
  const isMobile = useMobileView();
  const enabled = isCellEnabled(cell, texts, tableCells, selectedChoiceIds);
  // 남은 값 정리는 표 컴포넌트(choice-table-response)의 표 단위 sweep 이 맡는다 — 모바일은
  // 미충족 셀을 그리지 않아 여기 effect 가 돌지 않기 때문이다.

  // 표의 다른 텍스트 셀에 적은 "-" 와 같은 글자 크기·색(상속)으로 — 회색으로 빼면 그 칸만 튄다.
  if (!enabled) return isMobile ? null : <span className="text-base">-</span>;
  return <>{children}</>;
}
