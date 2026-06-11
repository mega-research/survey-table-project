import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocalDateTime } from '@/components/ui/local-date-time';

describe('LocalDateTime', () => {
  it('유효한 Date 는 time 요소와 ISO dateTime 속성을 렌더한다', () => {
    const value = new Date('2026-06-11T01:23:00.000Z');
    const { container } = render(<LocalDateTime value={value} />);
    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.getAttribute('dateTime')).toBe('2026-06-11T01:23:00.000Z');
  });

  it('null/undefined 는 fallback 을 표시한다', () => {
    const { container: nullC } = render(
      <LocalDateTime value={null} fallback="없음" />,
    );
    expect(nullC.querySelector('time')).toBeNull();
    expect(nullC.textContent).toBe('없음');

    const { container: undefC } = render(
      <LocalDateTime value={undefined} fallback="없음" />,
    );
    expect(undefC.textContent).toBe('없음');
  });

  it('빈 문자열은 throw 없이 fallback 을 표시한다', () => {
    const { container } = render(
      <LocalDateTime value="" fallback="없음" />,
    );
    expect(container.querySelector('time')).toBeNull();
    expect(container.textContent).toBe('없음');
  });

  it('파싱 불가 문자열은 throw 없이 fallback 을 표시한다', () => {
    const { container } = render(
      <LocalDateTime value="not-a-date" fallback="없음" />,
    );
    expect(container.querySelector('time')).toBeNull();
    expect(container.textContent).toBe('없음');
  });
});
