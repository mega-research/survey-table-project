'use client';

/* eslint-disable jsx-a11y/role-supports-aria-props -- aria-invalid 전역 상태를 실제 검증 입력에 연결한다. */
import React from 'react';

import { CellText, resolveCellTextHtml } from '@/features/question-renderer/cell-text';
import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { useChoiceOptToggle } from '@/features/question-renderer/hooks/use-choice-opt-toggle';
import { OptionTextInputStack } from '@/features/question-renderer/option-text-input-stack';
import { getHorizontalJustifyClass } from '@/features/question-renderer/utils/table-grid-utils';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { ChoiceGroup, TableCell } from '@/types/survey';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';

interface ChoiceOptCellProps {
  cell: TableCell;
  questionId: string;
  /** 이 셀이 속한 그룹 — 키(응답 맵의 키)와 종류(radio/checkbox)를 준다 */
  group: ChoiceGroup;
  value?: Record<string, unknown> | undefined;
  onChange?: ((value: Record<string, unknown>) => void) | undefined;
  inputIdScope?: string | undefined;
  ariaInvalid?: boolean | undefined;
  ariaDescribedBy?: string | undefined;
  /**
   * 그리는 모양. 'cell'(기본)은 표 셀 안 [컨트롤 + 셀 텍스트]. 'tile' 은 모바일 행 단위 그룹
   * 카드의 세로 타일 — 테두리 칸 하나가 통째로 탭 영역이고 글자는 옵션 라벨이며 고르면 파랗게
   * 칠한다(보기 소스 표의 같은 모드와 같은 얼굴). 선택 읽기·쓰기는 두 모양이 같다.
   */
  variant?: 'cell' | 'tile' | undefined;
}

/**
 * 보기 그룹 표의 보기 옵션 셀 — table 문항 안에서 radio/checkbox 컨트롤로 그려진다.
 *
 * 값은 셀 id 키가 아니라 표 응답 안 예약 키 `__choiceGroups[그룹키]` 에 산다(단일 그룹은
 * 셀 id 하나, 복수 그룹은 셀 id 배열). 읽기·쓰기 규칙은 useChoiceOptToggle 한 곳이다 — 척도 막대도
 * 같은 훅을 쓴다.
 *
 * 레거시 보기 소스 표(radio/checkbox 문항)의 셀과 달리 문항 레벨 값이 없다 — 그쪽 컴포넌트를
 * 재사용하지 않는다.
 */
export const ChoiceOptCell = React.memo(function ChoiceOptCell({
  cell,
  questionId,
  group,
  value,
  onChange,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
  variant = 'cell',
}: ChoiceOptCellProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const groupKey = group.groupKey;
  const isCheckbox = group.type === 'checkbox';
  const { checked, toggle } = useChoiceOptToggle({ cell, questionId, group, value, onChange });

  // 접근성 이름·상세기재 칩·모바일 카드는 옵션 라벨(choiceLabel), 없으면 셀 텍스트.
  const rawLabel = (cell.choiceLabel ?? '').trim() || cell.content || '';
  const label = substituteTokens(rawLabel, attrs, quotes);
  // 데스크톱 셀에 보이는 글자는 셀 텍스트(content)만 — 옵션 라벨은 데이터로만 저장된다.
  // 레거시 보기 소스 표·셀 편집 모달 미리보기와 같은 규칙이라, 「①」을 셀 텍스트로 두고 라벨을
  // 「전혀 기대 안함」으로 둔 척도 표가 세 화면에서 같은 얼굴이다. 비어 있으면 컨트롤만 그린다.
  const visibleText = substituteTokens((cell.content ?? '').trim(), attrs, quotes);
  const inputId = `${inputIdScope ? `${inputIdScope}-` : ''}${questionId}-${cell.id}`;
  const textInputStack = (
    <OptionTextInputStack
      questionId={questionId}
      entries={[
        {
          option: {
            id: cell.id,
            ...(cell.textInputPlaceholder !== undefined
              ? { textInputPlaceholder: cell.textInputPlaceholder }
              : {}),
            ...(cell.textInputType !== undefined ? { textInputType: cell.textInputType } : {}),
            ...(cell.textInputNumberFormat !== undefined
              ? { textInputNumberFormat: cell.textInputNumberFormat }
              : {}),
          },
          label: label.trim() || '(라벨 없음)',
        },
      ]}
    />
  );

  const controlCls =
    variant === 'tile'
      ? 'h-5 w-5 shrink-0 cursor-pointer border-gray-300 text-blue-600 focus:ring-blue-500'
      : 'mt-1 h-4 w-4 shrink-0 cursor-pointer border-gray-300 text-blue-600 focus:ring-blue-500';
  const control = isCheckbox ? (
    <input
      type="checkbox"
      id={inputId}
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedBy}
      aria-label={label}
      checked={checked}
      onChange={toggle}
      className={cn(controlCls, 'rounded')}
    />
  ) : (
    <input
      type="radio"
      id={inputId}
      name={`${questionId}-${groupKey}`}
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedBy}
      aria-label={label}
      checked={checked}
      onChange={() => {}}
      onClick={toggle}
      className={controlCls}
    />
  );

  if (variant === 'tile') {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <label
          htmlFor={inputId}
          className={cn(
            'flex min-h-10 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-1.5 text-[15px] transition-colors',
            checked
              ? 'border-blue-300 bg-blue-50 text-blue-900'
              : 'border-gray-200 bg-white text-gray-800',
          )}
        >
          {control}
          {label && <span className="leading-snug">{label}</span>}
        </label>
        {checked && cell.allowTextInput && textInputStack}
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      {/* items-start + mt-1: 라벨이 두 줄로 감겨도 컨트롤이 첫 줄에 고정된다.
          가로 정렬은 이 행이 직접 — 뿌리가 w-full 이라 셀 래퍼의 items-* 가 닿지 않는다. */}
      <div
        className={cn('flex items-start gap-2', getHorizontalJustifyClass(cell.horizontalAlign))}
      >
        {control}
        {visibleText && (
          <label
            htmlFor={inputId}
            className={cn(
              'cursor-pointer text-base leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line select-none',
              getCellTextClassName(cell),
            )}
            style={getCellTextStyle(cell)}
          >
            <CellText
              text={visibleText}
              html={resolveCellTextHtml(cell, attrs, quotes)}
              boldFirstLine={cell.boldFirstLine}
            />
          </label>
        )}
      </div>
      {/* 기타 상세기재 — 레거시 보기 소스 표와 같은 사이드카(보기 id) 입력칸. 고른 동안만 연다. */}
      {checked && cell.allowTextInput && textInputStack}
    </div>
  );
});
