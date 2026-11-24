'use client';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { ScaleSlider } from '@/features/question-renderer/scale-slider';
import { projectRadioQuestionScaleSlider } from '@/features/question-renderer/utils/radio-option-scale-slider';
import type { ScaleSliderModel } from '@/features/question-renderer/utils/scale-slider';
import { useMobileView } from '@/hooks/use-media-query';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { Question } from '@/types/survey';

/**
 * 라디오 문항을 척도 슬라이더로 그리는 조각 — 보통 라디오 문항(보기 목록, 표 없음)의 호스트다
 * (CONTEXT.md 「척도 슬라이더」).
 *
 * ── 배선과 규칙 ──
 * - **응답 화면의 라디오 문항(survey-response/question-input)과 빌더 미리보기 카드
 *   (survey-builder/question-list/question-test-card) 둘이 이 조각을 부른다.** 두 곳은 보기 목록을 따로
 *   그리지만, 슬라이더로 그릴지와 무엇을 그릴지는 여기 한 곳에서 정해 판정이 갈리지 않는다.
 * - 쓰는 법은 두 단계다. 호스트가 `useRadioQuestionScaleSlider(question)` 로 모델을 얻고, **null 이면 지금
 *   보기 목록을 그대로 그린다**(설정이 꺼졌거나 폴백 — 열 배치·상세 기재 입력칸까지 한 글자도 달라지지
 *   않는다). 모델이 있으면 `RadioQuestionScaleSlider` 에 넘긴다.
 * - 그릴지는 라디오 보기 투영(utils/radio-option-scale-slider)이 정한다. 여기서는 명단 값·인용으로 라벨의
 *   토큰을 풀어 넘기기만 한다.
 * - **선택 쓰기는 호스트의 기존 변경 처리다**(`onToggleOption`) — 고른 것을 다시 누르면 비움, 잠금이면
 *   무시는 그쪽 규칙이다. 이 조각은 슬라이더가 넘긴 보기 id 를 보기 value 로 바꿔 부르기만 한다.
 *   **값은 달라지지 않는다** — 쓰이는 것은 보기 목록에서 누른 것과 같은 보기 value 다.
 * - **프리필 잠금**(`locked`)은 호스트의 기존 판정을 모든 보기의 비활성으로 넘긴다. 이월 잠금은 문항을 감싼
 *   `fieldset disabled` 가 슬라이더 안쪽 native radio 에 그대로 먹는다 — 잠금 prop 을 따로 뚫지 않는다.
 * - 슬라이더로 그리는 동안 보기 열 배치 설정(웹·모바일)과 보기에 지정한 배경색·글자색은 읽지 않는다.
 * - 문항 제목은 문항 카드가 이미 그리므로 머리 줄(`label`)은 비우고 낭독용 이름으로만 넘긴다.
 * - 좁은 화면 판정은 기존 모바일 판정(`useMobileView`)이다. 두 호스트가 같은 값을 쓰도록 여기서 읽는다.
 */

/**
 * 이 문항을 슬라이더로 그릴 모델 — **null 이면 호스트가 지금 보기 목록을 그대로 그린다**(설정이 없거나,
 * 라디오 문항이 아니거나, 그릴 수 없는 보기가 있다).
 */
export function useRadioQuestionScaleSlider(question: Question): ScaleSliderModel | null {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const projection = projectRadioQuestionScaleSlider(question, (label) =>
    substituteTokens(label, attrs, quotes),
  );
  return projection?.ok ? projection.model : null;
}

export interface RadioQuestionScaleSliderProps {
  question: Question;
  /** `useRadioQuestionScaleSlider` 가 돌려준 모델 */
  model: ScaleSliderModel;
  /** 고른 보기의 value — 없으면 답하기 전이다 */
  selectedValue: string | null;
  /** 문항의 기존 변경 처리 — 보기 목록에서 그 보기를 눌렀을 때 부르던 것 그대로 */
  onToggleOption: (optionValue: string, optionId: string) => void;
  /** 프리필 잠금 — 호스트의 기존 판정. 모든 보기를 비활성으로 넘긴다 */
  locked?: boolean | undefined;
}

export function RadioQuestionScaleSlider({
  question,
  model,
  selectedValue,
  onToggleOption,
  locked,
}: RadioQuestionScaleSliderProps) {
  const narrow = useMobileView();
  const options = question.options ?? [];

  const selectedChoiceId =
    selectedValue === null
      ? undefined
      : options.find((option) => option.value === selectedValue)?.id;
  const disabledChoiceIds = locked ? new Set(options.map((option) => option.id)) : undefined;

  const handleToggleChoice = (choiceId: string) => {
    const option = options.find((candidate) => candidate.id === choiceId);
    if (option) onToggleOption(option.value, option.id);
  };

  return (
    <ScaleSlider
      questionId={question.id}
      sliderId={question.id}
      model={model}
      label=""
      ariaLabel={question.title}
      selectedChoiceId={selectedChoiceId}
      onToggleChoice={handleToggleChoice}
      disabledChoiceIds={disabledChoiceIds}
      narrow={narrow}
    />
  );
}
