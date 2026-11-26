'use client';

import { useId } from 'react';

import { SlidersHorizontal } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  type QuestionScaleSliderDiagnosis,
  RADIO_SLIDER_CRAMPED_TILE_MIN_TICKS,
} from '@/features/survey-builder/lib/scale-slider-diagnostics';
import { ScaleSliderDirectionField } from '@/features/survey-builder/scale-slider-direction-field';
import {
  ScaleSliderInfoNote,
  ScaleSliderIssueAlert,
} from '@/features/survey-builder/table-editor/scale-slider-guidance';
import {
  DEFAULT_SCALE_SLIDER_DIRECTION,
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
 * - **어느 문항에 보일지는 부르는 쪽이 정한다**(문항 편집의 기본 탭 — 보통 라디오 문항 · 그룹 없는 설명 테이블).
 * - 방향 고르기는 묶음 편집과 같은 조각이다(scale-slider-direction-field).
 * - **경고와 안내는 진단이 정한다**(`diagnosis` — scale-slider-diagnostics 의 `diagnoseQuestionScaleSlider`).
 *   부르는 쪽이 편집 중인 폼 값으로 돌려 넘기고, 이 조각은 켜져 있을 때만 그 결과를 글자로 옮긴다. 못 그리는
 *   것은 경고 상자, 그려지지만 알아 둘 것(휴대폰의 좁은 타일 · 답이 문항에 하나)은 막지 않는 안내 줄이다.
 */

interface QuestionScaleSliderFieldsProps {
  formData: Partial<Question>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Question>>>;
  /** 보기를 설명 테이블로 구성한 문항인가 — 켜면 표가 행 단위로 그려진다는 것을 스위치 설명에 적는다 */
  tableMode?: boolean | undefined;
  /** 편집 중인 문항의 슬라이더 진단. 없으면 경고·안내를 그리지 않는다 */
  diagnosis?: QuestionScaleSliderDiagnosis | undefined;
}

export function QuestionScaleSliderFields({
  formData,
  setFormData,
  tableMode = false,
  diagnosis,
}: QuestionScaleSliderFieldsProps) {
  const id = useId();
  const direction = isScaleSliderDirection(formData.scaleSlider) ? formData.scaleSlider : null;
  const write = (next: ScaleSliderDirection | null) =>
    setFormData((prev) => ({ ...prev, scaleSlider: next }));
  // 문항 설정이 읽히는 문항의 진단만 쓴다. 아래에서 켜져 있을 때만 그리므로 끈 뒤의 진단은 보이지 않는다
  const active = diagnosis && diagnosis.target !== null ? diagnosis : null;

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor={`${id}-switch`} className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            척도 슬라이더로 그리기
          </Label>
          <p id={`${id}-switch-help`} className="text-xs text-gray-500">
            {tableMode
              ? '보기 칸을 행마다 타일 줄과 트랙으로 그립니다. 웹과 모바일 둘 다에 적용되고, 표는 웹에서도 표 대신 행 단위로 그려집니다.'
              : '보기를 타일 줄과 트랙으로 그립니다. 웹과 모바일 둘 다에 적용됩니다.'}
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
        <div className="space-y-2 border-t border-gray-200 pt-3">
          <ScaleSliderDirectionField value={direction} onChange={write} />
          {active && (
            <ScaleSliderIssueAlert
              kind={active.target === 'choice-table' ? 'table' : 'radio-options'}
              issues={active.issues}
              drawsNothing={active.drawsNothing}
            />
          )}
          {active?.crampedNarrowTiles && (
            <ScaleSliderInfoNote>
              눈금이 {RADIO_SLIDER_CRAMPED_TILE_MIN_TICKS}개 이상이라 휴대폰에서는 타일 글자가 잘게
              끊깁니다. 보기 라벨이 짧을수록 덜합니다.
            </ScaleSliderInfoNote>
          )}
          {active?.sharedAnswerRows && (
            <ScaleSliderInfoNote>
              보기 그룹이 없는 표는 행이 여럿이어도 답이 문항에 하나입니다 — 한 행을 답하면 다른 행의
              손잡이가 사라집니다. 행마다 따로 답받으려면 행마다 보기 그룹을 만들고, 보기 칸 편집의
              보기 모양에서 「척도 슬라이더」를 고르세요.
            </ScaleSliderInfoNote>
          )}
        </div>
      )}
    </div>
  );
}
