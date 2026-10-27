import { describe, expect, it } from 'vitest';

import { outcomeFromStatus, resolveCompletionScreen } from './completion-screen';

const settings = { thankYouMessage: '참여해 주셔서 감사합니다.', screenedOutMessage: null };

describe('resolveCompletionScreen', () => {
  it('완료는 완료 문구와 「응답 완료!」', () => {
    expect(resolveCompletionScreen(settings, 'completed')).toEqual({
      title: '응답 완료!',
      message: '참여해 주셔서 감사합니다.',
    });
  });

  it('자격미달은 자격미달 문구와 「설문 종료」', () => {
    expect(
      resolveCompletionScreen(
        { ...settings, screenedOutMessage: '본 조사 대상자가 아닙니다. 참여해주셔서 감사합니다.' },
        'screened_out',
      ),
    ).toEqual({
      title: '설문 종료',
      message: '본 조사 대상자가 아닙니다. 참여해주셔서 감사합니다.',
    });
  });

  it('자격미달 문구가 비어 있으면 완료 문구로 폴백하되 제목은 「설문 종료」다', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(
        resolveCompletionScreen({ ...settings, screenedOutMessage: empty }, 'screened_out'),
      ).toEqual({
        title: '설문 종료',
        message: '참여해 주셔서 감사합니다.',
      });
    }
  });
});

describe('outcomeFromStatus', () => {
  it('screened_out 만 자격미달이고 나머지·알 수 없는 값은 완료다', () => {
    expect(outcomeFromStatus('screened_out')).toBe('screened_out');
    expect(outcomeFromStatus('completed')).toBe('completed');
    expect(outcomeFromStatus(undefined)).toBe('completed');
    expect(outcomeFromStatus('weird')).toBe('completed');
  });
});

describe('resolveCompletionScreen — 언어별 문구 (CONTEXT.md 「다국어 설문」)', () => {
  const localized = {
    ...settings,
    screenedOutMessage: '대상이 아닙니다.',
    localizedMessages: { zh: { thankYou: '非常感谢。', screenedOut: '您不是调查对象。' }, en: {} },
  };

  it('현재 언어의 완료·자격미달 문구를 쓴다', () => {
    expect(resolveCompletionScreen(localized, 'completed', 'zh').message).toBe('非常感谢。');
    expect(resolveCompletionScreen(localized, 'screened_out', 'zh').message).toBe(
      '您不是调查对象。',
    );
  });

  it('그 언어 문구가 없으면 한국어 문구 사슬로 폴백한다', () => {
    expect(resolveCompletionScreen(localized, 'completed', 'en').message).toBe(
      '참여해 주셔서 감사합니다.',
    );
    expect(resolveCompletionScreen(localized, 'screened_out', 'en').message).toBe(
      '대상이 아닙니다.',
    );
  });

  it('자격미달 문구가 없는 언어는 그 언어의 완료 문구로 폴백한다', () => {
    const zhThanksOnly = { ...localized, localizedMessages: { zh: { thankYou: '非常感谢。' } } };
    expect(resolveCompletionScreen(zhThanksOnly, 'screened_out', 'zh').message).toBe('非常感谢。');
  });
});
