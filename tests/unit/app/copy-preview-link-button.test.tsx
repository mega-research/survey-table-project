import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

import { CopyPreviewLinkButton } from '@/app/admin/surveys/[id]/preview/copy-preview-link-button';

const PREVIEW_TOKEN = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://example.test' },
  });
});

describe('CopyPreviewLinkButton', () => {
  it('클릭하면 /preview/[token] 공개 링크를 클립보드에 복사한다', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    render(<CopyPreviewLinkButton previewToken={PREVIEW_TOKEN} />);
    await user.click(screen.getByRole('button', { name: '공개 링크 복사' }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `https://example.test/preview/${PREVIEW_TOKEN}`,
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('공개 미리보기 링크를 복사했습니다.');
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('클립보드 복사가 실패하면 에러 토스트를 띄운다', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    render(<CopyPreviewLinkButton previewToken={PREVIEW_TOKEN} />);
    await user.click(screen.getByRole('button', { name: '공개 링크 복사' }));

    expect(toastErrorMock).toHaveBeenCalledWith('denied');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
