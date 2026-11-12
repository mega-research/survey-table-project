/**
 * 회신 전달 규칙 — 전달 메일의 상태 알림 가려내기.
 * 발송 때 붙인 `kind=reply-forward` 태그가 상태 알림(webhook)에 실려 돌아온다.
 */
import { describe, expect, it } from 'vitest';

import {
  REPLY_FORWARD_TAG,
  hasReplyForwardTag,
  isReplyForwardDeliveryFailure,
} from './reply-forward';

describe('hasReplyForwardTag — 상태 알림의 태그가 전달 메일의 것인가', () => {
  it.each<[string, unknown, boolean]>([
    ['알림의 객체 모양', { kind: 'reply-forward' }, true],
    ['다른 태그가 함께 있어도', { kind: 'reply-forward', campaign_id: 'c1' }, true],
    ['발송 요청과 같은 목록 모양', [{ name: 'kind', value: 'reply-forward' }], true],
    ['목록의 다른 태그 사이에 있어도', [{ name: 'a', value: 'b' }, { ...REPLY_FORWARD_TAG }], true],
    ['단체 발송의 태그', { kind: 'campaign', campaign_id: 'c1', recipient_id: 'r1' }, false],
    ['테스트 발송의 태그', { kind: 'template-test' }, false],
    ['값만 같은 다른 이름의 태그', { category: 'reply-forward' }, false],
    ['이름만 같은 목록 태그', [{ name: 'kind', value: 'campaign' }], false],
    ['대소문자가 다르면 아니다', { kind: 'Reply-Forward' }, false],
    ['빈 객체', {}, false],
    ['빈 목록', [], false],
    ['목록 속 null', [null], false],
    ['태그 없음', undefined, false],
    ['null', null, false],
    ['글자', 'kind=reply-forward', false],
  ])('%s', (_name, tags, expected) => {
    expect(hasReplyForwardTag(tags)).toBe(expected);
  });
});

describe('isReplyForwardDeliveryFailure — 전달 메일이 닿지 못했다는 알림인가', () => {
  it.each<[string, boolean]>([
    ['email.bounced', true],
    ['email.failed', true],
    ['email.sent', false],
    ['email.delivered', false],
    ['email.opened', false],
    ['email.clicked', false],
    ['email.complained', false],
    ['email.delivery_delayed', false],
    ['email.received', false],
  ])('%s → %s', (eventType, expected) => {
    expect(isReplyForwardDeliveryFailure(eventType)).toBe(expected);
  });
});
