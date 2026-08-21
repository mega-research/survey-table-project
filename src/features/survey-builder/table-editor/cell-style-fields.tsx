'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { normalizeCellHexColor } from '@/utils/cell-style';

interface CellStyleFieldsProps {
  textBold: boolean;
  backgroundColor: string;
  textColor: string;
  onTextBoldChange: (value: boolean) => void;
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

export function CellStyleFields({
  textBold,
  backgroundColor,
  textColor,
  onTextBoldChange,
  onBackgroundColorChange,
  onTextColorChange,
  onBackgroundColorDraftChange,
  onTextColorDraftChange,
  error,
  onInvalidColor,
}: CellStyleFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label htmlFor="cell-text-bold">텍스트 굵게</Label>
        <Switch
          id="cell-text-bold"
          aria-label="텍스트 굵게"
          checked={textBold}
          onCheckedChange={onTextBoldChange}
        />
      </div>

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
