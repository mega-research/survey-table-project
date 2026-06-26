import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AlreadyRespondedView } from '@/components/survey/already-responded-view';

describe('AlreadyRespondedView', () => {
  it('문의 이메일을 mailto 링크가 아닌 텍스트로 표시한다', () => {
    render(
      <AlreadyRespondedView
        reason="token_already_used"
        surveyTitle="테스트 설문"
        contactEmail="admin@example.com"
      />,
    );

    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('[href^="mailto:"]')).toBeNull();
  });
});
