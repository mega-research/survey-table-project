'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { normalizeCellHexColor } from '@/utils/cell-style';

interface CellStyleFieldsProps {
  textBold: boolean;
  backgroundColor: string;
  onTextBoldChange: (value: boolean) => void;
  onBackgroundColorChange: (value: string) => void;
  onBackgroundColorDraftChange?: ((value: string) => void) | undefined;
  error?: string | undefined;
  onInvalidColor?: ((raw: string) => void) | undefined;
}

export function CellStyleFields({
  textBold,
  backgroundColor,
  onTextBoldChange,
  onBackgroundColorChange,
  onBackgroundColorDraftChange,
  error,
  onInvalidColor,
}: CellStyleFieldsProps) {
  const [draft, setDraft] = useState(backgroundColor);

  useEffect(() => {
    setDraft(backgroundColor);
  }, [backgroundColor]);

  const commitDraft = () => {
    const normalized = normalizeCellHexColor(draft);
    if (normalized) {
      setDraft(normalized);
      onBackgroundColorDraftChange?.(normalized);
      onBackgroundColorChange(normalized);
      return;
    }

    onInvalidColor?.(draft);
  };

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

      <div className="space-y-2">
        <Label>배경색</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="배경색 선택"
            value={backgroundColor || '#FFFFFF'}
            onChange={(event) => {
              const color = event.target.value.toUpperCase();
              setDraft(color);
              onBackgroundColorDraftChange?.(color);
              onBackgroundColorChange(color);
            }}
            className="h-9 w-12 cursor-pointer rounded border border-gray-200"
          />
          <Input
            aria-label="HEX 색상"
            value={draft}
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              onBackgroundColorDraftChange?.(value);
            }}
            onBlur={commitDraft}
            placeholder="#AABBCC"
            className="w-32"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft('');
              onBackgroundColorDraftChange?.('');
              onBackgroundColorChange('');
            }}
          >
            배경색 없음
          </Button>
        </div>
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
