import { describe, expect, it } from 'vitest';

import { getSidebarMenuItemIds } from './sidebar-menu';

describe('getSidebarMenuItemIds', () => {
  it('팀 미배치는 프로필만 — 설문·관리 메뉴 전부 숨김 (.pen FLOW 9-1 제한 메뉴)', () => {
    expect(getSidebarMenuItemIds('none', false)).toEqual(['profile']);
  });

  it('일반 사용자는 설문 목록만', () => {
    expect(getSidebarMenuItemIds('team', false)).toEqual(['surveys']);
  });

  it('슈퍼어드민은 설문 목록 + 사용자 관리 + 팀 관리 (.pen FLOW 7 메뉴)', () => {
    expect(getSidebarMenuItemIds('team', true)).toEqual(['surveys', 'users', 'teams']);
    expect(getSidebarMenuItemIds('system', true)).toEqual(['surveys', 'users', 'teams']);
  });
});
