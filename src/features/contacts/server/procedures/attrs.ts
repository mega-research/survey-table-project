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
  .errors({
    INVALID_TEST_LINK: {
      status: 410,
      message: '테스트 모드가 종료되었거나 이 링크를 더 이상 사용할 수 없습니다.',
    },
  })
  .input(LookupContactAttrsInput)
  .output(ContactAttrsOutput)
  .handler(async ({ input, errors }) => {
    try {
      return await svc.lookupContactAttrs(input);
    } catch (error) {
      if (error instanceof svc.InvalidTestLinkError) {
        throw errors.INVALID_TEST_LINK();
      }
      throw error;
    }
  });

export const attrs = {
  lookup,
};
