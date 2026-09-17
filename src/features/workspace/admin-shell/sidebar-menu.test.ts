import { describe, expect, it } from 'vitest';

import { getSidebarMenuItemIds, isSidebarHiddenPath } from './sidebar-menu';

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

describe('isSidebarHiddenPath', () => {
  it('설문 편집기와 운영 콘솔에서는 사이드바를 감춘다', () => {
    expect(isSidebarHiddenPath('/admin/surveys/abc/edit')).toBe(true);
    expect(isSidebarHiddenPath('/admin/surveys/abc/operations')).toBe(true);
    expect(isSidebarHiddenPath('/admin/surveys/abc/operations/contacts/1')).toBe(true);
  });

  it('목록·생성·미리보기·분석·기타 admin 화면은 사이드바를 둔다', () => {
    expect(isSidebarHiddenPath('/admin/surveys')).toBe(false);
    expect(isSidebarHiddenPath('/admin/surveys/create')).toBe(false);
    expect(isSidebarHiddenPath('/admin/surveys/abc/preview')).toBe(false);
    expect(isSidebarHiddenPath('/admin/surveys/abc/analytics')).toBe(false);
    expect(isSidebarHiddenPath('/admin/surveys/abc/editor')).toBe(false);
    expect(isSidebarHiddenPath('/admin/users')).toBe(false);
  });
});
