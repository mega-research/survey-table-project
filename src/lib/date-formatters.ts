// 날짜·시각 표시 공통 포매터.
//
// 원칙(2026-08-12 변경): 화면 표시도 **한국시(Asia/Seoul) 고정**.
//   이전 원칙(브라우저 timezone 위임)은 SSR HTML 이 서버 호스트 timezone(UTC)으로 박힌 뒤
//   suppressHydrationWarning 때문에 hydration 이 텍스트를 패치하지 않아, 배포 환경에서
//   재렌더 전까지 UTC 가 그대로 노출되는 문제가 있었다. 한국 운영 컨텍스트로 고정하면
//   서버/클라이언트가 항상 같은 문자열을 그려 이 문제 자체가 사라진다.
//
// - formatLocal* 함수: KST 고정 표시. (이름의 Local 은 호출부 시그니처 유지를 위해 남긴
//   것으로 "브라우저 로컬"이 아니라 화면 표시용이라는 의미로 읽을 것.)
// - Server Component 에서는 <LocalDateTime /> 컴포넌트 사용.
// - formatKstForExport: Excel/CSV 등 서버에서 만들어 다운로드되는 산출물 전용.

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

function toDate(d: Date | string | number): Date {
  return d instanceof Date ? d : new Date(d);
}

/** 'YYYY. MM. DD. HH:mm' — KST 고정. */
export function formatLocalDateTime(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return '—';
  return toDate(d).toLocaleString(undefined, DATETIME_OPTIONS);
}

/** 'YYYY. MM. DD.' — KST 고정. */
export function formatLocalDate(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return '—';
  return toDate(d).toLocaleDateString(undefined, DATE_OPTIONS);
}

/** 'MM. DD. HH:mm' — KST 고정. */
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
