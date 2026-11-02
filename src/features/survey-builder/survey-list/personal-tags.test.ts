import { describe, expect, it } from 'vitest';

import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import { resolveCardTags, resolveTagPicker } from './personal-tags';

// 카드 태그 줄과 태그 창의 표시 규칙 (설문 즐겨찾기·태그 티켓 07).

function tag(id: string, name: string): PersonalTagItem {
  return { id, name, color: 'blue', linkCount: 0 };
}

const A = tag('a', 'A사');
const B = tag('b', '2026');
const C = tag('c', '실태조사');
const D = tag('d', '인공지능산업');
const ALL = [A, B, C, D];

describe('resolveCardTags — 카드 태그 줄', () => {
  it('붙인 순서대로 최대 2개를 보이고 나머지는 +N 으로 센다', () => {
    expect(resolveCardTags(['c', 'a', 'b'], ALL)).toEqual({ shown: [C, A], hiddenCount: 1 });
  });

  it('태그가 없으면 보일 것도 셀 것도 없다 — 카드에 줄이 없다', () => {
    expect(resolveCardTags([], ALL)).toEqual({ shown: [], hiddenCount: 0 });
  });

  it('내 태그 목록에 없는 id(그새 지운 태그)는 건너뛴다', () => {
    expect(resolveCardTags(['gone', 'b'], ALL)).toEqual({ shown: [B], hiddenCount: 0 });
  });
});

describe('resolveTagPicker — 태그 창', () => {
  it('검색어가 없으면 내 태그 전부, 만들기 없음', () => {
    expect(resolveTagPicker(ALL, '', 4)).toEqual({ matches: ALL, create: null, limitReached: false });
  });

  it('글자를 치면 이름에 그 글자가 든 태그로 좁힌다 — 대소문자 무시', () => {
    expect(resolveTagPicker(ALL, '인공', 4).matches).toEqual([D]);
    expect(resolveTagPicker(ALL, 'a', 4).matches).toEqual([A]);
  });

  it('없는 이름이면 앞뒤 공백을 뗀 이름으로 만들기를 낸다 — 일부만 맞는 태그는 위에 남는다', () => {
    expect(resolveTagPicker(ALL, ' 실태 ', 4)).toEqual({
      matches: [C],
      create: '실태',
      limitReached: false,
    });
  });

  it('공백·대소문자만 다른 같은 이름이 있으면 만들기를 내지 않는다', () => {
    expect(resolveTagPicker(ALL, ' a사 ', 4)).toEqual({
      matches: [A],
      create: null,
      limitReached: false,
    });
  });

  it('300개면 만들기 대신 한도 안내다', () => {
    expect(resolveTagPicker(ALL, 'C사', 300)).toEqual({
      matches: [],
      create: null,
      limitReached: true,
    });
  });
});
