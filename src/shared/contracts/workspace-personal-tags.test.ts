import { describe, expect, it } from 'vitest';

import {
  PERSONAL_TAG_LIMIT,
  PERSONAL_TAG_NAME_MAX_LENGTH,
  isPersonalTagLimitReached,
  normalizePersonalTagName,
  personalTagColorValues,
  personalTagNameKey,
} from './workspace';
import { CreatePersonalTagInput } from './workspace-io';

// 내 태그 이름 규칙 (설문 즐겨찾기·태그 티켓 07) — 서버 입력 검증과 태그 창이 같은 함수를 본다.

describe('내 태그 색 어휘', () => {
  it('8색이 어휘 순서대로 있다 — 새 태그 색 배정의 동점 순서가 이 배열이다', () => {
    expect(personalTagColorValues).toEqual([
      'blue',
      'red',
      'green',
      'purple',
      'amber',
      'teal',
      'pink',
      'gray',
    ]);
  });
});

describe('normalizePersonalTagName', () => {
  it('앞뒤 공백을 떼고 그대로 쓴다 — 대소문자는 보존한다', () => {
    expect(normalizePersonalTagName('  A사 ')).toEqual({ ok: true, name: 'A사' });
  });

  it('공백뿐이면 빈 이름이다', () => {
    expect(normalizePersonalTagName('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('20자는 받고 21자는 거부한다 — 글자 수는 앞뒤 공백을 뗀 뒤 센다', () => {
    const twenty = '가'.repeat(20);
    expect(PERSONAL_TAG_NAME_MAX_LENGTH).toBe(20);
    expect(normalizePersonalTagName(` ${twenty} `)).toEqual({ ok: true, name: twenty });
    expect(normalizePersonalTagName(`${twenty}a`)).toEqual({ ok: false, reason: 'too_long' });
  });

  it('글자 수는 UTF-16 칸이 아니라 글자로 센다 — 이모지 20개는 20자다', () => {
    const emoji20 = '\u{1F600}'.repeat(20);
    expect(normalizePersonalTagName(emoji20)).toEqual({ ok: true, name: emoji20 });
  });
});

describe('personalTagNameKey', () => {
  it('공백·대소문자만 다른 이름은 같은 열쇠다', () => {
    expect(personalTagNameKey(' a사 ')).toBe(personalTagNameKey('A사'));
    expect(personalTagNameKey('B기관')).not.toBe(personalTagNameKey('A사'));
  });
});

describe('isPersonalTagLimitReached', () => {
  it('300개부터 더 만들 수 없다', () => {
    expect(PERSONAL_TAG_LIMIT).toBe(300);
    expect(isPersonalTagLimitReached(299)).toBe(false);
    expect(isPersonalTagLimitReached(300)).toBe(true);
  });
});

describe('CreatePersonalTagInput — 입력 검증도 같은 규칙', () => {
  it('이름은 앞뒤 공백을 뗀 값으로 넘어간다', () => {
    expect(CreatePersonalTagInput.parse({ name: ' A사 ', attachToSurveyId: null })).toEqual({
      name: 'A사',
      attachToSurveyId: null,
    });
  });

  it('빈 이름과 21자는 거부하고, 거부 사유에 이름을 싣지 않는다', () => {
    const long = '비밀발주처'.repeat(5);
    for (const name of ['  ', long]) {
      const result = CreatePersonalTagInput.safeParse({ name, attachToSurveyId: null });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).not.toContain('비밀발주처');
    }
  });
});
