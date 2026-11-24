'use client';

import { useId } from 'react';

import { SlidersHorizontal } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  DEFAULT_SCALE_SLIDER_DIRECTION,
  SCALE_SLIDER_DIRECTIONS,
  type ScaleSliderDirection,
  isScaleSliderDirection,
} from '@/types/scale-slider';
import type { Question } from '@/types/survey';

/**
 * 문항 설정의 「척도 슬라이더로 그리기」 — 문항의 슬라이더 방향(`scaleSlider`) 한 필드를 적고 지운다
 * (CONTEXT.md 「척도 슬라이더」).
 *
 * ── 배선과 규칙 ──
 * - **값이 있으면 켜진 것이고 그 값이 긍정 방향이다.** 켜면 기본 방향을 적고, 방향을 바꾸면 그 값을 적는다.
 * - **끌 때는 키를 지우지 않고 null 을 적는다.** 문항 부분 수정은 키가 없으면 「그대로 두기」로 읽어, 지우기만
 *   하면 저장본의 방향이 살아남는다.
 * - 폼 값(formData)에만 쓴다 — 저장·취소 복원은 문항 편집 모달의 폼 왕복이 한다(모달의 폼 채우기
 *   `buildFormDataFromQuestion` 이 이 필드를 싣는다). 스토어에 따로 쓰지 않으므로 저장 머지 목록이 필요 없다.
 * - 다른 폼 값은 건드리지 않는다 — 보기 열 배치는 슬라이더로 그리는 동안 읽히지 않을 뿐 값은 남는다
 *   (슬라이더로 그릴 수 없는 문항은 그 배치로 그려진다).
 * - **어느 문항에 보일지는 부르는 쪽이 정한다**(문항 편집의 기본 탭 — 보통 라디오 문항).
 * - 방향은 두 값이라 보이는 native radio 묶음(`fieldset` + `legend`)으로 낸다. 라디오는 보이지 않게 두고
 *   바로 뒤의 라벨이 눌리는 자리다 — 고른 상태는 라디오의 `:checked` 로 칠한다.
 */

const DIRECTION_LABELS: Readonly<Record<ScaleSliderDirection, string>> = {
  'positive-right': '오른쪽이 긍정',
  'positive-left': '왼쪽이 긍정',
};

interface QuestionScaleSliderFieldsProps {
  formData: Partial<Question>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Question>>>;
}

export function QuestionScaleSliderFields({
  formData,
  setFormData,
}: QuestionScaleSliderFieldsProps) {
  const id = useId();
  const direction = isScaleSliderDirection(formData.scaleSlider) ? formData.scaleSlider : null;
  const write = (next: ScaleSliderDirection | null) =>
    setFormData((prev) => ({ ...prev, scaleSlider: next }));

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor={`${id}-switch`} className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            척도 슬라이더로 그리기
          </Label>
          <p id={`${id}-switch-help`} className="text-xs text-gray-500">
            보기를 타일 줄과 트랙으로 그립니다. 웹과 모바일 둘 다에 적용됩니다.
          </p>
        </div>
        <Switch
          id={`${id}-switch`}
          aria-describedby={`${id}-switch-help`}
          checked={direction !== null}
          onCheckedChange={(on) => write(on ? DEFAULT_SCALE_SLIDER_DIRECTION : null)}
        />
      </div>

      {direction !== null && (
        <div className="border-t border-gray-200 pt-3">
          <fieldset
            aria-describedby={`${id}-direction-help`}
            className="m-0 min-w-0 border-0 p-0"
          >
            <legend className="mb-1.5 p-0 text-xs font-medium text-gray-700">긍정 방향</legend>
            <div className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
              {SCALE_SLIDER_DIRECTIONS.map((value) => (
                // relative — 숨긴 라디오가 제 칸 안에 머물러, 포커스가 갈 때 화면이 엉뚱한 곳으로 튀지 않는다
                <span key={value} className="relative">
                  <input
                    type="radio"
                    id={`${id}-${value}`}
                    name={`${id}-direction`}
                    value={value}
                    checked={direction === value}
                    onChange={() => write(value)}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={`${id}-${value}`}
                    className="block cursor-pointer rounded-md border border-transparent px-3 py-1.5 text-xs text-gray-600 transition-colors select-none peer-checked:border-gray-300 peer-checked:bg-white peer-checked:font-semibold peer-checked:text-gray-900 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600 hover:text-gray-900 motion-reduce:transition-none"
                  >
                    {DIRECTION_LABELS[value]}
                  </label>
                </span>
              ))}
            </div>
          </fieldset>
          <p id={`${id}-direction-help`} className="mt-1.5 text-xs text-gray-500">
            부정 쪽은 붉은색, 긍정 쪽은 푸른색으로 칠합니다. 보기의 점수로 추정하지 않으니 1점이
            긍정인 척도는 「왼쪽이 긍정」을 고르세요.
          </p>
        </div>
      )}
    </div>
  );
}
