'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { normalizeCellHexColor } from '@/utils/cell-style';
import { cn } from '@/lib/utils';

interface CellStyleFieldsProps {
  textBold: boolean;
  backgroundColor: string;
  textColor: string;
  onTextBoldChange: (value: boolean) => void;
  /**
   * 「첫 줄만 굵게」 — 표 셀 편집기에서만 넘긴다. 넘기면 굵기가 3지선다가 되고,
   * 안 넘기면 기존 on/off 스위치 그대로다(헤더 편집기는 첫 줄 개념이 없다).
   */
  boldFirstLine?: boolean | undefined;
  onBoldFirstLineChange?: ((value: boolean) => void) | undefined;
  onBackgroundColorChange: (value: string) => void;
  onTextColorChange: (value: string) => void;
  onBackgroundColorDraftChange?: ((value: string) => void) | undefined;
  onTextColorDraftChange?: ((value: string) => void) | undefined;
  error?: string | undefined;
  onInvalidColor?: ((raw: string) => void) | undefined;
}

interface ColorFieldProps {
  /** 라벨 겸 aria-label 접두사. "배경색" 이면 "배경색 선택" / "배경색 HEX" / "배경색 없음" 이 된다. */
  label: string;
  /** 색이 비었을 때 색 선택기가 보여줄 기본값 */
  fallback: string;
  value: string;
  onChange: (value: string) => void;
  onDraftChange?: ((value: string) => void) | undefined;
  onInvalid?: ((raw: string) => void) | undefined;
}

function ColorField({
  label,
  fallback,
  value,
  onChange,
  onDraftChange,
  onInvalid,
}: ColorFieldProps) {
  const [draft, setDraft] = useState(value);

  // prop 변경 시 draft 동기화 — effect 대신 렌더 중 조정 패턴
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(value);
  }

  const clear = () => {
    setDraft('');
    onDraftChange?.('');
    onChange('');
  };

  const commitDraft = () => {
    if (draft.trim() === '') {
      clear();
      return;
    }

    const normalized = normalizeCellHexColor(draft);
    if (normalized) {
      setDraft(normalized);
      onDraftChange?.(normalized);
      onChange(normalized);
      return;
    }

    onInvalid?.(draft);
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} 선택`}
          value={value || fallback}
          onChange={(event) => {
            const color = event.target.value.toUpperCase();
            setDraft(color);
            onDraftChange?.(color);
            onChange(color);
          }}
          className="h-9 w-12 cursor-pointer rounded border border-gray-200"
        />
        <Input
          aria-label={`${label} HEX`}
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            onDraftChange?.(next);
          }}
          onBlur={commitDraft}
          placeholder="#AABBCC"
          className="w-32"
        />
        <Button type="button" variant="outline" onClick={clear}>
          {label} 없음
        </Button>
      </div>
    </div>
  );
}

/** 굵기 3지선다의 한 칸. 값이 배타라 라디오처럼 하나만 켜진다. */
function BoldChoice({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-md border px-3 py-1 text-xs transition-colors',
        on
          ? 'border-blue-500 bg-blue-50 font-semibold text-blue-700'
          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
      )}
    >
      {label}
    </button>
  );
}

export function CellStyleFields({
  textBold,
  backgroundColor,
  textColor,
  onTextBoldChange,
  boldFirstLine = false,
  onBoldFirstLineChange,
  onBackgroundColorChange,
  onTextColorChange,
  onBackgroundColorDraftChange,
  onTextColorDraftChange,
  error,
  onInvalidColor,
}: CellStyleFieldsProps) {
  return (
    <div className="space-y-4">
      {onBoldFirstLineChange ? (
        <div className="flex items-center justify-between">
          <Label>텍스트 굵게</Label>
          <div className="flex gap-1.5">
            <BoldChoice
              label="없음"
              on={!textBold && !boldFirstLine}
              onClick={() => {
                onTextBoldChange(false);
                onBoldFirstLineChange(false);
              }}
            />
            <BoldChoice
              label="전체"
              on={textBold}
              onClick={() => {
                onTextBoldChange(true);
                onBoldFirstLineChange(false);
              }}
            />
            <BoldChoice
              label="첫 줄"
              on={boldFirstLine}
              onClick={() => {
                onTextBoldChange(false);
                onBoldFirstLineChange(true);
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <Label htmlFor="cell-text-bold">텍스트 굵게</Label>
          <Switch
            id="cell-text-bold"
            aria-label="텍스트 굵게"
            checked={textBold}
            onCheckedChange={onTextBoldChange}
          />
        </div>
      )}

      <ColorField
        label="배경색"
        fallback="#FFFFFF"
        value={backgroundColor}
        onChange={onBackgroundColorChange}
        onDraftChange={onBackgroundColorDraftChange}
        onInvalid={onInvalidColor}
      />

      <ColorField
        label="글자색"
        fallback="#000000"
        value={textColor}
        onChange={onTextColorChange}
        onDraftChange={onTextColorDraftChange}
        onInvalid={onInvalidColor}
      />

      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
