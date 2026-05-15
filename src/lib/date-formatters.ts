// 날짜·시각 표시 공통 포매터.
//
// 원칙: 화면 표시는 **사용자 브라우저의 timezone** 을 따른다. timezone 을 명시하지 않아
//      toLocaleString 이 런타임 환경의 기본 timezone 을 사용하도록 둔다.
//
// - formatLocal* 함수: Client 환경에서만 호출. 브라우저 timezone 으로 표시.
//   (Server Component 에서 직접 호출하면 서버 호스트 timezone — 보통 UTC — 으로 SSR HTML 이
//   박혀 사용자가 보는 시간과 어긋난다. Server Component 에서는 <LocalDateTime /> 컴포넌트 사용.)
// - formatKstForExport: Excel/CSV 등 서버에서 만들어 다운로드되는 산출물 전용. 한국 운영
//   컨텍스트로 timezone='Asia/Seoul' 을 고정.

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

function toDate(d: Date | string | number): Date {
  return d instanceof Date ? d : new Date(d);
}

/** 'YYYY. MM. DD. HH:mm' — 브라우저 timezone. Client 전용. */
export function formatLocalDateTime(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return '—';
  return toDate(d).toLocaleString(undefined, DATETIME_OPTIONS);
}

/** 'YYYY. MM. DD.' — 브라우저 timezone. Client 전용. */
export function formatLocalDate(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return '—';
  return toDate(d).toLocaleDateString(undefined, DATE_OPTIONS);
}

/** 'MM. DD. HH:mm' — 브라우저 timezone. Client 전용. */
export function formatLocalMonthDayTime(
  d: Date | string | number | null | undefined,
): string {
  if (d === null || d === undefined) return '—';
  return toDate(d).toLocaleString(undefined, MONTH_DAY_TIME_OPTIONS);
}

// Excel/CSV 다운로드용 — 한국 운영 컨텍스트 고정. Server 전용.
const KST_DATETIME_FMT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 'YYYY. MM. DD. HH:mm' — KST 고정. Excel/CSV 등 서버 출력 전용. */
export function formatKstDateTimeForExport(
  d: Date | string | number | null | undefined,
): string {
  if (d === null || d === undefined) return '';
  return KST_DATETIME_FMT.format(toDate(d));
}
