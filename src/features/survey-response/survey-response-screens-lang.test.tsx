import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  DesktopOnlyScreen,
  SurveyCompletedScreen,
} from '@/features/survey-response/survey-response-screens';
import { screenLang } from '@/features/survey-response/system-text';

/**
 * 전체 화면 안내는 `lang` 을 단 본문 컨테이너보다 앞에서 그려진다 — 루트에 언어를 달지 않으면 언어별 글꼴 규칙
 * (`[lang|="vi"]`·`[lang|="zh"]`)과 스크린리더 발음이 빠진다(2026-11-24 Codex 리뷰).
 */
describe('전체 화면 안내의 lang', () => {
  it('한국어·미정은 달지 않고 그 밖의 언어만 단다', () => {
    expect(screenLang('ko')).toBeUndefined();
    expect(screenLang(null)).toBeUndefined();
    expect(screenLang(undefined)).toBeUndefined();
    expect(screenLang('vi')).toBe('vi');
    expect(screenLang('zh')).toBe('zh');
  });

  it('베트남어로 끝낸 응답의 완료 화면은 루트가 lang=vi 다 — 저작자 완료 문구도 그 글꼴을 물려받는다', () => {
    const { container, getByText } = render(
      <SurveyCompletedScreen thankYouMessage="Chân thành cảm ơn bạn" locale="vi" showCompletedTime={false} />,
    );
    expect(container.firstElementChild).toHaveAttribute('lang', 'vi');
    expect(getByText('Chân thành cảm ơn bạn').closest('[lang]')).toBe(container.firstElementChild);
    expect(getByText('Đã hoàn thành!')).toBeInTheDocument();
  });

  it('다국어 아닌 설문(한국어)의 완료·PC 안내 화면에는 lang 이 없다 — 종전 화면 그대로', () => {
    const completed = render(<SurveyCompletedScreen thankYouMessage="감사합니다" showCompletedTime={false} />);
    expect(completed.container.querySelectorAll('[lang]')).toHaveLength(0);
    const desktop = render(<DesktopOnlyScreen />);
    expect(desktop.container.querySelectorAll('[lang]')).toHaveLength(0);
  });
});
