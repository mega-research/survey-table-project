import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactColumnScheme } from '@/shared/contracts/contacts';

/**
 * 조사 대상 단건 편집 — 값이 있는데 형식이 틀린 PII(예: `@` 없는 메일)는 저장 요청을 보내기 전에 막는다.
 *
 * 막지 않으면 서버 저장 경로가 그 값을 「빈 값」으로 다뤄 기존 암호화 행을 지우고 성공으로 끝난다.
 * 화면에는 「저장 완료」가 뜨는데 값은 사라지고, 나갈 때 「변경사항이 저장되지 않았습니다」가 뜬다
 * (2026-10-06 실사고). 서버도 같은 판정으로 거부한다 — 여기는 화면 쪽 선차단을 본다.
 */

const update = vi.fn(async (_input: unknown) => ({ ok: true as const }));
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    contacts: {
      targets: { update: (input: unknown) => update(input), add: vi.fn(), remove: vi.fn() },
      columns: { update: vi.fn() },
    },
  },
}));

import { ContactDetailForm } from './contact-detail-form';

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: '회사명', label: '회사명', source: 'attrs.회사명', order: 0 },
    { key: '이메일1', label: '담당자 메일', source: 'pii.이메일1', order: 1, piiType: 'email' },
    { key: '연락처1', label: '연락처1', source: 'pii.연락처1', order: 2, piiType: 'phone' },
  ],
};

function renderForm(email: string) {
  render(
    <ContactDetailForm
      surveyId="sv-1"
      scheme={scheme}
      resultCodes={[]}
      initial={{
        id: 'ct-1',
        resid: 8993,
        attrs: { 회사명: '드림전자' },
        piiDecrypted: {
          이메일1: { fieldType: 'email', plain: email, failed: false },
          연락처1: { fieldType: 'phone', plain: '02-2065-6131', failed: false },
        },
        memo: null,
        contactMethod: null,
        respondedAt: null,
        inviteToken: 'tok',
        inviteCode: 'code',
        responseId: null,
        attempts: [],
      }}
    />,
  );
}

/** 열 순서대로 그려지는 입력칸 — [회사명, 담당자 메일, 연락처1] */
function emailInput(): HTMLInputElement {
  return screen.getAllByRole('textbox')[1] as HTMLInputElement;
}

describe('조사 대상 단건 편집 — 형식이 틀린 메일', () => {
  beforeEach(() => {
    update.mockClear();
    refresh.mockClear();
  });

  it('@ 없는 메일은 저장 요청을 보내지 않고, 컬럼 라벨과 이유를 알린다', async () => {
    const user = userEvent.setup();
    renderForm('info@dream-elec.co.kr');

    fireEvent.change(emailInput(), { target: { value: 'dream-elec.co.kr' } });
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/「담당자 메일」.*메일 형식/);
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByText('저장 완료')).not.toBeInTheDocument();
    // 입력한 글자는 그대로 남아 있어 고쳐 쓸 수 있다.
    expect(emailInput()).toHaveValue('dream-elec.co.kr');
  });

  it('형식이 맞으면 그대로 저장한다', async () => {
    const user = userEvent.setup();
    renderForm('');

    fireEvent.change(emailInput(), { target: { value: 'info@dream-elec.co.kr' } });
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toMatchObject({
      piiUpdates: [{ columnKey: '이메일1', fieldType: 'email', plain: 'info@dream-elec.co.kr' }],
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('손대지 않은 칸은 검사하지 않는다 — 다른 칸만 고쳐도 저장된다', async () => {
    const user = userEvent.setup();
    renderForm('info@dream-elec.co.kr');

    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: '(주)드림전자' } });
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).not.toHaveProperty('piiUpdates');
  });
});
