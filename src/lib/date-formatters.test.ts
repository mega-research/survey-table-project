import { describe, expect, it } from 'vitest';

import {
  formatKstDateTimeForExport,
  formatLocalDate,
  formatLocalDateTime,
  formatLocalMonthDayTime,
} from '@/lib/date-formatters';

// 2026-10-08 03:05 UTC = 한국시 2026-10-08 12:05.
const AT = new Date('2026-10-08T03:05:00Z');
// UTC 로는 전날이지만 한국시로는 다음 날 — 시간대 고정이 풀리면 날짜가 하루 밀린다.
const LATE_UTC = new Date('2026-10-07T15:30:00Z');

/**
 * 표시 포매터는 **실행 환경의 로케일·시간대와 무관하게** 같은 문자열을 내야 한다.
 *
 * 이 스위트는 호스트 로케일이 en-US 인 환경(로컬·CI·Vercel)에서 돈다. 로케일을 비워 두면
 * 여기서 `10/08/2026` 이 나오고 브라우저(ko-KR)는 `2026. 10. 08.` 을 그려 hydration 이 깨진다.
 * 기대값을 리터럴로 못 박는 것이 그 회귀를 잡는 방법이다.
 */
describe('표시 포매터 — 한국시·한국어 표기 고정', () => {
  it('formatLocalDate 는 YYYY. MM. DD. 를 낸다', () => {
    expect(formatLocalDate(AT)).toBe('2026. 10. 08.');
  });

  it('formatLocalDateTime 은 YYYY. MM. DD. HH:mm 을 낸다', () => {
    expect(formatLocalDateTime(AT)).toBe('2026. 10. 08. 12:05');
  });

  it('formatLocalMonthDayTime 은 MM. DD. HH:mm 을 낸다', () => {
    expect(formatLocalMonthDayTime(AT)).toBe('10. 08. 12:05');
  });

  it('날짜는 한국시 기준이다 — UTC 로 전날 저녁이면 다음 날로 적는다', () => {
    expect(formatLocalDate(LATE_UTC)).toBe('2026. 10. 08.');
  });

  it('문자열·숫자 입력도 같은 값을 낸다', () => {
    expect(formatLocalDate(AT.toISOString())).toBe('2026. 10. 08.');
    expect(formatLocalDate(AT.getTime())).toBe('2026. 10. 08.');
  });

  it('값이 없으면 줄표를 낸다', () => {
    expect(formatLocalDate(null)).toBe('—');
    expect(formatLocalDateTime(undefined)).toBe('—');
    expect(formatLocalMonthDayTime(null)).toBe('—');
  });

  it('화면 표기와 내보내기 표기가 같은 모양이다', () => {
    expect(formatKstDateTimeForExport(AT)).toBe(formatLocalDateTime(AT));
  });
});
