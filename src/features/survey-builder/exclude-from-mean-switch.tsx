import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface ExcludeFromMeanSwitchProps {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /**
   * 척도 슬라이더의 대상이 될 수 있는 칸(보기 칸)인가 — 켜면 「척도 슬라이더에서는 체크로 떨어진다」를 함께
   * 적는다. 행렬 척도 radio 칸은 슬라이더 대상이 아니라 켜지 않는다.
   */
  scaleSliderNote?: boolean | undefined;
}

/**
 * 「평균에서 제외」 (CONTEXT.md 「척도 평균」) — 보기 칸·행렬 척도 radio 칸 공용.
 * 문항이 척도 평균에 들어갔을 때만(현황 「문항 선택」) 쓰이지만, 셀 모달은 질문 모달의 편집 중 값을 모르므로
 * 늘 보여 주고 설명으로 범위를 알린다(두 모달이 같은 값을 따로 들고 있으면 저장 때 갈린다).
 *
 * 이 표시는 두 가지 일을 한다 — 척도 평균에서 빼기와, 척도 슬라이더에서 눈금이 아닌 체크로 떼기
 * (CONTEXT.md 「척도 슬라이더」). 슬라이더 쪽 문구도 같은 이유로 그룹의 보기 모양과 무관하게 늘 적는다.
 */
export function ExcludeFromMeanSwitch({
  id,
  checked,
  onCheckedChange,
  scaleSliderNote = false,
}: ExcludeFromMeanSwitchProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id} className="text-sm font-medium">
          평균에서 제외
        </Label>
        <Switch
          id={id}
          aria-describedby={`${id}-help`}
          checked={checked}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id={`${id}-help`} className="text-xs text-gray-500">
        「모름 · 해당 없음」처럼 척도 밖인 칸. 이 칸을 고른 응답은 현황 「척도 평균」의 평균과
        응답수에서 빠집니다. 현황 「척도 평균」에서 고른 문항에서만 쓰입니다.
        {scaleSliderNote
          ? ' 척도 슬라이더에서는 눈금이 아니라 트랙 옆 체크로 떨어집니다.'
          : null}
      </p>
    </div>
  );
}
