import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ShareReleaseWarning } from './share-release-warning';

/**
 * 명단 교체 업로드 경고의 「풀릴 담당 범위」 줄 (fieldwork-multi-company 티켓 09).
 * 교체 업로드는 대상을 새로 만들어 담당 범위가 전부 풀리고, 나눈 링크는 다시 나눌 때까지 0명을 본다.
 */
describe('ShareReleaseWarning', () => {
  it('링크별 풀릴 인원을 발급 순으로 한 줄에 보이고, 다시 나눌 때까지 0명이라고 말한다', () => {
    render(
      <ul>
        <ShareReleaseWarning
          rows={[
            { linkId: 'a', name: '프롬', count: 1200 },
            { linkId: 'b', name: '프라임', count: 35 },
          ]}
        />
      </ul>,
    );
    expect(screen.getByText(/풀릴 담당 범위: 프롬 1,200명 · 프라임 35명/)).toBeInTheDocument();
    expect(screen.getByText(/다시 나눌 때까지 0명/)).toBeInTheDocument();
  });

  it('풀릴 범위가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <ul>
        <ShareReleaseWarning rows={[]} />
      </ul>,
    );
    expect(container.querySelector('li')).toBeNull();
  });

  it('이름표는 글자로만 그린다', () => {
    render(
      <ul>
        <ShareReleaseWarning rows={[{ linkId: 'a', name: '<b>프롬</b>', count: 1 }]} />
      </ul>,
    );
    expect(screen.getByText(/<b>프롬<\/b> 1명/)).toBeInTheDocument();
  });
});
