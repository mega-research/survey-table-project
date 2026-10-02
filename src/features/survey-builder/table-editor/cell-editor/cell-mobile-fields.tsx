'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { CellFormSetters, UseCellFormResult } from './hooks/use-cell-form';

interface CellMobileFieldsProps {
  form: UseCellFormResult['form'];
  setters: CellFormSetters;
  columnLabel?: string | undefined;
  /** 표시용 셀(텍스트·이미지 등) — 모바일 카드 노출 여부 토글을 보여준다. */
  showContentMobileDisplay: boolean;
  /** 입력 셀 — 모바일 카드 제목 입력칸을 보여준다. */
  showInteractiveMobileLabel: boolean;
  /** 같은 열에서 일괄 적용 대상이 되는 다른 표시 셀 수. 0·미지정이면 체크를 그리지 않는다. */
  columnApplyCount?: number | undefined;
  applyToColumn?: boolean | undefined;
  onApplyToColumnChange?: ((checked: boolean) => void) | undefined;
}

/** cell-content-modal 의 '모바일 카드 표시' 구획. 상태는 모달이 그대로 들고 있다. */
export function CellMobileFields({
  form,
  setters,
  columnLabel,
  showContentMobileDisplay,
  showInteractiveMobileLabel,
  columnApplyCount,
  applyToColumn,
  onApplyToColumnChange,
}: CellMobileFieldsProps) {
  const { contentType, exportLabel, mobileDisplay, mobileLabel } = form;
  const { setMobileDisplay, setMobileLabel } = setters;

  return (
    <>
  {(showContentMobileDisplay || showInteractiveMobileLabel) && (
    <div className="mt-6 border-t border-gray-200 pt-6">
      <h3 className="mb-3 text-sm font-medium text-gray-900">모바일 카드 표시</h3>
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mobileDisplay === 'hidden' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMobileDisplay('hidden')}
          className="flex-1"
        >
          숨기기
        </Button>
        {showContentMobileDisplay ? (
          <>
            {contentType === 'text' && (
              <>
                <Button
                  type="button"
                  variant={mobileDisplay === 'header' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMobileDisplay('header')}
                  className="flex-1"
                >
                  헤더
                </Button>
                {/* 카드 범례: 이 표의 모든 응답 카드 상단에 한 행으로 표시 (스케일 앵커 라벨용) */}
                <Button
                  type="button"
                  variant={mobileDisplay === 'legend' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMobileDisplay('legend')}
                  className="flex-1"
                >
                  카드 범례
                </Button>
              </>
            )}
            <Button
              type="button"
              variant={mobileDisplay === 'inline' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMobileDisplay('inline')}
              className="flex-1"
            >
              바로표시
            </Button>
            <Button
              type="button"
              variant={mobileDisplay === 'collapsed' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMobileDisplay('collapsed')}
              className="flex-1"
            >
              자세히
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant={mobileDisplay !== 'hidden' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMobileDisplay('inline')}
            className="flex-1"
          >
            표시
          </Button>
        )}
      </div>

      {/* 열 일괄 적용 — 설명 열처럼 행마다 같은 표시를 걸어야 하는 자리. 저장할 때 함께 반영된다 */}
      {showContentMobileDisplay && !!columnApplyCount && (
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300"
            checked={applyToColumn ?? false}
            onChange={(e) => onApplyToColumnChange?.(e.target.checked)}
          />
          같은 열의 다른 표시 셀에도 적용 ({columnApplyCount}개)
        </label>
      )}

      {/* 셀 라벨 — 모바일 카드/드릴다운에서 입력칸 위에 붙는 제목 */}
      {showInteractiveMobileLabel && mobileDisplay !== 'hidden' && (
        <div className="mt-4 space-y-2">
          <Label htmlFor="mobile-label">셀 라벨</Label>
          <Input
            id="mobile-label"
            value={mobileLabel}
            onChange={(e) => setMobileLabel(e.target.value)}
            placeholder={exportLabel || columnLabel || '열 제목'}
            className="w-full"
          />
          <p className="text-xs text-gray-500">
            모바일 카드에서 입력칸 위에 표시되는 제목입니다. 비워두면 엑셀 라벨, 그것도 없으면
            열 제목이 사용됩니다.
          </p>
        </div>
      )}
    </div>
  )}
    </>
  );
}
