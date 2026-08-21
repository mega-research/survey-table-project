import 'server-only';

import { Resend } from 'resend';

let _resend: Resend | null = null;

/** Resend 클라이언트 lazy 싱글턴. send-bulk / campaign-reconcile 공용. */
export function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env['RESEND_API_KEY'];
    if (!apiKey) throw new Error('RESEND_API_KEY 환경변수가 설정되지 않았습니다.');
    _resend = new Resend(apiKey);
  }
  return _resend;
}
