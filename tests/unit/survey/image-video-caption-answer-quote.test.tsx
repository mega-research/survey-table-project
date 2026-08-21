/**
 * 후속 리뷰 Task B — 이미지/비디오 셀 캡션(cell.content)의 응답 인용 치환.
 *
 * image-cell.tsx, video-cell.tsx, preview-cell.tsx 의 인라인 video 캡션이 cell.content 를
 * 원문 그대로 렌더했다. token-warning-panel.tsx 의 substitutedSourcesOf 는
 * choice_opt/ranking_opt 외 모든 셀의 content 를 "치환됨" 취급하므로, 빌더가 운영자에게
 * "이 자리는 치환된다"고 말하면서 실제로는 치환하지 않는 정직성 갭이었다.
 *
 * PreviewCell 이 image 를 ImageCell 에 위임하므로, ImageCell 내부에서 무조건 치환하면
 * mobile-original-row-table.tsx 의 사전 치환 경로(이미 substituteTokens 를 한 번 거친
 * cell.content 를 넘기는 경로)에서 이중 치환이 된다 — cell-options-container.tsx 의
 * opt-in content 오버라이드와 동일한 패턴으로 막는다.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImageCell } from '@/components/question-renderer/cells/image-cell';
import { PreviewCell } from '@/components/question-renderer/cells/preview-cell';
import { VideoCell } from '@/components/question-renderer/cells/video-cell';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import type { TableCell } from '@/types/survey';

afterEach(cleanup);

describe('ImageCell/VideoCell 캡션 — 응답 인용 치환 (인터랙티브 직접 경로, 항상 원문)', () => {
  it('ImageCell 캡션의 인용 토큰을 치환한다', () => {
    const cell = {
      id: 'c-image',
      type: 'image',
      imageUrl: 'https://cdn.example.com/photo.png',
      content: '{{{이름}}}님 사진',
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <ImageCell cell={cell} cellResponse={undefined} onUpdateValue={vi.fn()} questionId="q1" />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('홍길동님 사진')).toBeInTheDocument();
    expect(screen.queryByText('{{{이름}}}님 사진')).not.toBeInTheDocument();
  });

  it('VideoCell 캡션의 인용 토큰을 치환한다', () => {
    const cell = {
      id: 'c-video',
      type: 'video',
      videoUrl: 'https://cdn.example.com/clip.mp4',
      content: '{{{이름}}}님 영상',
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <VideoCell cell={cell} cellResponse={undefined} onUpdateValue={vi.fn()} questionId="q1" />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('홍길동님 영상')).toBeInTheDocument();
    expect(screen.queryByText('{{{이름}}}님 영상')).not.toBeInTheDocument();
  });
});

describe('PreviewCell — 직접 호출 경로(오버라이드 없음, 원문 cell.content)도 캡션을 치환한다', () => {
  it('image 델리게이션 캡션을 치환한다 (table-preview.tsx 직접 호출과 동일 경로)', () => {
    const cell = {
      id: 'c-image-preview',
      type: 'image',
      imageUrl: 'https://cdn.example.com/photo.png',
      content: '{{{이름}}}님 사진',
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <PreviewCell cell={cell} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('홍길동님 사진')).toBeInTheDocument();
    expect(screen.queryByText('{{{이름}}}님 사진')).not.toBeInTheDocument();
  });

  it('video 인라인 캡션을 치환한다 (델리게이션이 아닌 preview-cell.tsx 자체 렌더)', () => {
    const cell = {
      id: 'c-video-preview',
      type: 'video',
      videoUrl: 'https://cdn.example.com/clip.mp4',
      content: '{{{이름}}}님 영상',
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <PreviewCell cell={cell} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('홍길동님 영상')).toBeInTheDocument();
    expect(screen.queryByText('{{{이름}}}님 영상')).not.toBeInTheDocument();
  });
});

/**
 * mobile-original-row-table.tsx 사전 치환 경로 시뮬레이션 — 이중 치환 방지 회귀 테스트.
 *
 * quotes.인용 값 자체가 우연히 attrs 토큰 문법(`{{공격}}`)을 담고 있는 상황(응답자가 앞
 * 질문에 그 문자열을 그대로 입력했을 때 발생 가능). 올바른 단일 패스라면 화면에는 그
 * 리터럴 문자열이 그대로 보여야 한다. 만약 PreviewCell/ImageCell 이 이미 치환된
 * cell.content 를 다시 substituteTokens 에 넣으면(이중 치환), attrs.공격 값이 풀려
 * 화면에 노출된다 — 이것이 브리프가 경고한 PII 유출 메커니즘이다.
 */
describe('PreviewCell — content 오버라이드는 이중 치환을 막는다', () => {
  const attrs = { 공격: '남의명단값' };
  const quotes = { 인용: '{{공격}}' };
  // mobile-original-row-table.tsx 가 미리 한 번 치환해서 넘기는 값과 동일하게 준비.
  const preSubstituted = '{{공격}}';

  it('image: 오버라이드로 넘긴 캡션을 다시 치환하지 않는다', () => {
    const cell = {
      id: 'c-image-double',
      type: 'image',
      imageUrl: 'https://cdn.example.com/photo.png',
      // mobile-original-row-table.tsx 처럼 호출부가 이미 substituteTokens 를 한 번
      // 거친 값을 cell.content 에 넣어서 넘긴다.
      content: preSubstituted,
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={attrs} quotes={quotes}>
        <PreviewCell cell={cell} content={preSubstituted} />
      </ContactAttrsProvider>,
    );

    // 단일 패스: 리터럴 "{{공격}}" 문구가 그대로 보여야 한다.
    expect(screen.getByText('{{공격}}')).toBeInTheDocument();
    // 이중 치환이었다면 attrs.공격 값("남의명단값")이 풀려 나왔을 것이다.
    expect(screen.queryByText('남의명단값')).not.toBeInTheDocument();
  });

  it('video: 오버라이드로 넘긴 캡션을 다시 치환하지 않는다', () => {
    const cell = {
      id: 'c-video-double',
      type: 'video',
      videoUrl: 'https://cdn.example.com/clip.mp4',
      content: preSubstituted,
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={attrs} quotes={quotes}>
        <PreviewCell cell={cell} content={preSubstituted} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('{{공격}}')).toBeInTheDocument();
    expect(screen.queryByText('남의명단값')).not.toBeInTheDocument();
  });
});
