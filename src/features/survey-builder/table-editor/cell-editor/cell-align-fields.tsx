'use client';

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import type { CellFormSetters, UseCellFormResult } from './hooks/use-cell-form';

interface CellAlignFieldsProps {
  form: UseCellFormResult['form'];
  setters: CellFormSetters;
}

/**
 * cell-content-modal 하단의 '컨텐츠 정렬' 패널 — 가로·세로 정렬과 그 미리보기.
 * 상태는 모달이 그대로 들고 있고 이 컴포넌트는 표시만 한다.
 */
export function CellAlignFields({ form, setters }: CellAlignFieldsProps) {
  const { horizontalAlign, verticalAlign, textBold, textColor, backgroundColor } = form;
  const { setHorizontalAlign, setVerticalAlign } = setters;

  return (
  <div className="mt-6 border-t border-gray-200 pt-6">
    <h3 className="mb-4 text-sm font-medium text-gray-900">컨텐츠 정렬</h3>

    <div className="space-y-4">
      {/* 가로 정렬 */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">가로 정렬</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={horizontalAlign === 'left' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setHorizontalAlign('left')}
            className="flex-1"
          >
            <AlignLeft className="mr-2 h-4 w-4" />
            왼쪽
          </Button>
          <Button
            type="button"
            variant={horizontalAlign === 'center' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setHorizontalAlign('center')}
            className="flex-1"
          >
            <AlignCenter className="mr-2 h-4 w-4" />
            가운데
          </Button>
          <Button
            type="button"
            variant={horizontalAlign === 'right' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setHorizontalAlign('right')}
            className="flex-1"
          >
            <AlignRight className="mr-2 h-4 w-4" />
            오른쪽
          </Button>
        </div>
      </div>

      {/* 세로 정렬 */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">세로 정렬</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={verticalAlign === 'top' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVerticalAlign('top')}
            className="flex-1"
          >
            <AlignVerticalJustifyStart className="mr-2 h-4 w-4" />
            위쪽
          </Button>
          <Button
            type="button"
            variant={verticalAlign === 'middle' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVerticalAlign('middle')}
            className="flex-1"
          >
            <AlignVerticalJustifyCenter className="mr-2 h-4 w-4" />
            가운데
          </Button>
          <Button
            type="button"
            variant={verticalAlign === 'bottom' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVerticalAlign('bottom')}
            className="flex-1"
          >
            <AlignVerticalJustifyEnd className="mr-2 h-4 w-4" />
            아래쪽
          </Button>
        </div>
      </div>

      {/* 미리보기 */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">정렬 미리보기</Label>
        <div className="rounded-lg border bg-gray-50 p-4">
          <div
            className={`flex h-32 w-full rounded border-2 border-dashed border-gray-300 ${
              horizontalAlign === 'left'
                ? 'justify-start'
                : horizontalAlign === 'center'
                  ? 'justify-center'
                  : 'justify-end'
            } ${
              verticalAlign === 'top'
                ? 'items-start'
                : verticalAlign === 'middle'
                  ? 'items-center'
                  : 'items-end'
            }${textBold ? 'font-bold' : ''}`}
            style={{
              ...(backgroundColor ? { backgroundColor } : {}),
              ...(textColor ? { color: textColor } : {}),
            }}
          >
            <div className="rounded bg-blue-500 px-4 py-2 text-sm text-white">컨텐츠</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}
