import { describe, expect, it } from 'vitest';

import { SURVEY_LOCALES } from '@/types/survey-locale';

import { SYSTEM_STRINGS, systemText, systemTextLines } from './system-strings';

describe('시스템 글자 사전', () => {
  it('모든 언어의 키 집합이 같고 빈 문장이 없다', () => {
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

  it('언어가 미정이고 쌓을 언어를 주지 않으면 어휘 전체를 어휘 순서로 쌓는다', () => {
    expect(systemTextLines('nav.next', null)).toEqual([
      { locale: 'ko', text: '다음' },
      { locale: 'zh', text: '下一步' },
      { locale: 'en', text: 'Next' },
      { locale: 'vi', text: 'Tiếp theo' },
    ]);
    expect(systemTextLines('nav.next', 'zh')).toEqual([{ locale: 'zh', text: '下一步' }]);
  });

  it('언어가 미정이면 그 설문이 제공하는 언어만 어휘 순서로 쌓는다', () => {
    // 한·중·영 설문 — 베트남어가 끼지 않는다(베트남어를 더하기 전 화면 그대로)
    expect(systemText('nav.next', null, undefined, ['ko', 'zh', 'en'])).toBe('다음\n下一步\nNext');
    // 한·영·베트남어 설문 — 중국어가 끼지 않고, 준 순서가 아니라 어휘 순서다
    expect(systemTextLines('nav.next', null, undefined, ['vi', 'en', 'ko'])).toEqual([
      { locale: 'ko', text: '다음' },
      { locale: 'en', text: 'Next' },
      { locale: 'vi', text: 'Tiếp theo' },
    ]);
    // 언어가 정해졌으면 쌓을 언어와 무관하게 그 언어 하나
    expect(systemText('nav.next', 'vi', undefined, ['ko', 'en'])).toBe('Tiếp theo');
  });

  it('베트남어 문장은 한국어 문장과 같은 자리표시자를 쓴다', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, ko] of Object.entries(SYSTEM_STRINGS.ko)) {
      const vi = SYSTEM_STRINGS.vi[key as keyof typeof SYSTEM_STRINGS.vi];
      expect(placeholders(vi), key).toEqual(placeholders(ko));
    }
  });
});
