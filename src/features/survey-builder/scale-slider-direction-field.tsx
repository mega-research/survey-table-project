'use client';

import { useId } from 'react';

import { SCALE_SLIDER_DIRECTIONS, type ScaleSliderDirection } from '@/types/scale-slider';

/**
 * 척도 슬라이더의 「긍정 방향」 고르기 — 슬라이더를 켜는 두 자리(보기 칸 편집의 보기 모양 · 문항 설정의
 * 「척도 슬라이더로 그리기」)가 같은 조각을 쓴다(CONTEXT.md 「척도 슬라이더」).
 *
 * ── 배선과 규칙 ──
 * - 값을 어디에 적는지는 부르는 쪽 몫이다 — 묶음은 보기 모양 쓰기 한 곳(`withChoiceGroupMobileView`), 문항은
 *   폼의 `scaleSlider`. 이 조각은 지금 방향을 보이고 고른 방향을 알릴 뿐이다.
 * - 두 값이라 보이는 native radio 묶음(`fieldset` + `legend`)이다. 라디오는 보이지 않게 두고 바로 뒤의 라벨이
 *   눌리는 자리다 — 고른 상태는 라디오의 `:checked` 로 칠한다.
 * - 색 설명은 묶음의 설명(`aria-describedby`)으로 잇는다. 방향은 색만 정하고 눈금 순서는 그대로다.
 */

const DIRECTION_LABELS: Readonly<Record<ScaleSliderDirection, string>> = {
  'positive-right': '오른쪽이 긍정',
  'positive-left': '왼쪽이 긍정',
};

interface ScaleSliderDirectionFieldProps {
  value: ScaleSliderDirection;
  onChange: (direction: ScaleSliderDirection) => void;
}

export function ScaleSliderDirectionField({ value, onChange }: ScaleSliderDirectionFieldProps) {
  const id = useId();
  return (
    <div>
      <fieldset aria-describedby={`${id}-help`} className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-1.5 p-0 text-xs font-medium text-gray-700">긍정 방향</legend>
        <div className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
          {SCALE_SLIDER_DIRECTIONS.map((direction) => (
            // relative — 숨긴 라디오가 제 칸 안에 머물러, 포커스가 갈 때 화면이 엉뚱한 곳으로 튀지 않는다
            <span key={direction} className="relative">
              <input
                type="radio"
                id={`${id}-${direction}`}
                name={`${id}-direction`}
                value={direction}
                checked={value === direction}
                onChange={() => onChange(direction)}
                className="peer sr-only"
              />
              <label
                htmlFor={`${id}-${direction}`}
                className="block cursor-pointer rounded-md border border-transparent px-3 py-1.5 text-xs text-gray-600 transition-colors select-none peer-checked:border-gray-300 peer-checked:bg-white peer-checked:font-semibold peer-checked:text-gray-900 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600 hover:text-gray-900 motion-reduce:transition-none"
              >
                {DIRECTION_LABELS[direction]}
              </label>
            </span>
          ))}
        </div>
      </fieldset>
      <p id={`${id}-help`} className="mt-1.5 text-xs text-gray-500">
        부정 쪽은 붉은색, 긍정 쪽은 푸른색으로 칠합니다. 보기의 점수로 추정하지 않으니 1점이 긍정인
        척도는 「왼쪽이 긍정」을 고르세요.
      </p>
    </div>
  );
}
