import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreviewCell } from '@/features/question-renderer/cells/preview-cell';
import { RankingQuestion } from '@/features/question-renderer/ranking-question';
import type { Question, TableCell } from '@/types/survey';

import {
  loadImageWithSize,
  settleImageEnlargeHistory,
  stubMatchMedia,
} from '../../../tests/helpers/image-size';

/**
 * 「이미지 크게 보기」의 범위 — 응답 화면의 표(테이블 · 보기 · 순위 문항)만 켜진다. 빌더 편집 화면의 표
 * (질문 편집 미리보기 · 합계 제약 · 수식 항 셀 선택)는 이미지 칸을 누르면 셀이 골라져야 한다.
 */

let restoreMatchMedia: (() => void) | undefined;

afterEach(async () => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
  await settleImageEnlargeHistory();
});

const shrunk = { natural: { width: 1920, height: 1400 }, rendered: { width: 132, height: 96 } };

describe('표 이미지 셀 크게 보기의 범위', () => {
  it('응답 화면 표 밖(빌더 편집 화면의 표)에서는 줄어 보여도 크게 보기가 없다', () => {
    restoreMatchMedia = stubMatchMedia({ mobile: false, hover: true });
    const cell = {
      id: 'image-a',
      type: 'image',
      content: '',
      imageUrl: 'https://cdn.example.com/a.png',
    } as TableCell;
    const { container } = render(<PreviewCell cell={cell} />);
    const img = container.querySelector('img') as HTMLImageElement;

    loadImageWithSize(img, shrunk);

    expect(screen.queryByRole('button', { name: /크게 보기/ })).toBeNull();
    expect(img).not.toHaveAttribute('tabindex');
  });

  it('표 소스 순위형 문항의 표 이미지도 크게 보고 머리 줄에 행·열 제목이 보인다', async () => {
    restoreMatchMedia = stubMatchMedia({ mobile: false, hover: true });
    const question = {
      id: 'q-rank',
      type: 'ranking',
      title: '순위형',
      required: false,
      order: 0,
      rankingConfig: { optionsSource: 'table', positions: 1 },
      tableColumns: [
        { id: 'col-name', label: '시안' },
        { id: 'col-image', label: '패키지' },
        { id: 'col-opt', label: '보기' },
      ],
      tableRowsData: [
        {
          id: 'row-a',
          label: 'A',
          cells: [
            { id: 'name-a', type: 'text', content: '시안 A' },
            {
              id: 'image-a',
              type: 'image',
              content: '',
              imageUrl: 'https://cdn.example.com/a.png',
            },
            { id: 'opt-a', type: 'ranking_opt', content: 'A안', rankingLabel: 'A안' },
          ],
        },
      ],
    } as unknown as Question;
    const { container } = render(
      <RankingQuestion question={question} value={null} onChange={vi.fn()} />,
    );

    loadImageWithSize(
      container.querySelector('img[src="https://cdn.example.com/a.png"]') as HTMLImageElement,
      shrunk,
    );
    fireEvent.click(screen.getByRole('button', { name: '셀 이미지 크게 보기' }));

    const dialog = await screen.findByRole('dialog', { name: '이미지 크게 보기' });
    expect(within(dialog).getByText('시안 A · 패키지')).toBeInTheDocument();
  });
});
