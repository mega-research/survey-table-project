import { type ScaleSliderDirection, isScaleSliderDirection } from '@/types/scale-slider';
import type { Question, QuestionOption } from '@/types/survey';
import { isChoiceTableSource } from '@/utils/choice-source';

import { normalizeScaleLabel } from './scale-header-reading';
import {
  SCALE_SLIDER_MAX_TICKS,
  SCALE_SLIDER_MIN_TICKS,
  type ScaleSliderOffScaleChoice,
  type ScaleSliderProjection,
  type ScaleSliderTick,
  resolveScaleSliderSide,
} from './scale-slider';

/**
 * 라디오 보기 투영 — 보통 라디오 문항(보기 목록, 표 없음)의 보기를 **척도 슬라이더** 모델로 옮긴다
 * (CONTEXT.md 「척도 슬라이더」). 표의 투영(scale-slider)과 같은 모델·같은 폴백 어휘를 내므로 컴포넌트와
 * 빌더 경고가 둘을 가리지 않는다. 라디오 문항을 슬라이더로 그릴지의 유일한 판정 지점이다 — 응답 화면과
 * 빌더 미리보기 카드가 같은 조각(radio-question-scale-slider)을 거쳐 이 함수를 부른다.
 *
 * ── 배선과 규칙 ──
 * - **보기 하나가 눈금 하나**다. 이름은 보기 라벨이고 눈금 글자·구간이 없어 언제나 점 타일이다
 *   (`bands` 없음 · `bandsCoverAllTicks: false` · 고른 값 표시 없음). 번호뿐인 라벨(「1」)도 그대로 이름이다 —
 *   보기 목록에는 머리가 없어 다른 이름이 올 곳이 없다.
 * - **고르는 것의 id 는 보기 id 다**(`choiceId`). 저장되는 값은 보기 value 이고 그 변환은 조각이 한다 —
 *   value 는 저작 중 겹칠 수 있어 입력 id·키로 쓰지 않는다. **값은 건드리지 않는다.**
 * - 「평균에서 제외」(`excludeFromMean`) 보기는 척도 밖 보기(트랙 옆 체크)다. 표와 달리 열이 없으므로
 *   보기 목록의 어느 자리에 있어도 떨어진다 — 눈금과 척도 밖 보기는 각자 목록 순서를 지킨다.
 * - **쪽**은 척도 밖 보기를 뺀 눈금 줄의 정가운데 기준이고 표의 투영과 같은 계산을 쓴다.
 * - **폴백**(표의 투영과 같은 순서): 눈금 수가 2~13 밖(`cell-count`) → 상세 기재가 붙은 보기, 옛 「기타」
 *   보기 포함(`text-input`) → 라벨이 빈 보기(`missing-text`). 라디오 보기에는 보기별 표시 조건이 없어
 *   그 폴백은 없다. 폴백이면 호출부가 지금 보기 목록 그대로 그린다(열 배치·상세 기재 입력칸 포함).
 * - **라벨의 토큰**은 호출부가 넘긴 함수로 푼다(`resolveLabel`) — 푼 뒤에 빈 글자인지를 본다. 빌더 경고처럼
 *   명단 값이 없는 자리는 넘기지 않으면 되고, 그때는 적힌 글자 그대로 판정한다.
 * - **문항 설정을 읽는 문은 `projectRadioQuestionScaleSlider` 하나다.** 방향이 적힌 **보통 라디오 문항**만
 *   대상이다 — 서버는 유형과 무관하게 값을 저장하므로 읽는 쪽이 거른다. 빌더 스토어에는 「끄기」로 null 이
 *   올 수 있어 켜졌는지는 어휘 검사로 본다. 보기를 표 칸에서 가져오는 라디오 문항은 여기 대상이 아니다
 *   (그 표의 호스트가 표의 투영으로 읽는다).
 */

/** 옛 「기타」 보기의 고정 id — 빌더가 만들던 매직 id 이고, 고르면 입력칸이 따라붙는다 */
const LEGACY_OTHER_OPTION_ID = 'other-option';

export interface ProjectRadioOptionScaleSliderInput {
  /** 문항의 보기 목록 — 목록 순서가 눈금 순서다 */
  options: readonly QuestionOption[] | undefined;
  /** 긍정 방향 — 문항의 슬라이더 방향 값 */
  direction: ScaleSliderDirection;
  /** 라벨의 토큰을 푸는 함수 — 응답 화면이 명단 값·인용으로 넘긴다. 없으면 적힌 글자 그대로 */
  resolveLabel?: ((label: string) => string) | undefined;
}

export function projectRadioOptionScaleSlider(
  input: ProjectRadioOptionScaleSliderInput,
): ScaleSliderProjection {
  const { direction } = input;
  const options = input.options ?? [];
  const tickOptions = options.filter((option) => option.excludeFromMean !== true);
  const offScaleOptions = options.filter((option) => option.excludeFromMean === true);

  const count = tickOptions.length;
  if (count < SCALE_SLIDER_MIN_TICKS || count > SCALE_SLIDER_MAX_TICKS) {
    return { ok: false, reason: 'cell-count' };
  }
  if (
    options.some(
      (option) => option.allowTextInput === true || option.id === LEGACY_OTHER_OPTION_ID,
    )
  ) {
    return { ok: false, reason: 'text-input' };
  }

  const labelOf = (option: QuestionOption) =>
    normalizeScaleLabel(input.resolveLabel ? input.resolveLabel(option.label) : option.label);

  const ticks: ScaleSliderTick[] = [];
  for (const [index, option] of tickOptions.entries()) {
    const label = labelOf(option);
    if (label === '') return { ok: false, reason: 'missing-text' };
    ticks.push({
      choiceId: option.id,
      text: label,
      name: label,
      side: resolveScaleSliderSide(2 * index, count, direction),
      bandIndex: null,
    });
  }

  const offScale: ScaleSliderOffScaleChoice[] = [];
  for (const option of offScaleOptions) {
    const label = labelOf(option);
    if (label === '') return { ok: false, reason: 'missing-text' };
    offScale.push({ choiceId: option.id, label });
  }

  return {
    ok: true,
    model: {
      tileKind: 'point',
      ticks,
      bands: [],
      offScale,
      showsSelectionLabel: false,
      bandsCoverAllTicks: false,
    },
  };
}

/**
 * 문항 설정을 읽어 투영한다. **대상이 아니면 null** — 방향이 없거나(키 없음·null·어휘 밖), 라디오가
 * 아니거나, 보기를 표 칸에서 가져오는 문항이다. 대상이면 모델 또는 폴백 이유다.
 */
export function projectRadioQuestionScaleSlider(
  question: Question,
  resolveLabel?: (label: string) => string,
): ScaleSliderProjection | null {
  if (question.type !== 'radio') return null;
  const direction = question.scaleSlider;
  if (!isScaleSliderDirection(direction)) return null;
  if (isChoiceTableSource(question)) return null;
  return projectRadioOptionScaleSlider({ options: question.options, direction, resolveLabel });
}
