import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuotaEditor } from '@/features/operations/quota/quota-editor';
import type { QuotaConfig } from '@/shared/contracts/quota';
import { client } from '@/shared/lib/rpc';
import type { Question } from '@/types/survey';

// 쿼터 「진행 중 마감」 옵션 — 스위치·문구 입력칸·저장 페이로드 (ADR 0025).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: { quota: { save: vi.fn(() => Promise.resolve({})), attrValues: vi.fn() } },
}));

const genderQuestion: Question = {
  id: 'q-gender',
  type: 'radio',
  title: '성별',
  required: false,
  order: 1,
  options: [
    { id: 'opt-male', label: '남성', value: 'male' },
    { id: 'opt-female', label: '여성', value: 'female' },
  ],
};

const config: QuotaConfig = {
  enabled: true,
  dimensions: [
    {
      id: 'dim-gender',
      questionId: genderQuestion.id,
      label: genderQuestion.title,
      kind: 'choice',
      categories: [{ id: 'cat-male', label: '남성', values: ['male'] }],
    },
  ],
  cells: [{ categoryIds: ['cat-male'], target: 10 }],
  closedMessage: '마감되었습니다.',
};

function renderEditor(initialConfig: QuotaConfig = config) {
  return render(
    <QuotaEditor surveyId="s1" initialConfig={initialConfig} questions={[genderQuestion]} />,
  );
}

beforeEach(() => {
  vi.mocked(client.quota.save).mockClear();
});

describe('QuotaEditor — 진행 중 마감', () => {
  it('옵션이 부재인 기존 플랜은 꺼진 스위치로 보이고 문구 입력칸이 없다', () => {
    renderEditor();
    expect(screen.getByRole('switch', { name: /진행 중 마감/ })).not.toBeChecked();
    expect(screen.queryByLabelText('진행 중 마감 문구')).not.toBeInTheDocument();
    // 셀이 찬 뒤 재응답 허용 시 초과 가능 — 설명이 스위치 곁에 있다.
    expect(screen.getByText(/재응답을 허용하면 초과/)).toBeInTheDocument();
  });

  it('스위치를 켜면 문구 입력칸과 미리보기가 나오고, 저장 페이로드에 옵션·문구가 실린다', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('switch', { name: /진행 중 마감/ }));
    const textarea = screen.getByLabelText('진행 중 마감 문구');
    await user.type(textarea, '죄송합니다. 응답 중 마감되었습니다.');
    // 미리보기는 입력한 문구를 그대로 보인다.
    expect(screen.getAllByText('죄송합니다. 응답 중 마감되었습니다.').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(client.quota.save).toHaveBeenCalledOnce();
    const sent = vi.mocked(client.quota.save).mock.calls[0]![0].config;
    expect(sent.midSurveyClose).toBe(true);
    expect(sent.midSurveyClosedMessage).toBe('죄송합니다. 응답 중 마감되었습니다.');
    expect(sent.closedMessage).toBe('마감되었습니다.');
  });

  it('문구를 비우면 null 로 저장하고, 미리보기는 기존 마감 문구로 폴백한다', async () => {
    const user = userEvent.setup();
    renderEditor({ ...config, midSurveyClose: true, midSurveyClosedMessage: '지웁니다' });

    await user.clear(screen.getByLabelText('진행 중 마감 문구'));
    expect(screen.getAllByText('마감되었습니다.').length).toBeGreaterThan(1);

    await user.click(screen.getByRole('button', { name: '저장' }));

    const sent = vi.mocked(client.quota.save).mock.calls[0]![0].config;
    expect(sent.midSurveyClose).toBe(true);
    expect(sent.midSurveyClosedMessage).toBeNull();
  });

  it('둘 다 비면 미리보기가 사과 톤 기본 문구를 보인다', () => {
    renderEditor({ ...config, closedMessage: null, midSurveyClose: true });
    // 안내 줄(기본 문구 표기)과 미리보기 두 곳에 같은 문구가 보인다.
    expect(screen.getAllByText(/응답 중에 해당 조건의 모집이 완료/).length).toBeGreaterThanOrEqual(2);
  });

  it('스위치를 끄면 문구 입력칸이 사라지고 저장 페이로드는 false 를 보낸다', async () => {
    const user = userEvent.setup();
    renderEditor({ ...config, midSurveyClose: true, midSurveyClosedMessage: '문구' });

    await user.click(screen.getByRole('switch', { name: /진행 중 마감/ }));
    expect(screen.queryByLabelText('진행 중 마감 문구')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '저장' }));
    const sent = vi.mocked(client.quota.save).mock.calls[0]![0].config;
    expect(sent.midSurveyClose).toBe(false);
  });
});
