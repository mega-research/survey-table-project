import type { MailLinkKind } from '@/shared/contracts/mail';

/**
 * 링크 클릭 — 수신자가 누른 메일 본문 링크의 종류 판정 (CONTEXT.md 「링크 클릭」, ADR 0042).
 *
 * 발송 서비스는 글자 링크와 이미지에 건 링크를 구분하지 않고 도착 주소만 알려 준다. 그래서 종류는 주소로 정한다.
 * 「그 설문」의 주소인지는 따지지 않는다 — 우리 응답 화면 주소면 설문 링크다(슬러그가 발송 뒤에 바뀌어도
 * 종류가 뒤집히지 않게).
 */

/** 발송 서비스의 클릭 알림 종류. 수신자 상태로 옮기는 알림과 따로 처리한다. */
export const CLICKED_EVENT_TYPE = 'email.clicked';

/** 그 밖의 링크 주소를 저장할 때의 길이 상한. */
export const LINK_URL_MAX_LENGTH = 2000;

/** 브라우저 정보를 저장할 때의 길이 상한. */
export const USER_AGENT_MAX_LENGTH = 512;

/**
 * 수신자 한 명에게 남기는 클릭 줄 수 상한 — 메일 보안 장비가 같은 링크를 되풀이해 눌러도 표가 부풀지 않게.
 * 넘는 클릭은 버린다(「눌렀다」는 사실은 이미 남아 있다).
 */
export const MAX_CLICKS_PER_RECIPIENT = 200;

export interface ClassifiedLink {
  kind: MailLinkKind;
  /** 그 밖의 링크만 주소를 담는다. 설문·수신거부 주소에는 그 사람 전용 토큰이 들어 있어 남기지 않는다. */
  url: string | null;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function startsWithSegment(pathname: string, segment: string): boolean {
  return pathname === segment || pathname.startsWith(`${segment}/`);
}

/**
 * 누른 주소 → 링크 종류.
 *
 * - 앱 주소와 같은 호스트의 `/survey/…`(공개 링크·초대 링크) · `/i/…`(짧은 초대 링크) → 설문 링크
 * - 같은 호스트의 `/unsubscribe/…` → 수신거부
 * - 그 밖(다른 호스트, 주소로 읽히지 않는 글자, 앱 주소를 모를 때 포함) → 그 밖의 링크
 */
export function classifyClickedLink(link: string, appBaseUrl: string | null | undefined): ClassifiedLink {
  const other: ClassifiedLink = { kind: 'other', url: link.slice(0, LINK_URL_MAX_LENGTH) };
  const appHost = hostOf(appBaseUrl);
  if (!appHost) return other;

  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return other;
  }
  if (parsed.host.toLowerCase() !== appHost) return other;

  if (startsWithSegment(parsed.pathname, '/survey') || startsWithSegment(parsed.pathname, '/i')) {
    return { kind: 'survey', url: null };
  }
  if (startsWithSegment(parsed.pathname, '/unsubscribe')) {
    return { kind: 'unsubscribe', url: null };
  }
  return other;
}

/** 발송 서비스가 클릭 알림에 싣는 클릭 정보 — 모양이 다르면 null. */
export interface ResendClickData {
  link: string;
  /** 클릭 시각(ISO). 없거나 읽히지 않으면 호출부가 알림 생성 시각을 쓴다. */
  timestamp: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export function parseResendClick(raw: unknown): ResendClickData | null {
  if (raw === null || typeof raw !== 'object') return null;
  const click = raw as Record<string, unknown>;
  const link = click['link'];
  if (typeof link !== 'string' || link.trim() === '') return null;
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value : null;
  return {
    link,
    timestamp: text(click['timestamp']),
    ipAddress: text(click['ipAddress']),
    userAgent: text(click['userAgent']),
  };
}
