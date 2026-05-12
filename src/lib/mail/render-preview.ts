/**
 * 메일 템플릿의 {{key}} 변수를 첫 컨택 샘플 데이터로 치환해
 * 미리보기 다이얼로그용 HTML 을 만든다.
 *
 * - 일반 텍스트 영역의 {{key}} 는 시각 강조용 span 으로 감싼다 (missing/empty 케이스).
 * - 태그 내부(attribute value)의 {{key}} 는 raw text 로만 치환해 HTML 구조를 보존한다.
 *   예: <a href="https://example.com?utm={{name}}"> 같은 케이스에서 attribute 가 깨지면 안 됨.
 * - attrs 값은 엑셀 업로드 출처이므로 HTML escape 필수.
 */

export interface PreviewSample {
  attrs: Record<string, string>;
  inviteUrl: string | null;
  email: string | null;
}

export interface PreviewResult {
  subject: string;
  bodyHtml: string;
  fromName: string;
}

/**
 * 'preview': missing/empty 키를 빨강·회색 span 으로 강조 — 다이얼로그 표시용.
 * 'send'   : missing/empty 키를 빈 문자열로 치환 — 실제 메일 발송용 (강조 마크업이
 *            메일 클라이언트로 들어가면 안 됨).
 */
export type RenderMode = 'preview' | 'send';

const TOKEN_RE = /\{\{([^}]+)\}\}/g;
const TAG_RE = /<[^>]+>/g;

type Resolved =
  | { kind: 'value'; text: string }
  | { kind: 'missing'; key: string }
  | { kind: 'empty'; key: string };

function resolveKey(key: string, sample: PreviewSample | null): Resolved {
  if (key === 'invite_link') {
    if (sample?.inviteUrl) return { kind: 'value', text: sample.inviteUrl };
    return { kind: 'missing', key };
  }
  if (!sample) return { kind: 'missing', key };
  if (!(key in sample.attrs)) return { kind: 'missing', key };
  const val = sample.attrs[key];
  if (typeof val !== 'string' || val.trim() === '') return { kind: 'empty', key };
  return { kind: 'value', text: val };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** attribute value 내부에 안전하게 들어갈 텍스트로 escape */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function missingSpan(key: string): string {
  return `<span class="mail-preview-missing" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:3px;padding:0 4px;font-size:0.9em;">{{${escapeHtml(key)}}}</span>`;
}

function emptySpan(key: string): string {
  return `<span class="mail-preview-empty" style="background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb;border-radius:3px;padding:0 4px;font-size:0.9em;font-style:italic;">(빈 값: ${escapeHtml(key)})</span>`;
}

/** plain-text (subject, fromName) 용 토큰 치환.
 *  preview 모드: HTML 컨텍스트(dangerouslySetInnerHTML) 출력 — 전체 escape + 강조 span.
 *  send 모드   : 메일 헤더(subject 등) 출력 — raw text, escape 하지 않음. */
function renderInlineText(s: string, sample: PreviewSample | null, mode: RenderMode): string {
  if (mode === 'send') {
    return s.replace(TOKEN_RE, (_, rawKey: string) => {
      const key = rawKey.trim();
      const r = resolveKey(key, sample);
      if (r.kind === 'value') return r.text;
      return '';
    });
  }
  const escaped = escapeHtml(s);
  return escaped.replace(TOKEN_RE, (_, rawKey: string) => {
    const key = rawKey.trim();
    const r = resolveKey(key, sample);
    if (r.kind === 'missing') return missingSpan(key);
    if (r.kind === 'empty') return emptySpan(key);
    return escapeHtml(r.text);
  });
}

/** body HTML 용 — 태그/텍스트 영역 분리 처리 */
function renderBodyHtml(html: string, sample: PreviewSample | null, mode: RenderMode): string {
  if (!html) return '';
  const out: string[] = [];
  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    if (m.index > lastIndex) {
      out.push(renderTextSegment(html.slice(lastIndex, m.index), sample, mode));
    }
    out.push(renderTagSegment(m[0], sample, mode));
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < html.length) {
    out.push(renderTextSegment(html.slice(lastIndex), sample, mode));
  }
  return out.join('');
}

function renderTextSegment(text: string, sample: PreviewSample | null, mode: RenderMode): string {
  // 텍스트 영역: 토큰 외 문자열은 이미 HTML 본문 안의 텍스트 노드이므로 추가 escape 불필요.
  // 단, preview 모드에서만 missing/empty span 으로 inline 강조 처리.
  return text.replace(TOKEN_RE, (_, rawKey: string) => {
    const key = rawKey.trim();
    const r = resolveKey(key, sample);
    if (r.kind === 'missing') return mode === 'send' ? '' : missingSpan(key);
    if (r.kind === 'empty') return mode === 'send' ? '' : emptySpan(key);
    return escapeHtml(r.text);
  });
}

function renderTagSegment(tag: string, sample: PreviewSample | null, mode: RenderMode): string {
  return tag.replace(TOKEN_RE, (_, rawKey: string) => {
    const key = rawKey.trim();
    const r = resolveKey(key, sample);
    if (r.kind === 'value') return escapeAttr(r.text);
    if (r.kind === 'empty') return '';
    // missing: send 모드도 attribute 안의 의미 없는 {{key}} 는 제거 (URL 깨짐 방지)
    return mode === 'send' ? '' : escapeAttr(`{{${key}}}`);
  });
}

export function renderMailPreview(input: {
  subject: string;
  bodyHtml: string;
  fromName: string;
  sample: PreviewSample | null;
  mode?: RenderMode;
}): PreviewResult {
  const mode: RenderMode = input.mode ?? 'preview';
  return {
    subject: renderInlineText(input.subject, input.sample, mode),
    bodyHtml: renderBodyHtml(input.bodyHtml, input.sample, mode),
    fromName: renderInlineText(input.fromName, input.sample, mode),
  };
}
