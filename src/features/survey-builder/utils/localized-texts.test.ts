import { describe, expect, it } from 'vitest';

import { withLocalizedText } from './localized-texts';

/** 언어별 설문 글자 저장 모양 — 빈 칸은 키가 없고, 아무 언어도 남지 않으면 null(한국어만). */
describe('withLocalizedText', () => {
  it('칸 하나를 채운다', () => {
    expect(withLocalizedText(null, 'zh', 'title', '绩效评估调查')).toEqual({
      zh: { title: '绩效评估调查' },
    });
  });

  it('다른 칸·다른 언어는 그대로 둔다', () => {
    const texts = { zh: { title: '标题' }, en: { thankYou: 'Thanks' } };
    expect(withLocalizedText(texts, 'zh', 'thankYou', '谢谢')).toEqual({
      zh: { title: '标题', thankYou: '谢谢' },
      en: { thankYou: 'Thanks' },
    });
  });

  it('비우면 키를 지우고, 남은 것이 없으면 null 이다', () => {
    const texts = { zh: { title: '标题' }, en: { title: 'Title' } };
    const withoutZh = withLocalizedText(texts, 'zh', 'title', '  ');
    expect(withoutZh).toEqual({ en: { title: 'Title' } });
    expect(withLocalizedText(withoutZh, 'en', 'title', '')).toBeNull();
  });
});
