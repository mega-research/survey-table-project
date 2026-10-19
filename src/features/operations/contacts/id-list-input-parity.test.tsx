import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const nonNumericCount = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: { contacts: { attrValues: { nonNumericCount: (...a: unknown[]) => nonNumericCount(...a) } } },
}));

import { IdListInput } from '@/features/operations/contacts/id-list-input';

describe('IdListInput — 명단 열 홀짝 상태줄', () => {
  it('숫자가 아닌 값 인원을 서버에 물어 함께 보인다', async () => {
    nonNumericCount.mockResolvedValue({ count: 7 });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <IdListInput source="attrs.명단ID" value="홀수" onChange={() => {}} surveyId="sv-1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/홀수 번호 · 숫자가 아닌 값 7명 제외/)).toBeInTheDocument();
    expect(nonNumericCount).toHaveBeenCalledWith({ surveyId: 'sv-1', attrsKey: '명단ID' });
  });
});
