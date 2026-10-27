import { describe, expect, it } from 'vitest';

import { SURVEY_LOCALES } from '@/types/survey-locale';

import { SYSTEM_STRINGS, systemText, systemTextLines } from './system-strings';

describe('시스템 글자 사전', () => {
  it('세 언어의 키 집합이 같고 빈 문장이 없다', () => {
    const koKeys = Object.keys(SYSTEM_STRINGS.ko).sort();
    for (const locale of SURVEY_LOCALES) {
      expect(Object.keys(SYSTEM_STRINGS[locale]).sort(), locale).toEqual(koKeys);
      for (const [key, text] of Object.entries(SYSTEM_STRINGS[locale])) {
        expect(text.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('언어를 주지 않으면 지금 화면의 한국어 문장 그대로다', () => {
    expect(systemText('nav.next')).toBe('다음');
    expect(systemText('progress.answered', undefined, { answered: 2, total: 5 })).toBe(
      '2/5 응답 완료',
    );
  });

  it('고른 언어의 문장을 내고 자리표시자를 채운다', () => {
    expect(systemText('nav.next', 'zh')).toBe('下一步');
    expect(systemText('progress.answered', 'en', { answered: 2, total: 5 })).toBe('2/5 answered');
  });

  it('언어가 미정이면 세 언어를 한국어 · 中文 · English 순으로 쌓는다', () => {
    expect(systemTextLines('nav.next', null)).toEqual([
      { locale: 'ko', text: '다음' },
      { locale: 'zh', text: '下一步' },
      { locale: 'en', text: 'Next' },
    ]);
    expect(systemText('nav.next', null)).toBe('다음\n下一步\nNext');
    expect(systemTextLines('nav.next', 'zh')).toEqual([{ locale: 'zh', text: '下一步' }]);
  });
});
