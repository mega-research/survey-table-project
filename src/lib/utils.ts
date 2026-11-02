// 클래스 병합은 shadcn 의 cn 패키지(clsx + tailwind-merge 대체)다. `shadcn add` 로 받는 컴포넌트가
// 이 패키지를 직접 import 하므로, 앱 전체가 한 병합 규칙을 쓰도록 여기서도 같은 것을 내보낸다.
// 옮길 때(2026-11-02) 레포의 클래스 문자열로 만든 조합 8.4만 건에서 twMerge(clsx()) 와 결과가 같았다.
export { cn } from 'cn';

/**
 * UUID 형식인지 확인하는 함수
 * @param id 확인할 ID 문자열
 * @returns UUID 형식이면 true, 아니면 false
 */
export function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * UUID v4 생성 (클라이언트/서버 모두 지원)
 * @returns UUID v4 문자열
 */
/**
 * TipTap 에디터가 빈 상태일 때 생성하는 HTML인지 확인
 */
export function isEmptyHtml(html: string | undefined | null): boolean {
  if (!html) return true;
  const trimmed = html.trim();
  return trimmed === '' || trimmed === '<p></p>' || trimmed === '<p><br></p>' || trimmed === '<p><br/></p>';
}

/**
 * 바이트 수를 사람이 읽기 좋은 단위 (B / KB / MB) 로 포맷.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function generateId(): string {
  // crypto.randomUUID()가 지원되면 사용
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // 폴백: 수동 UUID v4 생성
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
