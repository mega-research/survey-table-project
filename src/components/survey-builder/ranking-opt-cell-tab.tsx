'use client';

import { Tag } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface RankingOptCellTabProps {
  rankingLabel: string;
  onRankingLabelChange: (v: string) => void;
  spssNumericCode: number | '';
  onSpssNumericCodeChange: (v: number | '') => void;
  isOtherRankingCell: boolean;
  onIsOtherRankingCellChange: (v: boolean) => void;
}

/**
 * cell-content-modal 의 '순위 옵션' (Case 2 ranking_opt) 탭 내용.
 * 이 셀은 다른 랭킹 질문의 옵션 소스로만 사용됨 — 응답을 받지 않음.
 */
export function RankingOptCellTab({
  rankingLabel,
  onRankingLabelChange,
  spssNumericCode,
  onSpssNumericCodeChange,
  isOtherRankingCell,
  onIsOtherRankingCellChange,
}: RankingOptCellTabProps) {
  const isOther = isOtherRankingCell === true;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-start gap-2">
          <Tag className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-900">순위 옵션 소스 (Case 2)</p>
            <p className="mt-1 text-xs text-blue-700">
              이 셀은 다른 랭킹 질문의 옵션으로만 사용됩니다. 응답자는 이 셀에 직접 입력하지 않고,
              랭킹 질문에서 이 셀의 라벨/이미지를 선택합니다.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label className="text-sm font-medium">이 셀을 &quot;기타&quot;로 사용</Label>
        <Switch checked={isOther} onCheckedChange={onIsOtherRankingCellChange} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ranking-opt-label" className="text-sm font-medium">
          옵션 라벨 (선택)
        </Label>
        <Input
          id="ranking-opt-label"
          value={rankingLabel}
          onChange={(e) => onRankingLabelChange(e.target.value)}
          placeholder={
            isOther
              ? '(기타 모드: 드롭다운 라벨은 위 "셀 텍스트 내용" 우선, 없으면 "기타 (직접 입력)")'
              : '옵션 라벨 (비워두면 상단의 셀 텍스트 내용이 사용됨)'
          }
          disabled={isOther}
        />
        <p className="text-xs text-gray-500">
          이미지/비디오 셀이면 라벨을 명시적으로 지정하는 것을 권장합니다. 비워두면 상단 &quot;셀
          텍스트 내용&quot; 이 옵션 라벨로 사용됩니다.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ranking-opt-spss-code" className="text-sm font-medium">
          응답값 (선택)
        </Label>
        <Input
          id="ranking-opt-spss-code"
          type="number"
          inputMode="numeric"
          value={isOther ? '' : spssNumericCode}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') {
              onSpssNumericCodeChange('');
            } else {
              const n = parseInt(v, 10);
              if (!Number.isNaN(n)) onSpssNumericCodeChange(n);
            }
          }}
          placeholder={
            isOther
              ? '(기타 모드에서는 사용되지 않음 — system-missing)'
              : '(비워두면 자동: 수집 순서 기반 1-based 인덱스)'
          }
          className="w-64"
          disabled={isOther}
        />
        <p className="text-xs text-gray-500">
          소스 테이블에서 이 셀이 랭킹 옵션으로 쓰일 때 SPSS 변수의 값으로 기록됩니다. 셀 순서가
          바뀌어도 값이 유지되길 원하면 명시적으로 지정하세요.
        </p>
      </div>
    </div>
  );
}
