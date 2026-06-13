import { pub, withRateLimit } from '@/server/orpc';

import { ContactAttrsOutput, LookupContactAttrsInput } from '../../domain/contact-attrs';
import * as svc from '../services/contact-attrs.service';

/**
 * inviteToken 으로 contact attrs 조회(pub). 익명 응답자도 호출 가능.
 * 무효 토큰이면 service 가 null 반환 — 호출부가 익명 폴백 처리.
 * 공개 읽기 조회이므로 lookup 그룹으로 IP 당 rate limit 한다.
 */
const lookup = pub
  .use(withRateLimit('lookup'))
  .input(LookupContactAttrsInput)
  .output(ContactAttrsOutput)
  .handler(({ input }) => svc.lookupContactAttrs(input));

export const attrs = {
  lookup,
};
