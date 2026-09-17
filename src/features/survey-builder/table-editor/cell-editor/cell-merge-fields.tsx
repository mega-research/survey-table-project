'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import type { CellFormSetters, UseCellFormResult } from './hooks/use-cell-form';

interface CellMergeFieldsProps {
  form: UseCellFormResult['form'];
  setters: CellFormSetters;
}

/** cell-content-modal 의 '셀 병합' 구획. 상태는 모달이 그대로 들고 있다. */
export function CellMergeFields({ form, setters }: CellMergeFieldsProps) {
  const { isMergeEnabled, rowspan, colspan } = form;
  const { setIsMergeEnabled, setRowspan, setColspan } = setters;

  return (
  <div className="mt-6 border-t border-gray-200 pt-6">
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-sm font-medium text-gray-900">셀 병합</h3>
      <div className="flex items-center gap-2">
        <Label htmlFor="merge-toggle" className="cursor-pointer text-sm text-gray-600">
          {isMergeEnabled ? '활성화됨' : '비활성화됨'}
        </Label>
        <Switch
          id="merge-toggle"
          checked={isMergeEnabled}
          onCheckedChange={(checked) => {
            setIsMergeEnabled(checked);
            if (!checked) {
              setRowspan(1);
              setColspan(1);
            } else {
              // 토글 켤 때 빈 값이면 1로 설정
              if (rowspan === '') setRowspan(1);
              if (colspan === '') setColspan(1);
            }
          }}
        />
      </div>
    </div>

    {isMergeEnabled && (
      <>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="rowspan">행 병합 (세로로 아래)</Label>
            <Input
              id="rowspan"
              type="number"
              min={1}
              value={rowspan}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  setRowspan('');
                } else {
                  const num = parseInt(value);
                  if (!isNaN(num) && num >= 1) {
                    setRowspan(num);
                  }
                }
              }}
              onBlur={() => {
                if (rowspan === '') {
                  setRowspan(1);
                }
              }}
              className="w-full"
              placeholder="1"
            />
            <p className="text-xs text-gray-500">
              현재: {rowspan === '' || rowspan === 1 ? '병합 안 함' : `${rowspan}칸 병합`}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="colspan">열 병합 (가로로 우측)</Label>
            <Input
              id="colspan"
              type="number"
              min={1}
              value={colspan}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  setColspan('');
                } else {
                  const num = parseInt(value);
                  if (!isNaN(num) && num >= 1) {
                    setColspan(num);
                  }
                }
              }}
              onBlur={() => {
                if (colspan === '') {
                  setColspan(1);
                }
              }}
              className="w-full"
              placeholder="1"
            />
            <p className="text-xs text-gray-500">
              현재: {colspan === '' || colspan === 1 ? '병합 안 함' : `${colspan}칸 병합`}
            </p>
          </div>
        </div>

        {((typeof rowspan === 'number' && rowspan > 1) ||
          (typeof colspan === 'number' && colspan > 1)) && (
          <div className="mt-3 rounded-lg bg-yellow-50 p-3">
            <p className="text-xs text-yellow-800">
              <strong>주의:</strong> 셀을 병합하면 오른쪽/아래에 있는 셀들이 자동으로
              숨겨집니다. 병합된 영역만큼의 공간이 필요하므로 테이블 구조를 미리 확인하세요.
            </p>
          </div>
        )}
      </>
    )}
  </div>
  );
}
