import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface ExcludeFromMeanSwitchProps {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * 「평균에서 제외」 (CONTEXT.md 「척도 평균」) — 보기 칸·행렬 척도 radio 칸 공용.
 * 문항의 「척도 평균에 넣기」가 켜졌을 때만 쓰이지만, 셀 모달은 질문 모달의 편집 중 값을 모르므로
 * 늘 보여 주고 설명으로 범위를 알린다(두 모달이 같은 값을 따로 들고 있으면 저장 때 갈린다).
 */
export function ExcludeFromMeanSwitch({ id, checked, onCheckedChange }: ExcludeFromMeanSwitchProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id} className="text-sm font-medium">
          평균에서 제외
        </Label>
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      </div>
      <p className="text-xs text-gray-500">
        「모름 · 해당 없음」처럼 척도 밖인 칸. 이 칸을 고른 응답은 현황 「척도 평균」의 평균과
        응답수에서 빠집니다. 「척도 평균에 넣기」를 켠 문항에서만 쓰입니다.
      </p>
    </div>
  );
}
