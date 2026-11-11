import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TruncatedText } from './truncated-text';

const LONG =
  '1. 귀하는 (통영시)상권활성화사업 추진 시, 수혜자(이용자 및 지역주민 등)의 의견이 충분히 반영되었다고 생각하십니까?';

function setOverflow(el: HTMLElement, overflowing: boolean) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: overflowing ? 300 : 100 });
}

afterEach(cleanup);

describe('TruncatedText', () => {
  it('말줄임으로 잘린 글자는 마우스를 올리면 전체를 팝오버로 보인다', async () => {
    render(<TruncatedText text={LONG} />);
    const trigger = screen.getByText(LONG);
    setOverflow(trigger, true);

    fireEvent.pointerMove(trigger, { pointerType: 'mouse' });

    expect(await screen.findByRole('tooltip')).toHaveTextContent(LONG);
  });

  it('잘리지 않은 글자는 팝오버를 띄우지 않는다', async () => {
    render(<TruncatedText text="5. 짧은 제목" />);
    const trigger = screen.getByText('5. 짧은 제목');
    setOverflow(trigger, false);

    fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    await new Promise((r) => setTimeout(r, 300));

    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
