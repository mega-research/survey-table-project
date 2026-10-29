'use client';

import { History } from 'lucide-react';

import { CHANGE_CONFIRM_VALUES, type ChangeConfirmation } from '@/lib/survey/change-confirmation';
import { DEFAULT_PRIOR_WAVE_LABEL } from '@/lib/survey/prior-answers';
import { VALIDATION_NOTICE_ATTRIBUTE } from '@/features/question-renderer/scroll-to-issue';
import { useInlineSurveyLocale } from '@/features/question-renderer/survey-locale-context';
import type { SurveyLocale } from '@/types/survey-locale';
import { systemText } from '@/utils/system-strings';

/** 변동 확인을 밝히지 않은 채 다음을 눌렀을 때 문항에 붙는 안내(한국어). 화면은 현재 언어로 그린다. */
export const CHANGE_CONFIRM_REQUIRED_MESSAGE = systemText('tracking.required');

/**
 * 화면에 쓸 회차 라벨 — 설문 설정이 비어 기본 라벨로 떨어졌으면 그 기본 라벨만 현재 언어로 바꾼다.
 * 저작자가 적은 라벨은 그대로다(다국어가 아니면 「지난 회차」 그대로).
 */
export function localizedWaveLabel(waveLabel: string, locale: SurveyLocale): string {
  return waveLabel === DEFAULT_PRIOR_WAVE_LABEL
    ? systemText('tracking.defaultWaveLabel', locale)
    : waveLabel;
}

const OPTION_BASE =
  'cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors md:text-xs' +
  ' peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-1';
const OPTION_SELECTED = 'border-blue-600 bg-blue-600 text-white';
const OPTION_IDLE =
  'border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-700';

/**
 * 추적조사 변동 확인 컨트롤 — 이월 값이 있는 문항에만 붙는다.
 *
 * 응답 필수 여부와 별개 축이다. 이 선택이 없으면 아무도 들여다보지 않은 지난 회차
 * 값이 올해 응답으로 나가버리므로, 필수가 아닌 문항에서도 선택을 요구한다.
 *
 * 네이티브 radio 입력을 숨겨 쓰는 이유는 화살표 키 이동·그룹 포커스 같은 라디오
 * 의미론을 브라우저에서 그대로 받기 위함이다 (button + role="radio" 는 roving
 * tabindex 를 직접 구현해야 한다).
 */
export function ChangeConfirmControl({
  questionId,
  waveLabel,
  value,
  onSelect,
  showRequiredMessage,
}: {
  questionId: string;
  /** 설문 설정의 지난 회차 라벨 — 라벨이 비면 호출부가 기본 문구로 채워 넘긴다. */
  waveLabel: string;
  value: ChangeConfirmation | null;
  onSelect: (value: ChangeConfirmation) => void;
  showRequiredMessage: boolean;
}) {
  const locale = useInlineSurveyLocale();
  const wave = localizedWaveLabel(waveLabel, locale);
  const labels: Record<ChangeConfirmation, string> = {
    same: systemText('tracking.same', locale, { wave }),
    changed: systemText('tracking.changed', locale),
  };
  return (
    <div className="px-1">
      <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="break-keep">{systemText('tracking.prefilled', locale, { wave })}</span>
        </div>
        <fieldset className="mt-2 flex flex-wrap gap-2">
          <legend className="sr-only">{systemText('tracking.legend', locale, { wave })}</legend>
          {CHANGE_CONFIRM_VALUES.map((option) => (
            <label key={option} className="inline-flex">
              <input
                type="radio"
                className="peer sr-only"
                name={`change-confirm-${questionId}`}
                value={option}
                checked={value === option}
                onChange={() => onSelect(option)}
              />
              <span
                className={`${OPTION_BASE} ${value === option ? OPTION_SELECTED : OPTION_IDLE}`}
              >
                {labels[option]}
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      {showRequiredMessage && (
        <p
          {...{ [VALIDATION_NOTICE_ATTRIBUTE]: questionId }}
          className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {systemText('tracking.required', locale)}
        </p>
      )}
    </div>
  );
}
