'use client';

// 날짜·시각 표시 client wrapper — 한국시(Asia/Seoul) 고정 (2026-08-12 변경).
// 이전에는 브라우저 timezone 에 위임했으나, SSR HTML 이 서버 호스트 timezone(UTC)으로
// 박힌 뒤 suppressHydrationWarning 때문에 hydration 이 텍스트를 패치하지 않아 배포
// 환경에서 재렌더 전까지 UTC 가 그대로 노출됐다. KST 고정으로 서버/클라이언트가 항상
// 같은 문자열을 그린다. suppressHydrationWarning 은 Node/브라우저 ICU 버전 차이로 인한
// 미세 표기 차이 대비 안전판으로만 유지.

const DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

const MONTH_DAY_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

const SHORT_MONTH_DAY_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Seoul',
  month: 'short',
  day: 'numeric',
};

const SHORT_MONTH_DAY_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Seoul',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

const FORMAT_MAP = {
  datetime: DATETIME_OPTIONS,
  date: DATE_OPTIONS,
  'month-day-time': MONTH_DAY_TIME_OPTIONS,
  'short-month-day': SHORT_MONTH_DAY_OPTIONS,
  'short-month-day-time': SHORT_MONTH_DAY_TIME_OPTIONS,
} as const;

type FormatKind = keyof typeof FORMAT_MAP;

interface Props {
  value: Date | string | number | null | undefined;
  format?: FormatKind;
  fallback?: string;
  className?: string;
}

export function LocalDateTime({
  value,
  format = 'datetime',
  fallback = '—',
  className,
}: Props) {
  if (value === null || value === undefined) {
    return <span className={className}>{fallback}</span>;
  }
  const date = value instanceof Date ? value : new Date(value);
  // 빈 문자열·파싱 불가 문자열 등으로 Invalid Date 가 되면 toISOString() 이
  // RangeError 를 던져 렌더 트리가 통째로 죽는다. fallback 으로 안전하게 대체한다.
  if (Number.isNaN(date.getTime())) {
    return <span className={className}>{fallback}</span>;
  }
  return (
    <time
      dateTime={date.toISOString()}
      suppressHydrationWarning
      className={className}
    >
      {/* 로케일 고정: 브라우저 로케일(en-US 등)이면 월/일/년으로 뒤집혀 한국식(년.월.일)으로 통일 */}
      {date.toLocaleString('ko-KR', FORMAT_MAP[format])}
    </time>
  );
}
