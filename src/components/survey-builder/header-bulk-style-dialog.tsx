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
import type { HeaderBulkStyle, HeaderStyleState } from '@/utils/header-style';

import { CellStyleFields } from './cell-style-fields';

interface HeaderBulkStyleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStyle: HeaderStyleState;
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
    isMixed,
    styledCount,
  } = initialStyle;
  const [textBold, setTextBold] = useState(initialTextBold);
  const [backgroundColor, setBackgroundColor] = useState(initialBackgroundColor);
  const [backgroundColorDraft, setBackgroundColorDraft] = useState(initialBackgroundColor);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  const normalizedPreviewColor = backgroundColorDraft
    ? normalizeCellHexColor(backgroundColorDraft) ?? backgroundColor
    : '';

  const handleApply = () => {
    const normalizedBackgroundColor = backgroundColorDraft
      ? normalizeCellHexColor(backgroundColorDraft)
      : null;

    if (backgroundColorDraft && !normalizedBackgroundColor) {
      setError(COLOR_ERROR);
      setConfirming(false);
      return;
    }

    // 개별 지정된 스타일이 섞여 있을 때만 확인을 받는다.
    // 이미 전부 같은 색이면 잃을 개별 작업이 없으므로 그냥 적용한다.
    if (isMixed && !confirming) {
      setConfirming(true);
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
          setConfirming(false);
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

      <DialogFooter className="sm:flex-col sm:items-stretch sm:gap-2">
        {confirming && (
          <p role="alert" className="text-sm text-amber-700">
            개별 지정된 헤더 스타일 {styledCount}개가 초기화됩니다. 계속하시겠습니까?
          </p>
        )}
        <div className="flex justify-end gap-2">
          {confirming && (
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              취소
            </Button>
          )}
          <Button type="button" onClick={handleApply}>
            {confirming ? '계속' : '전체 헤더에 적용'}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
