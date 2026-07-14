'use client';

import { Label } from '@/components/ui/label';
import type { OptionsAlign } from '@/types/survey';

interface OptionsLayoutSelectorProps {
  /** 현재 값. undefined/1 = 세로, 0 = 가로, N ≥ 2 = N열 그리드. */
  value: number | undefined;
  onChange: (next: number) => void;
  /** 라벨 텍스트 커스터마이즈 (기본 "옵션 배치:"). */
  label?: string;
  /** 옵션 그룹 블록 정렬. onAlignChange 와 함께 전달된 경우에만 정렬 select 렌더. */
  align?: OptionsAlign | undefined;
  onAlignChange?: (next: OptionsAlign) => void;
}

/**
 * 라디오/체크박스/순위형 옵션의 응답 페이지 배치 선택기.
 * 질문 편집 UI 의 여러 탭에서 재사용하기 위해 분리.
 * 정렬 select 는 align props 를 넘긴 호출부(radio/checkbox 기본 탭)에서만 노출.
 */
export function OptionsLayoutSelector({
  value,
  onChange,
  label = '옵션 배치:',
  align,
  onAlignChange,
}: OptionsLayoutSelectorProps) {
  const isGrid = (value ?? 1) >= 2;
  return (
    <div className="flex items-center gap-2 text-xs">
      <Label className="text-gray-600">{label}</Label>
      <select
        value={value ?? 1}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="rounded border border-gray-300 bg-white px-2 py-1"
      >
        <option value={1}>세로 (1열)</option>
        <option value={0}>가로 (한 줄, 자동 줄바꿈)</option>
        <option value={2}>2열 그리드</option>
        <option value={3}>3열 그리드</option>
        <option value={4}>4열 그리드</option>
        <option value={5}>5열 그리드</option>
        <option value={6}>6열 그리드</option>
      </select>
      {onAlignChange && (
        <>
          <Label className="text-gray-600">옵션 정렬:</Label>
          <select
            value={isGrid ? 'left' : (align ?? 'left')}
            onChange={(e) => onAlignChange(e.target.value as OptionsAlign)}
            disabled={isGrid}
            title={isGrid ? '그리드 배치는 좌측 고정' : undefined}
            className="rounded border border-gray-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="left">좌측</option>
            <option value="center">중앙</option>
            <option value="right">우측</option>
          </select>
        </>
      )}
    </div>
  );
}
