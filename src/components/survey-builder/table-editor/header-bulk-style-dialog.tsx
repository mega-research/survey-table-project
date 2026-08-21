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
  getCellTextStyle,
  normalizeCellHexColor,
} from '@/utils/cell-style';
import type { HeaderBulkStyle, HeaderStyleState } from '@/components/survey-builder/table-editor/utils/header-style';

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
  const formKey = [
    open ? 'open' : 'closed',
    initialStyle.textBold,
    initialStyle.backgroundColor,
    initialStyle.textColor,
  ].join(':');

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
    textColor: initialTextColor,
    isMixed,
    styledCount,
  } = initialStyle;
  const [textBold, setTextBold] = useState(initialTextBold);
  const [backgroundColor, setBackgroundColor] = useState(initialBackgroundColor);
  const [backgroundColorDraft, setBackgroundColorDraft] = useState(initialBackgroundColor);
  const [textColor, setTextColor] = useState(initialTextColor);
  const [textColorDraft, setTextColorDraft] = useState(initialTextColor);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  /** 미리보기는 확정 전 draft 도 보여준다. 잘못된 값이면 마지막 확정 색으로 되돌린다. */
  const previewColor = (draft: string, committed: string) => (
    draft ? normalizeCellHexColor(draft) ?? committed : ''
  );

  const handleApply = () => {
    const normalizedBackgroundColor = backgroundColorDraft
      ? normalizeCellHexColor(backgroundColorDraft)
      : null;
    const normalizedTextColor = textColorDraft
      ? normalizeCellHexColor(textColorDraft)
      : null;

    if (
      (backgroundColorDraft && !normalizedBackgroundColor)
      || (textColorDraft && !normalizedTextColor)
    ) {
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

    onApply({
      textBold,
      backgroundColor: normalizedBackgroundColor ?? '',
      textColor: normalizedTextColor ?? '',
    });
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
        textColor={textColor}
        onTextBoldChange={(value) => {
          setTextBold(value);
          setConfirming(false);
        }}
        onBackgroundColorChange={setBackgroundColor}
        onBackgroundColorDraftChange={(value) => {
          setBackgroundColorDraft(value);
          setError(undefined);
          setConfirming(false);
        }}
        onTextColorChange={setTextColor}
        onTextColorDraftChange={(value) => {
          setTextColorDraft(value);
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
        style={{
          ...getCellBackgroundStyle({
            backgroundColor: previewColor(backgroundColorDraft, backgroundColor),
          }),
          ...getCellTextStyle({ textColor: previewColor(textColorDraft, textColor) }),
        }}
      >
        헤더 미리보기
      </div>

      <DialogFooter className="sm:flex-col sm:items-stretch sm:gap-2">
        {confirming && (
          <p role="alert" className="text-sm text-amber-700">
            스타일이 지정된 헤더 {styledCount}개가 초기화됩니다. 계속하시겠습니까?
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
