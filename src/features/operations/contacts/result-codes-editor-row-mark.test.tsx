import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResultCodesEditor } from '@/features/operations/contacts/result-codes-editor';
import type { ContactResultCode } from '@/shared/contracts/contacts';
import { client } from '@/shared/lib/rpc';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: { contacts: { resultCodes: { update: vi.fn() } } },
}));

const updateMock = vi.mocked(client.contacts.resultCodes.update);

const codes: ContactResultCode[] = [
  { code: '1.조사완료', label: '1.조사완료', order: 1, tone: 'green', status: 'positive' },
  { code: '4.부재', label: '4.부재', order: 2, tone: 'slate' },
  { code: '12.조사대상아님', label: '12.조사대상아님', order: 3, tone: 'rose' },
  { code: '수신거부', label: '수신거부', order: 4, tone: 'rose', status: 'neutral' },
];

// Radix Select 는 jsdom 에 없는 포인터 캡처·스크롤 API 를 부른다.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

describe('ResultCodesEditor 목록 행 표시', () => {
  beforeEach(() => vi.clearAllMocks());

  it('고르지 않은 코드는 기본값을 보여 준다 — 조사완료는 완료 음영, 수신거부·조사대상아님은 붉게', () => {
    render(<ResultCodesEditor surveyId="sv-1" initialCodes={codes} />);

    expect(screen.getByRole('combobox', { name: '1.조사완료 목록 행 표시' })).toHaveTextContent('완료 음영');
    expect(screen.getByRole('combobox', { name: '4.부재 목록 행 표시' })).toHaveTextContent('없음');
    expect(screen.getByRole('combobox', { name: '12.조사대상아님 목록 행 표시' })).toHaveTextContent('붉게');
    expect(screen.getByRole('combobox', { name: '수신거부 목록 행 표시' })).toHaveTextContent('붉게');
  });

  it('손대지 않고 저장하면 rowMark 를 새로 쓰지 않는다', async () => {
    updateMock.mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(<ResultCodesEditor surveyId="sv-1" initialCodes={codes} />);

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(updateMock.mock.calls[0]![0].codes).toEqual(codes);
  });

  it('고르면 그 코드에만 rowMark 가 저장된다 — 기본값을 끌 수도 있다', async () => {
    updateMock.mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(<ResultCodesEditor surveyId="sv-1" initialCodes={codes} />);

    await user.click(screen.getByRole('combobox', { name: '4.부재 목록 행 표시' }));
    await user.click(await screen.findByRole('option', { name: '붉게' }));
    await user.click(screen.getByRole('combobox', { name: '수신거부 목록 행 표시' }));
    await user.click(await screen.findByRole('option', { name: '없음' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    const saved = updateMock.mock.calls[0]![0].codes!;
    expect(saved[0]).not.toHaveProperty('rowMark');
    expect(saved[1]).toMatchObject({ code: '4.부재', rowMark: 'out' });
    expect(saved[2]).not.toHaveProperty('rowMark');
    expect(saved[3]).toMatchObject({ code: '수신거부', rowMark: 'none' });
  });
});
