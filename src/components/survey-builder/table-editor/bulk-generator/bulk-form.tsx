import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { MODE_CONFIG } from './types';

interface BulkFormProps {
  baseLabel: string;
  baseCode: string;
  startNumber: number;
  count: number;
  config: (typeof MODE_CONFIG)[keyof typeof MODE_CONFIG];
  onBaseLabelChange: (v: string) => void;
  onBaseCodeChange: (v: string) => void;
  onStartNumberChange: (v: number) => void;
  onCountChange: (v: number) => void;
}

export function BulkForm({
  baseLabel,
  baseCode,
  startNumber,
  count,
  config,
  onBaseLabelChange,
  onBaseCodeChange,
  onStartNumberChange,
  onCountChange,
}: BulkFormProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs font-medium">기본 라벨</Label>
        <Input
          value={baseLabel}
          onChange={(e) => onBaseLabelChange(e.target.value)}
          placeholder={config.labelPlaceholder}
          className="h-8 text-sm"
          autoFocus
        />
        <p className="text-[10px] text-gray-400">라벨 뒤에 번호가 붙습니다</p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-medium">{config.codeFieldLabel}</Label>
        <Input
          value={baseCode}
          onChange={(e) => onBaseCodeChange(e.target.value)}
          placeholder={config.codePlaceholder}
          className="h-8 text-sm"
        />
        <p className="text-[10px] text-gray-400">코드 뒤에 zero-padding 번호가 붙습니다</p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-medium">시작 번호</Label>
        <Input
          type="number"
          value={startNumber}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v >= 0) onStartNumberChange(v);
          }}
          min={0}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-medium">생성 개수</Label>
        <Input
          type="number"
          value={count ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onCountChange(0);
              return;
            }
            const v = parseInt(raw, 10);
            if (!isNaN(v) && v >= 0) onCountChange(v);
          }}
          min={0}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}
