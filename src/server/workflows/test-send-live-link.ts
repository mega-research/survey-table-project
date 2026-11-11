import 'server-only';

import { IMG_TAG_RE } from '@/lib/mail/image-link-area';
import { splitContactTokenKeys } from '@/lib/survey/substitute-tokens';
import { logger } from '@/lib/logger';
import { ensureTestSendTarget } from '@/server/contacts/services/test-send-target';
import { loadOperationsDataScope } from '@/server/data-scope';
import type {
  SendTestTemplateMailInput,
  SendTestTemplateMailOutput,
} from '@/server/mail/domain/mail-preview';
import { sendTestTemplateMail } from '@/server/mail/services/preview';
import { getFirstContactSample } from '@/server/read-models/contact-sample';

const TOKEN_RE = /\{\{([^{}]*)\}\}/g;

/**
 * 이 템플릿이 초대 링크를 쓰는가 — 렌더러(`lib/mail/render-preview`)와 같은 기준으로 본다.
 * - `{{invite_link}}` 변수(대체 문법 `{{invite_link || …}}` 포함, 이미지 클릭 영역의 주소에 적은 것 포함)
 * - 주소를 비운 이미지 클릭 영역(기본 주소가 초대 링크다 — `DEFAULT_LINK_HREF`)
 * 글자로만 적은 invite_link 나 이름이 비슷한 다른 변수는 아니다.
 */
function usesInviteLink(input: Pick<SendTestTemplateMailInput, 'subject' | 'bodyHtml'>): boolean {
  for (const text of [input.subject, input.bodyHtml]) {
    for (const match of text.matchAll(TOKEN_RE)) {
      if (splitContactTokenKeys(match[1] ?? '').includes('invite_link')) return true;
    }
  }
  for (const tag of input.bodyHtml.match(IMG_TAG_RE) ?? []) {
    if (!/\bdata-link-(?:rect|bands)=/i.test(tag)) continue;
    const href = tag.match(/\bdata-link-href="([^"]*)"/i)?.[1]?.trim() ?? '';
    if (href === '') return true;
  }
  return false;
}

/**
 * 메일 「테스트 발송」 — 초대 링크를 눌러서 열리는 테스트 대상자 링크로 만든 뒤 보낸다
 * (CONTEXT.md 「테스트 발송」).
 *
 * contacts(테스트 사본 대상자)와 mail(발송) 두 도메인의 쓰기를 잇는다:
 *   1. 메일 본문 치환과 같은 샘플(이 브라우저가 보는 파티션의 첫 조사 대상)을 고른다.
 *   2. `ensureTestSendTarget` 이 그 샘플의 테스트 대상자 링크를 정한다 — 실제 대상자면 테스트 사본.
 *   3. 사본 트랜잭션이 커밋된 뒤 발송한다. 발송이 실패해도 사본은 남고 다음 발송이 다시 쓴다.
 *      본문 치환은 그 테스트 대상자의 명단 값으로 한다 — 발송이 샘플을 다시 읽으면 그 사이 고쳐진
 *      값으로 본문과 링크가 어긋난다.
 *
 * 테스트 모드가 꺼져 있거나 게스트·조사 대상 0명·테스트 대상자 0명이면 종전대로 견본 링크다. 테스트 대상자가 상한이라
 * 새 사본을 못 만들면 **발송하지 않고** 사유를 결과객체로 돌려준다(열리지 않는 링크를 조용히 보내지 않는다).
 */
export async function sendTestTemplateMailWithLiveLink(
  input: SendTestTemplateMailInput,
  isGuest: boolean,
): Promise<SendTestTemplateMailOutput> {
  // 초대 링크 변수가 없는 템플릿은 넣을 자리가 없다 — 사본을 만들지 않고, 링크 종류도 알리지 않는다.
  if (!usesInviteLink(input)) {
    const { inviteLink: _none, ...result } = await sendTestTemplateMail(input, {});
    return result;
  }

  const scope = await loadOperationsDataScope(input.surveyId);
  const sample = await getFirstContactSample(input.surveyId, scope);
  if (!sample) return sendTestTemplateMail(input, {});

  const target = await ensureTestSendTarget({
    surveyId: input.surveyId,
    sampleTargetId: sample.id,
    recipientEmail: input.to,
    isGuest,
  });
  if (target.kind === 'limit') return { ok: false, error: target.message };
  if (target.kind === 'live' && target.created) {
    // 수신 주소는 싣지 않는다(개인정보).
    logger.info({ surveyId: input.surveyId }, '[test-send] 테스트 사본 대상자를 만들었다');
  }
  return sendTestTemplateMail(
    input,
    target.kind === 'live' ? { testInviteCode: target.inviteCode, sampleAttrs: target.attrs } : {},
  );
}
