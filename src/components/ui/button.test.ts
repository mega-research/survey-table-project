import { describe, expect, it } from 'vitest';

import { buttonVariants } from './button';

// 버튼의 뼈대는 shadcn 공식 판(Base UI)이지만 모양은 이 레포 것이다(src/components/AGENTS.md).
// `shadcn add button` 으로 덮어쓰면 tsc 는 조용하고 화면만 바뀐다 — 쓰는 쪽 400여 곳이 기대는 사양을 여기서 붙든다.
const classesOf = (...args: Parameters<typeof buttonVariants>) => buttonVariants(...args).split(/\s+/);

describe('buttonVariants — 이 레포의 버튼 모양', () => {
  it('기본 크기는 높이 48px·좌우 24px·16px 글자·둥글기 8px 다', () => {
    expect(classesOf()).toEqual(expect.arrayContaining(['h-12', 'px-6', 'text-base', 'rounded-lg']));
  });

  it('sm 은 높이 36px·좌우 12px·14px 글자다', () => {
    expect(classesOf({ size: 'sm' })).toEqual(expect.arrayContaining(['h-9', 'px-3', 'text-sm']));
  });

  it('기본 종류는 파란 바탕에 흰 글자이고 올리면 한 단계 짙어진다', () => {
    expect(classesOf()).toEqual(
      expect.arrayContaining(['bg-blue-500', 'text-white', 'hover:bg-blue-600']),
    );
  });

  it('outline 은 흰 바탕에 회색 테두리다', () => {
    expect(classesOf({ variant: 'outline', size: 'sm' })).toEqual(
      expect.arrayContaining(['border', 'border-gray-200', 'bg-white', 'text-gray-900']),
    );
  });

  it('destructive 는 옅은 바탕이 아니라 빨간 바탕에 흰 글자다', () => {
    expect(classesOf({ variant: 'destructive' })).toEqual(
      expect.arrayContaining(['bg-red-500', 'text-white']),
    );
  });

  it('아이콘 간격을 버튼이 내지 않는다 — 쓰는 쪽 아이콘이 mr-2 로 낸다', () => {
    for (const size of ['default', 'sm', 'lg', 'xs'] as const) {
      expect(classesOf({ size }).filter((c) => c.startsWith('gap-'))).toEqual([]);
    }
  });

  it('누를 때 버튼을 밀지 않는다', () => {
    expect(classesOf().filter((c) => c.includes('translate'))).toEqual([]);
  });

  it('아이콘 기본 크기는 크기를 적지 않은 아이콘에만 준다 — h-3.5 w-3.5 를 덮지 않는다', () => {
    const iconRules = classesOf().filter((c) => c.startsWith('[&_svg:not(') && c.endsWith(':size-4'));
    expect(iconRules).toHaveLength(1);
    expect(iconRules[0]).toContain("not([class^='h-'])");
    expect(iconRules[0]).toContain("not([class*='_h-'])");
    expect(iconRules[0]).toContain("not([class^='w-'])");
    expect(iconRules[0]).toContain("not([class*='_w-'])");
  });

  it('쓰는 쪽이 준 높이·여백이 기본값을 이긴다', () => {
    const classes = classesOf({ size: 'sm', className: 'h-7 px-2' });
    expect(classes).toEqual(expect.arrayContaining(['h-7', 'px-2']));
    expect(classes).not.toContain('h-9');
    expect(classes).not.toContain('px-3');
  });
});
