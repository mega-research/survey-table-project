import { describe, expect, it } from 'vitest';

import {
  projectRadioOptionScaleSlider,
  projectRadioQuestionScaleSlider,
} from '@/features/question-renderer/utils/radio-option-scale-slider';
import type { ScaleSliderModel } from '@/features/question-renderer/utils/scale-slider';
import type { ScaleSliderDirection } from '@/types/scale-slider';
import type { Question, QuestionOption } from '@/types/survey';

/**
 * 라디오 보기 투영 — 보통 라디오 문항의 보기 목록을 척도 슬라이더 모델로 옮긴다
 * (CONTEXT.md 「척도 슬라이더」). 표의 투영(utils/scale-slider)과 같은 모델을 낸다.
 */

const option = (n: number, extra: Partial<QuestionOption> = {}): QuestionOption => ({
  id: `o${n}`,
  label: `보기 ${n}`,
  value: String(n),
  ...extra,
});

const FIVE: QuestionOption[] = [
  { id: 'o1', label: '전혀 없다', value: '1' },
  { id: 'o2', label: '없다', value: '2' },
  { id: 'o3', label: '보통이다', value: '3' },
  { id: 'o4', label: '있다', value: '4' },
  { id: 'o5', label: '매우 있다', value: '5' },
];

const modelOf = (
  options: QuestionOption[],
  direction: ScaleSliderDirection = 'positive-right',
) => {
  const projection = projectRadioOptionScaleSlider({ options, direction });
  if (!projection.ok) throw new Error(`폴백: ${projection.reason}`);
  return projection.model;
};

describe('projectRadioOptionScaleSlider — 눈금', () => {
  it('보기 5개는 점 타일 5장이다 — 보기 하나가 눈금 하나, 이름은 보기 라벨', () => {
    const model = modelOf(FIVE);
    expect(model.tileKind).toBe('point');
    expect(model.ticks.map((tick) => tick.name)).toEqual([
      '전혀 없다',
      '없다',
      '보통이다',
      '있다',
      '매우 있다',
    ]);
    // 고르는 것의 id 는 보기 id 다 — 보기 value 는 겹칠 수 있다
    expect(model.ticks.map((tick) => tick.choiceId)).toEqual(['o1', 'o2', 'o3', 'o4', 'o5']);
  });

  it('눈금 글자와 구간이 없다 — 언제나 점 타일이고 고른 값 표시를 쓰지 않는다', () => {
    const model = modelOf(FIVE);
    expect(model.ticks.every((tick) => tick.mark === undefined)).toBe(true);
    expect(model.ticks.every((tick) => tick.bandIndex === null)).toBe(true);
    expect(model.bands).toEqual([]);
    expect(model.showsSelectionLabel).toBe(false);
    expect(model.bandsCoverAllTicks).toBe(false);
    expect(model.offScale).toEqual([]);
  });

  it('번호뿐인 라벨도 점 타일의 이름이다 — 보기 목록에는 머리가 없어 다른 이름이 없다', () => {
    const model = modelOf([1, 2, 3, 4, 5].map((n) => option(n, { label: String(n) })));
    expect(model.tileKind).toBe('point');
    expect(model.ticks.map((tick) => tick.name)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('여러 줄 라벨은 한 줄로 이어 붙인다', () => {
    const model = modelOf([option(1, { label: '전혀\n그렇지 않다' }), option(2)]);
    expect(model.ticks[0]!.name).toBe('전혀 그렇지 않다');
  });

  it('토큰을 푸는 함수를 받으면 푼 글자가 이름이다', () => {
    const projection = projectRadioOptionScaleSlider({
      options: [option(1, { label: '{{회사명}} 불만족' }), option(2, { label: '{{회사명}} 만족' })],
      direction: 'positive-right',
      resolveLabel: (raw) => raw.replace('{{회사명}}', '메가'),
    });
    expect(projection.ok && projection.model.ticks.map((tick) => tick.name)).toEqual([
      '메가 불만족',
      '메가 만족',
    ]);
  });
});

describe('projectRadioOptionScaleSlider — 쪽', () => {
  it('오른쪽이 긍정이면 왼쪽 절반이 부정, 한가운데가 중립, 오른쪽 절반이 긍정이다', () => {
    expect(modelOf(FIVE).ticks.map((tick) => tick.side)).toEqual([
      'negative',
      'negative',
      'neutral',
      'positive',
      'positive',
    ]);
  });

  it('왼쪽이 긍정이면 뒤집힌다 — 눈금 순서는 그대로다', () => {
    const model = modelOf(FIVE, 'positive-left');
    expect(model.ticks.map((tick) => tick.side)).toEqual([
      'positive',
      'positive',
      'neutral',
      'negative',
      'negative',
    ]);
    expect(model.ticks.map((tick) => tick.choiceId)).toEqual(['o1', 'o2', 'o3', 'o4', 'o5']);
  });

  it('눈금이 짝수면 중립이 없다', () => {
    const model = modelOf([1, 2, 3, 4].map((n) => option(n)));
    expect(model.ticks.map((tick) => tick.side)).toEqual([
      'negative',
      'negative',
      'positive',
      'positive',
    ]);
  });

  it('쪽은 척도 밖 보기를 뺀 눈금만으로 가른다', () => {
    const model = modelOf([...FIVE, option(9, { label: '잘 모르겠다', excludeFromMean: true })]);
    expect(model.ticks.map((tick) => tick.side)).toEqual([
      'negative',
      'negative',
      'neutral',
      'positive',
      'positive',
    ]);
  });
});

describe('projectRadioOptionScaleSlider — 척도 밖 보기', () => {
  it('「평균에서 제외」 보기는 눈금이 아니라 척도 밖 보기다', () => {
    const model = modelOf([...FIVE, option(9, { label: '잘 모르겠다', excludeFromMean: true })]);
    expect(model.ticks).toHaveLength(5);
    expect(model.offScale).toEqual([{ choiceId: 'o9', label: '잘 모르겠다' }]);
  });

  it('보기 목록의 어느 자리에 있어도 떨어지고, 눈금과 척도 밖 보기는 각자 목록 순서를 지킨다', () => {
    const model = modelOf([
      option(8, { label: '해당 없음', excludeFromMean: true }),
      option(1),
      option(2),
      option(9, { label: '모름', excludeFromMean: true }),
      option(3),
    ]);
    expect(model.ticks.map((tick) => tick.choiceId)).toEqual(['o1', 'o2', 'o3']);
    expect(model.offScale.map((choice) => choice.choiceId)).toEqual(['o8', 'o9']);
  });

  it('눈금 수는 척도 밖 보기를 세지 않는다 — 눈금 13개와 척도 밖 보기 하나는 그린다', () => {
    const options = [
      ...Array.from({ length: 13 }, (_, i) => option(i + 1)),
      option(99, { label: '모름', excludeFromMean: true }),
    ];
    expect(projectRadioOptionScaleSlider({ options, direction: 'positive-right' }).ok).toBe(true);
  });
});

describe('projectRadioOptionScaleSlider — 폴백', () => {
  const reasonOf = (options: QuestionOption[] | undefined) => {
    const projection = projectRadioOptionScaleSlider({ options, direction: 'positive-right' });
    return projection.ok ? 'ok' : projection.reason;
  };

  it('상세 기재가 붙은 보기가 있으면 폴백이다', () => {
    expect(reasonOf([...FIVE, option(6, { label: '기타', allowTextInput: true })])).toBe(
      'text-input',
    );
  });

  it('척도 밖 보기에 상세 기재가 붙어도 폴백이다 — 체크에도 입력칸을 붙일 수 없다', () => {
    expect(
      reasonOf([...FIVE, option(6, { label: '기타', allowTextInput: true, excludeFromMean: true })]),
    ).toBe('text-input');
  });

  it('옛 「기타」 보기가 있으면 폴백이다', () => {
    expect(reasonOf([...FIVE, { id: 'other-option', label: '기타', value: 'other' }])).toBe(
      'text-input',
    );
  });

  it('보기 14개는 폴백이고 13개는 그린다', () => {
    expect(reasonOf(Array.from({ length: 14 }, (_, i) => option(i + 1)))).toBe('cell-count');
    expect(reasonOf(Array.from({ length: 13 }, (_, i) => option(i + 1)))).toBe('ok');
  });

  it('눈금이 2개 미만이면 폴백이고 2개면 그린다', () => {
    expect(reasonOf([option(1)])).toBe('cell-count');
    expect(reasonOf([option(1), option(9, { excludeFromMean: true })])).toBe('cell-count');
    expect(reasonOf([])).toBe('cell-count');
    expect(reasonOf(undefined)).toBe('cell-count');
    expect(reasonOf([option(1), option(2)])).toBe('ok');
  });

  it('라벨이 빈 보기가 있으면 폴백이다 — 이름 없는 타일·글자 없는 체크를 내지 않는다', () => {
    expect(reasonOf([option(1), option(2, { label: '  ' }), option(3)])).toBe('missing-text');
    expect(reasonOf([option(1), option(2), option(9, { label: '', excludeFromMean: true })])).toBe(
      'missing-text',
    );
  });

  it('토큰을 풀고 나서 빈 라벨도 폴백이다', () => {
    const projection = projectRadioOptionScaleSlider({
      options: [option(1, { label: '{{없는 값}}' }), option(2)],
      direction: 'positive-right',
      resolveLabel: (raw) => raw.replace('{{없는 값}}', ''),
    });
    expect(projection).toEqual({ ok: false, reason: 'missing-text' });
  });
});

describe('projectRadioQuestionScaleSlider — 문항 설정을 읽는 문', () => {
  const question = (extra: Partial<Question> = {}): Question =>
    ({
      id: 'q1',
      type: 'radio',
      title: '추천 의향',
      required: false,
      order: 0,
      options: FIVE,
      ...extra,
    }) as unknown as Question;

  const modelOrNull = (q: Question): ScaleSliderModel | 'fallback' | null => {
    const projection = projectRadioQuestionScaleSlider(q);
    if (projection === null) return null;
    return projection.ok ? projection.model : 'fallback';
  };

  it('방향이 적힌 보통 라디오 문항은 그 방향으로 투영한다', () => {
    const right = modelOrNull(question({ scaleSlider: 'positive-right' }));
    const left = modelOrNull(question({ scaleSlider: 'positive-left' }));
    expect((right as ScaleSliderModel).ticks[0]!.side).toBe('negative');
    expect((left as ScaleSliderModel).ticks[0]!.side).toBe('positive');
  });

  it('설정이 없으면 대상이 아니다 — 키가 없을 때와 빌더가 끈 null 둘 다', () => {
    expect(modelOrNull(question())).toBeNull();
    expect(modelOrNull(question({ scaleSlider: null }))).toBeNull();
  });

  it('어휘에 없는 값은 꺼진 것으로 읽는다', () => {
    expect(modelOrNull(question({ scaleSlider: 'sideways' as never }))).toBeNull();
  });

  it('라디오가 아닌 유형은 값이 실려 있어도 대상이 아니다', () => {
    expect(
      modelOrNull(question({ type: 'checkbox', scaleSlider: 'positive-right' } as never)),
    ).toBeNull();
    expect(
      modelOrNull(question({ type: 'select', scaleSlider: 'positive-right' } as never)),
    ).toBeNull();
  });

  it('보기를 표 칸에서 가져오는 라디오 문항은 대상이 아니다 — 그 표는 표의 투영이 읽는다', () => {
    const tableSource = question({
      scaleSlider: 'positive-right',
      tableColumns: [{ id: 'c1', label: '선택' }],
      tableRowsData: [
        { id: 'r1', label: '', cells: [{ id: 'cell1', type: 'choice_opt', content: '예' }] },
      ],
    } as never);
    expect(modelOrNull(tableSource)).toBeNull();
  });

  it('켜져 있어도 그릴 수 없으면 폴백 이유를 돌려준다', () => {
    const withOther = question({
      scaleSlider: 'positive-right',
      options: [...FIVE, { id: 'o6', label: '기타', value: '6', allowTextInput: true }],
    });
    expect(projectRadioQuestionScaleSlider(withOther)).toEqual({ ok: false, reason: 'text-input' });
  });
});
