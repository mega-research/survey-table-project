import { describe, expect, it } from 'vitest';

import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import { resolveCardTags, resolveTagPicker, resolveTagRename } from './personal-tags';

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
    expect(resolveTagPicker(ALL, '', 4)).toEqual({
      matches: ALL,
      create: null,
      limitReached: false,
    });
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

describe('편집 패널 이름 칸 (티켓 08)', () => {
  const MINE = [tag('a', 'A사'), tag('b', 'B기관')];

  it('공백만 다른 지금 이름이면 보내지 않는다', () => {
    expect(resolveTagRename(' B기관 ', MINE[1]!, MINE)).toEqual({ kind: 'unchanged' });
  });

  it('자기 이름의 대소문자만 바꾸는 것은 겹침이 아니다', () => {
    const abc = tag('c', 'abc');
    expect(resolveTagRename('ABC', abc, [...MINE, abc])).toEqual({ kind: 'save', name: 'ABC' });
  });

  it('다른 내 태그와 공백·대소문자만 다르면 겹침', () => {
    expect(resolveTagRename(' a사', MINE[1]!, MINE)).toMatchObject({
      kind: 'invalid',
      reason: 'taken',
      message: '이미 같은 이름의 태그가 있습니다',
    });
  });

  it('비었거나 20자를 넘으면 이유와 함께 거부, 아니면 걷은 이름으로 보낸다', () => {
    expect(resolveTagRename('  ', MINE[1]!, MINE)).toMatchObject({ reason: 'empty' });
    expect(resolveTagRename('가'.repeat(21), MINE[1]!, MINE)).toMatchObject({ reason: 'too_long' });
    expect(resolveTagRename(' C기관 ', MINE[1]!, MINE)).toEqual({ kind: 'save', name: 'C기관' });
  });
});
