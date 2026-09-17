import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ValidationIssueBanner } from './validation-issue-banner';

describe('ValidationIssueBanner', () => {
  it('상자는 그 문항의 검증 안내 표식을 단다 — 「다음」이 막힌 뒤 스크롤 착지 지점', () => {
    render(
      <ValidationIssueBanner
        questionId="q1"
        items={[{ message: '필수 응답이 비어있습니다', cellIds: ['c1'] }]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('data-validation-notice', 'q1');
    expect(screen.getByRole('button', { name: '위치로 이동' })).toBeInTheDocument();
  });
});
