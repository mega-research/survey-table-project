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
