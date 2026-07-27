'use client';

import { useState } from 'react';

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
  const formKey = `${open ? 'open' : 'closed'}:${initialStyle.textBold}:${initialStyle.backgroundColor}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <HeaderBulkStyleForm
          key={formKey}
          initialStyle={initialStyle}
          onApply={onApply}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function HeaderBulkStyleForm({
  initialStyle,
  onApply,
  onOpenChange,
}: Omit<HeaderBulkStyleDialogProps, 'open'>): React.ReactNode {
  const {
    textBold: initialTextBold,
    backgroundColor: initialBackgroundColor,
  } = initialStyle;
  const [textBold, setTextBold] = useState(initialTextBold);
  const [backgroundColor, setBackgroundColor] = useState(initialBackgroundColor);
  const [backgroundColorDraft, setBackgroundColorDraft] = useState(initialBackgroundColor);
  const [error, setError] = useState<string>();

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
    <>
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
    </>
  );
}
