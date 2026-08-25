import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ContactsDownloadDialog } from '@/features/operations/contacts/contacts-download-dialog';

const candidates = [
  { source: 'system.resid', label: '번호', defaultChecked: true },
  { source: 'attrs.회사명', label: '회사명', defaultChecked: true },
  { source: 'system.invite_url', label: '초대링크', defaultChecked: false },
];

describe('ContactsDownloadDialog', () => {
  it('다이얼로그를 열면 후보 컬럼이 기본 체크 상태로 보인다', async () => {
    const user = userEvent.setup();
    render(<ContactsDownloadDialog surveyId="s1" candidates={candidates} />);
    await user.click(screen.getByRole('button', { name: '다운로드' }));

    expect(screen.getByRole('checkbox', { name: '번호' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '초대링크' })).not.toBeChecked();
  });

  it('다운로드 링크는 체크된 컬럼만 cols 로 포함한다', async () => {
    const user = userEvent.setup();
    render(<ContactsDownloadDialog surveyId="s1" candidates={candidates} />);
    await user.click(screen.getByRole('button', { name: '다운로드' }));
    await user.click(screen.getByRole('checkbox', { name: '초대링크' }));

    const link = screen.getByRole('link', { name: '선택 다운로드' });
    expect(link).toHaveAttribute(
      'href',
      `/api/surveys/s1/contacts/export?cols=system.resid&cols=${encodeURIComponent('attrs.회사명')}&cols=system.invite_url`,
    );
  });

  it('전체 해제하면 다운로드 링크가 비활성화된다', async () => {
    const user = userEvent.setup();
    render(<ContactsDownloadDialog surveyId="s1" candidates={candidates} />);
    await user.click(screen.getByRole('button', { name: '다운로드' }));
    await user.click(screen.getByRole('button', { name: '전체 해제' }));

    expect(screen.queryByRole('link', { name: '선택 다운로드' })).toBeNull();
    expect(screen.getByRole('button', { name: '선택 다운로드' })).toBeDisabled();
  });
});
