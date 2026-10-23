import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import { RankingQuestion } from '@/features/question-renderer/ranking-question';
import type { Question } from '@/types/survey';

import {
  loadImageWithSize,
  settleImageEnlargeHistory,
  stubMatchMedia,
} from '../../../tests/helpers/image-size';

/**
 * 「이미지 크게 보기」 — 순위형 보기 이미지. 보기를 누르면 순위가 매겨지므로(클릭 방식) 입력 방식과
 * 무관하게 이미지 위 돋보기 버튼으로만 연다. 돋보기는 순위를 바꾸지 않는다.
 */

let restoreMatchMedia: (() => void) | undefined;

afterEach(async () => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
  await settleImageEnlargeHistory();
});

const IMAGE_URL = 'https://cdn.example.com/a.png';

function rankingQuestion(inputMode: 'click' | 'dropdown'): Question {
  return {
    id: 'q-rank',
    type: 'ranking',
    title: '순위형',
    required: false,
    order: 0,
    rankingConfig: { optionsSource: 'table', positions: 2, inputMode },
    tableColumns: [{ id: 'col-opt', label: '시안' }],
    tableRowsData: [
      {
        id: 'row-a',
        label: 'A',
        cells: [
          {
            id: 'opt-a',
            type: 'ranking_opt',
            content: 'A안',
            rankingLabel: 'A안',
            imageUrl: IMAGE_URL,
          },
        ],
      },
      {
        id: 'row-b',
        label: 'B',
        cells: [{ id: 'opt-b', type: 'ranking_opt', content: 'B안', rankingLabel: 'B안' }],
      },
    ],
  } as unknown as Question;
}

/** 높이 띠(80px)에 잘라 채운 세로로 긴 이미지 */
const cropped = { natural: { width: 400, height: 600 }, rendered: { width: 160, height: 80 } };

function renderRanking(inputMode: 'click' | 'dropdown') {
  restoreMatchMedia = stubMatchMedia({ mobile: false, hover: true });
  const onChange = vi.fn();
  const { container } = render(
    <RankingQuestion question={rankingQuestion(inputMode)} value={null} onChange={onChange} />,
  );
  const img = container.querySelector(`img[src="${IMAGE_URL}"]`) as HTMLImageElement;
  return { img, onChange };
}

describe('순위형 보기 이미지 — 돋보기 버튼', () => {
  it('클릭 방식: 돋보기를 누르면 보기 라벨을 머리 줄로 크게 보기가 열리고 순위는 그대로다', async () => {
    const { img, onChange } = renderRanking('click');
    loadImageWithSize(img, cropped);

    fireEvent.click(screen.getByRole('button', { name: 'A안 크게 보기' }));

    const dialog = await screen.findByRole('dialog', { name: '이미지 크게 보기' });
    expect(within(dialog).getByText('A안')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])(
    '클릭 방식: 키보드로 돋보기를 눌러도(%s) 크게 보기만 열리고 순위는 그대로다',
    async (_key, keys) => {
      const user = userEvent.setup();
      const { img, onChange } = renderRanking('click');
      loadImageWithSize(img, cropped);
      screen.getByRole('button', { name: 'A안 크게 보기' }).focus();

      await user.keyboard(keys);

      expect(await screen.findByRole('dialog', { name: '이미지 크게 보기' })).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it('클릭 방식: 크게 보기 안을 누르고 닫아도 순위는 그대로다', async () => {
    const { img, onChange } = renderRanking('click');
    loadImageWithSize(img, cropped);
    fireEvent.click(screen.getByRole('button', { name: 'A안 크게 보기' }));
    const dialog = await screen.findByRole('dialog', { name: '이미지 크게 보기' });

    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(onChange).not.toHaveBeenCalled();
  });

  it('클릭 방식: 이미지 자체를 누르면 종전대로 순위가 매겨진다', () => {
    const { img, onChange } = renderRanking('click');
    loadImageWithSize(img, cropped);

    fireEvent.click(img);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('드롭다운 방식: 같은 돋보기 버튼으로 크게 보기가 열린다', async () => {
    const { img } = renderRanking('dropdown');
    loadImageWithSize(img, cropped);

    fireEvent.click(screen.getByRole('button', { name: 'A안 크게 보기' }));

    expect(await screen.findByRole('dialog', { name: '이미지 크게 보기' })).toBeInTheDocument();
  });

  it('잘리지 않고 다 보이는 보기 이미지에는 돋보기가 없다', () => {
    const { img } = renderRanking('click');
    loadImageWithSize(img, {
      natural: { width: 160, height: 80 },
      rendered: { width: 160, height: 80 },
    });

    expect(screen.queryByRole('button', { name: 'A안 크게 보기' })).toBeNull();
  });

  it('보기 라벨의 명단 토큰은 버튼 이름에서도 치환된다', () => {
    restoreMatchMedia = stubMatchMedia({ mobile: false, hover: true });
    const question = rankingQuestion('click');
    question.tableRowsData![0]!.cells[0]!.content = '{{기업명}} 시안';
    const { container } = render(
      <ContactAttrsProvider attrs={{ 기업명: '메가리서치' }}>
        <RankingQuestion question={question} value={null} onChange={vi.fn()} />
      </ContactAttrsProvider>,
    );
    loadImageWithSize(
      container.querySelector(`img[src="${IMAGE_URL}"]`) as HTMLImageElement,
      cropped,
    );

    expect(screen.getByRole('button', { name: '메가리서치 시안 크게 보기' })).toBeInTheDocument();
  });
});
