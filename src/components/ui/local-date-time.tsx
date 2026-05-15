'use client';

// Server Component 안에서 사용자 브라우저 timezone 으로 날짜를 표시하기 위한 client wrapper.
// SSR HTML 은 서버 호스트 timezone(보통 UTC)으로 박히지만 hydration 후 클라이언트에서
// toLocaleString 이 다시 실행되며 사용자 timezone 으로 교체된다. mismatch 는
// suppressHydrationWarning 으로 무시한다.

const DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

const MONTH_DAY_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

const SHORT_MONTH_DAY_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
};

const SHORT_MONTH_DAY_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
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
  return (
    <time
      dateTime={date.toISOString()}
      suppressHydrationWarning
      className={className}
    >
      {date.toLocaleString(undefined, FORMAT_MAP[format])}
    </time>
  );
}
