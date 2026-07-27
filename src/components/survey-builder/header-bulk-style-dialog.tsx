'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  getCellBackgroundStyle,
  getCellTextClassName,
  normalizeCellHexColor,
} from '@/utils/cell-style';
import type { HeaderBulkStyle } from '@/utils/header-style';

import { CellStyleFields } from './cell-style-fields';

interface HeaderBulkStyleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStyle: HeaderBulkStyle;
  onApply: (style: HeaderBulkStyle) => void;
}

const COLOR_ERROR = '3자리 또는 6자리 HEX 색상을 입력하세요.';

export function HeaderBulkStyleDialog({
  open,
  onOpenChange,
  initialStyle,
  onApply,
}: HeaderBulkStyleDialogProps): React.ReactNode {
  const [textBold, setTextBold] = useState(initialStyle.textBold);
  const [backgroundColor, setBackgroundColor] = useState(initialStyle.backgroundColor);
  const [backgroundColorDraft, setBackgroundColorDraft] = useState(initialStyle.backgroundColor);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;

    setTextBold(initialStyle.textBold);
    setBackgroundColor(initialStyle.backgroundColor);
    setBackgroundColorDraft(initialStyle.backgroundColor);
    setError(undefined);
  }, [initialStyle, open]);

  const normalizedPreviewColor = backgroundColorDraft
    ? normalizeCellHexColor(backgroundColorDraft) ?? backgroundColor
    : '';

  const handleApply = () => {
    const normalizedBackgroundColor = backgroundColorDraft
      ? normalizeCellHexColor(backgroundColorDraft)
      : null;

    if (backgroundColorDraft && !normalizedBackgroundColor) {
      setError(COLOR_ERROR);
      return;
    }

    onApply({ textBold, backgroundColor: normalizedBackgroundColor ?? '' });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>전체 헤더 스타일</DialogTitle>
        </DialogHeader>

        <CellStyleFields
          textBold={textBold}
          backgroundColor={backgroundColor}
          onTextBoldChange={setTextBold}
          onBackgroundColorChange={setBackgroundColor}
          onBackgroundColorDraftChange={(value) => {
            setBackgroundColorDraft(value);
            setError(undefined);
          }}
          error={error}
          onInvalidColor={() => setError(COLOR_ERROR)}
        />

        <div
          data-testid="header-style-preview"
          className={cn(
            'rounded-md border border-gray-300 bg-gray-50 px-4 py-3 text-center',
            getCellTextClassName({ textBold }),
          )}
          style={getCellBackgroundStyle({ backgroundColor: normalizedPreviewColor })}
        >
          헤더 미리보기
        </div>

        <DialogFooter>
          <Button type="button" onClick={handleApply}>전체 헤더에 적용</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
