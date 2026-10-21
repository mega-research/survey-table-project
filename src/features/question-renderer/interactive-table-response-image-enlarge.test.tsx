import { StrictMode } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TableColumn, TableRow } from '@/types/survey';

import { loadImageWithSize, stubMatchMedia } from '../../../tests/helpers/image-size';
import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 「이미지 크게 보기」(CONTEXT.md) — 표 이미지 셀. 원본 전체가 다 보이지 않는 이미지를 누르면 크게 보기
 * 창이 열리고, 머리 줄은 「행 제목 · 열 제목」과 셀 캡션이다.
 */

let restoreMatchMedia: (() => void) | undefined;

afterEach(() => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
});

const columns: TableColumn[] = [
  { id: 'col-name', label: '시안' },
  { id: 'col-image', label: '이미지' },
  { id: 'col-pick', label: '선호' },
];

function rowsWith(imageCell: Partial<TableRow['cells'][number]> = {}): TableRow[] {
  return [
    {
      id: 'row-a',
      label: 'A',
      cells: [
        { id: 'name-a', type: 'text', content: '시안 A' },
        {
          id: 'image-a',
          type: 'image',
          content: '병 패키지 앞면',
          imageUrl: 'https://cdn.example.com/a.png',
          mobileDisplay: 'inline',
          ...imageCell,
        },
        {
          id: 'pick-a',
          type: 'radio',
          content: '',
          radioOptions: [{ id: 'o1', label: '좋다', value: '1' }],
        },
      ],
    },
  ];
}

function renderTable(
  options: { mobile?: boolean; imageCell?: Partial<TableRow['cells'][number]> } = {},
) {
  restoreMatchMedia = stubMatchMedia({ mobile: options.mobile ?? false, hover: !options.mobile });
  return render(
    <InteractiveTableResponse
      questionId="q1"
      columns={columns}
      rows={rowsWith(options.imageCell)}
      value={{}}
      onChange={() => {}}
      enableSticky={false}
      mobileTableDisplayMode={options.mobile ? 'row-cards' : undefined}
    />,
  );
}

const shrunk = { natural: { width: 1920, height: 1400 }, rendered: { width: 132, height: 96 } };
const fullSize = { natural: { width: 120, height: 90 }, rendered: { width: 120, height: 90 } };

function imageIn(container: HTMLElement): HTMLImageElement {
  const img = container.querySelector('img[src="https://cdn.example.com/a.png"]');
  if (!img) throw new Error('표 이미지가 없다');
  return img as HTMLImageElement;
}

describe('표 이미지 셀 — 이미지 크게 보기', () => {
  it('줄어 그려진 이미지를 누르면 크게 보기가 열리고 머리 줄에 행·열 제목과 캡션이 보인다', async () => {
    const { container } = renderTable();
    loadImageWithSize(imageIn(container), shrunk);

    fireEvent.click(screen.getByRole('button', { name: '셀 이미지 크게 보기' }));

    // 창은 누를 때 처음 불러온다(lazy)
    const dialog = await screen.findByRole('dialog', { name: '이미지 크게 보기' });
    expect(within(dialog).getByText('시안 A · 이미지')).toBeInTheDocument();
    expect(within(dialog).getByText('병 패키지 앞면')).toBeInTheDocument();
  });

  it('Enter 로도 크게 보기가 열린다', async () => {
    const { container } = renderTable();
    loadImageWithSize(imageIn(container), shrunk);

    fireEvent.keyDown(screen.getByRole('button', { name: '셀 이미지 크게 보기' }), {
      key: 'Enter',
    });

    expect(await screen.findByRole('dialog', { name: '이미지 크게 보기' })).toBeInTheDocument();
  });

  it('원래 크기로 다 보이는 이미지는 눌러도 반응하지 않는다', async () => {
    const { container } = renderTable();
    const img = imageIn(container);
    loadImageWithSize(img, fullSize);

    expect(screen.queryByRole('button', { name: '셀 이미지 크게 보기' })).toBeNull();
    expect(img).not.toHaveAttribute('tabindex');
    fireEvent.click(img);
    await Promise.resolve();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('불러오지 못한 이미지는 종전대로 「이미지 오류」이고 크게 보기가 없다', () => {
    const { container } = renderTable();
    fireEvent.error(imageIn(container));

    expect(screen.getByText('이미지 오류')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '셀 이미지 크게 보기' })).toBeNull();
  });

  it('닫기 버튼과 Esc 로 닫힌다', async () => {
    const { container } = renderTable();
    loadImageWithSize(imageIn(container), shrunk);
    const trigger = screen.getByRole('button', { name: '셀 이미지 크게 보기' });

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '이미지 크게 보기' });
    // 창 안에 포커스가 있을 때의 Esc — 키 처리는 창 안쪽 요소가 받는다
    fireEvent.keyDown(within(dialog).getByRole('button', { name: '닫기' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('모바일 행 카드의 이미지도 크게 볼 수 있다', async () => {
    const { container } = renderTable({ mobile: true });
    loadImageWithSize(imageIn(container), shrunk);

    fireEvent.click(screen.getByRole('button', { name: '이미지 크게 보기' }));

    const dialog = await screen.findByRole('dialog', { name: '이미지 크게 보기' });
    expect(within(dialog).getByText('시안 A · 이미지')).toBeInTheDocument();
  });

  it.each([
    { device: '마우스 있는 기기', mobile: false, closes: true },
    { device: '터치 기기', mobile: true, closes: false },
  ])('이미지 바깥 배경을 누르면 $device 에서는 닫힘=$closes', async ({ mobile, closes }) => {
    const { container } = renderTable({ mobile });
    loadImageWithSize(imageIn(container), shrunk);
    fireEvent.click(screen.getByRole('button', { name: /크게 보기/ }));
    const dialog = await screen.findByRole('dialog', { name: '이미지 크게 보기' });

    const backdrop = dialog.querySelector('.yarl__slide') as HTMLElement;
    fireEvent.pointerDown(backdrop, { pointerId: 1, button: 0, buttons: 1 });
    fireEvent.pointerUp(backdrop, { pointerId: 1, button: 0 });

    if (closes) {
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    } else {
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(screen.queryByRole('dialog')).not.toBeNull();
    }
  });

  it('응답 흐름 밖(빌더 미리보기 등)에서도 뒤로 가기로 닫힌다', async () => {
    const { container } = renderTable();
    loadImageWithSize(imageIn(container), shrunk);
    fireEvent.click(screen.getByRole('button', { name: '셀 이미지 크게 보기' }));
    await screen.findByRole('dialog', { name: '이미지 크게 보기' });

    act(() => window.history.back());

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('창이 닫히지 않은 채 화면에서 빠져도(화면 회전으로 표가 바뀌는 등) 쌓은 칸을 걷는다', async () => {
    const { container, unmount } = renderTable();
    loadImageWithSize(imageIn(container), shrunk);
    fireEvent.click(screen.getByRole('button', { name: '셀 이미지 크게 보기' }));
    await screen.findByRole('dialog', { name: '이미지 크게 보기' });
    expect(window.history.state).toMatchObject({ imageEnlarge: true });

    unmount();

    await waitFor(() => expect(window.history.state?.imageEnlarge).toBeUndefined());
  });

  it('StrictMode 이중 실행에서도 칸을 하나만 쌓고 창이 저절로 닫히지 않는다', async () => {
    restoreMatchMedia = stubMatchMedia({ mobile: false, hover: true });
    const { container } = render(
      <StrictMode>
        <InteractiveTableResponse
          questionId="q1"
          columns={columns}
          rows={rowsWith()}
          value={{}}
          onChange={() => {}}
          enableSticky={false}
        />
      </StrictMode>,
    );
    loadImageWithSize(imageIn(container), shrunk);

    fireEvent.click(screen.getByRole('button', { name: '셀 이미지 크게 보기' }));
    await screen.findByRole('dialog', { name: '이미지 크게 보기' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('dialog', { name: '이미지 크게 보기' })).toBeInTheDocument();

    // 칸이 하나면 뒤로 가기 한 번에 표식 칸을 벗어난다(jsdom 의 history.length 는 앞 테스트가 남긴
    // 앞으로 가기 칸 때문에 셀 수 없다)
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.history.state?.imageEnlarge).toBeUndefined();
  });
});
