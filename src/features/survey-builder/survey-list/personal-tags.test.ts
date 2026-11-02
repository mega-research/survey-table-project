import { describe, expect, it } from 'vitest';

import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import {
  keepKnownTagIds,
  resolveCardTags,
  resolveTagFilterList,
  resolveTagPicker,
  resolveTagRename,
} from './personal-tags';

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

  it('걸린 검색 칩과 같은 태그가 맨 앞에 선다 — 나머지는 붙인 순서, 2개 + N', () => {
    expect(resolveCardTags(['c', 'a', 'b', 'd'], ALL, ['b'])).toEqual({
      shown: [B, C],
      hiddenCount: 2,
    });
    // 걸린 태그끼리는 붙인 순서다(칩 순서가 아니다).
    expect(resolveCardTags(['c', 'a', 'b'], ALL, ['b', 'a'])).toEqual({
      shown: [A, B],
      hiddenCount: 1,
    });
  });

  it('걸린 태그가 이 카드에 없으면 붙인 순서 그대로다', () => {
    expect(resolveCardTags(['c', 'a'], ALL, ['d'])).toEqual({ shown: [C, A], hiddenCount: 0 });
  });
});

describe('resolveTagFilterList — 「# 태그」 목록', () => {
  const tags: PersonalTagItem[] = [
    { id: '1', name: '실태조사', color: 'green', linkCount: 17 },
    { id: '2', name: '2026', color: 'gray', linkCount: 23 },
    { id: '3', name: '가나', color: 'red', linkCount: 0 },
    { id: '4', name: 'A사', color: 'blue', linkCount: 17 },
  ];

  it('많이 쓴 순 — 붙은 설문 수가 많은 것부터, 같으면 가나다순. 0개인 태그도 나온다', () => {
    // 17 동점은 한국어 가나다순 — 한글이 영문보다 앞선다(CLDR ko, 서버 제목순 ko-x-icu 와 같다).
    expect(resolveTagFilterList(tags, '', 'usage').map((t) => t.id)).toEqual(['2', '1', '4', '3']);
  });

  it('가나다순 — 한국어 정렬(숫자 · 한글 · 영문)', () => {
    expect(resolveTagFilterList(tags, '', 'name').map((t) => t.id)).toEqual(['2', '3', '1', '4']);
  });

  it('글자를 치면 이름에 그 글자가 든 태그로 좁힌다 — 대소문자·앞뒤 공백 무시', () => {
    expect(resolveTagFilterList(tags, ' a사 ', 'usage').map((t) => t.id)).toEqual(['4']);
    expect(resolveTagFilterList(tags, '조사', 'name').map((t) => t.id)).toEqual(['1']);
  });
});

describe('keepKnownTagIds — 지워진 태그 칩 풀기', () => {
  it('내 태그 목록에 있는 id 만 순서대로 남긴다', () => {
    expect(keepKnownTagIds(['b', 'gone', 'a'], ALL)).toEqual(['b', 'a']);
    expect(keepKnownTagIds([], ALL)).toEqual([]);
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

  it('창을 열 때 붙어 있던 태그가 붙인 순서로 위에 서고, 나머지는 내 태그 순서다', () => {
    expect(resolveTagPicker(ALL, '', 4, ['c', 'a']).matches).toEqual([C, A, B, D]);
  });

  it('위로 올린 태그도 검색어에 맞을 때만 — 지워진 id 는 건너뛴다', () => {
    expect(resolveTagPicker(ALL, '실태', 4, ['gone', 'a', 'c']).matches).toEqual([C]);
    expect(resolveTagPicker(ALL, '', 4, ['gone', 'd']).matches).toEqual([D, A, B, C]);
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
