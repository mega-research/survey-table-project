/**
 * 메일 첨부 파일당 한도 (Bytes). mailAttachmentSchema (15MB) 와 일치.
 * 라우트(/api/upload/mail-attachment)와 UI 양쪽에서 동일 값 사용.
 */
export const MAX_ATTACHMENT_FILE_BYTES = 15 * 1024 * 1024;

/**
 * 메일당 첨부 총합 한도 (Bytes). Resend 공식 한도 40MB 에 base64 33% 오버헤드와
 * 본문/헤더 여유분을 뺀 안전 마진.
 */
export const MAX_ATTACHMENT_TOTAL_BYTES = 30 * 1024 * 1024;

/**
 * 첨부 파일 R2 prefix.
 * - tmp: 업로드 직후 임시 위치. 저장 안 하고 떠나면 24h R2 lifecycle 청소.
 * - permanent: 저장 시 promote 되는 영구 위치. cleanup orchestrator 가 diff 로 청소.
 */
export const TMP_ATTACHMENT_PREFIX = 'tmp/mail-attachment/';
export const PERMANENT_ATTACHMENT_PREFIX = 'mail-attachment/';

/**
 * 테스트 발송용 sandbox 수신거부 토큰.
 * /unsubscribe/[token] 페이지가 이 값을 감지하면 실제 해지 없이 안내만 표시.
 */
export const UNSUBSCRIBE_SANDBOX_TOKEN = '__test__';

/** UUID v4 표준 형식 (대소문자 무관). unsubscribe token / template id 검증용. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
