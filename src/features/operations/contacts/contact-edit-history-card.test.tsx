import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ResponseEditLogRow } from '@/shared/contracts/contacts-io';

import { ContactEditHistoryCard } from './contact-edit-history-card';

/**
 * 편집 이력의 「누가」 칸 (0133, ADR-0027).
 *
 * 외주 실사 링크에는 계정이 없어 이메일이 없다 — 링크 칸이 채워진 행은 「외주」로 읽는다.
 * 이메일이 걷힌 계정 행(외주 콘솔이 받는 투영)은 종전대로 「관리자」다.
 */
function row(over: Partial<ResponseEditLogRow>): ResponseEditLogRow {
  return {
    id: crypto.randomUUID(),
    action: 'edit',
    editorEmail: null,
    byFieldworkLink: false,
    changedQuestions: [],
    changedCount: 0,
    createdAt: new Date('2026-09-30T00:00:00Z'),
    ...over,
  };
}

describe('ContactEditHistoryCard — 편집자 표시', () => {
  it('계정이 고친 행은 이메일을 보인다', () => {
    render(<ContactEditHistoryCard rows={[row({ editorEmail: 'r@x.com' })]} hasResponse />);
    expect(screen.getByText('r@x.com')).toBeTruthy();
  });

  it('외주 실사 링크가 고친 행은 「외주」로 읽는다', () => {
    render(<ContactEditHistoryCard rows={[row({ byFieldworkLink: true })]} hasResponse />);
    expect(screen.getByText('외주')).toBeTruthy();
    expect(screen.queryByText('관리자')).toBeNull();
  });

  it('이메일이 걷힌 계정 행은 「관리자」다', () => {
    render(<ContactEditHistoryCard rows={[row({ editorEmail: null })]} hasResponse />);
    expect(screen.getByText('관리자')).toBeTruthy();
  });
});
