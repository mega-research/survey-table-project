import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    operations: {
      progress: { updateColumns: vi.fn() },
    },
    contacts: {
      columns: { updateGroupLevels: vi.fn() },
    },
  },
}));

import { client } from '@/shared/lib/rpc';
import { ProgressColumnEditor } from '@/features/operations/report/progress-column-editor';
import type { ProgressColumnScheme } from '@/shared/contracts/operations';
import { normalizeContactColumnScheme } from '@/lib/operations/contacts-format';

const updateColumnsMock = vi.mocked(client.operations.progress.updateColumns);

const contactScheme = normalizeContactColumnScheme({
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: 'c1', label: '중복여부', source: 'attrs.중복여부', order: 2 },
  ],
})!;

const initialScheme: ProgressColumnScheme = {
  version: 1,
  columns: [{ key: '중복여부', label: '중복여부', order: 0, hidden: false }],
};

describe('ProgressColumnEditor 시스템ID 표시 토글', () => {
  beforeEach(() => vi.clearAllMocks());

  it('시스템ID 행이 표시되고, 끄고 저장하면 showResid=false 로 저장된다', async () => {
    updateColumnsMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(
      <ProgressColumnEditor
        surveyId="sv-1"
        initialScheme={initialScheme}
        contactScheme={contactScheme}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: '시스템ID 표시' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(updateColumnsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surveyId: 'sv-1',
        scheme: expect.objectContaining({ showResid: false }),
      }),
    );
  });

  it('기본 상태로 저장하면 showResid=true', async () => {
    updateColumnsMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(
      <ProgressColumnEditor
        surveyId="sv-1"
        initialScheme={initialScheme}
        contactScheme={contactScheme}
      />,
    );

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(updateColumnsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scheme: expect.objectContaining({ showResid: true }),
      }),
    );
  });
});
