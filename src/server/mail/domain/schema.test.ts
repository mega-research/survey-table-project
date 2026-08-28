import { describe, expect, it } from 'vitest';

import { mailTemplateInputSchema } from './schema';

/**
 * 회신 주소는 **선택 입력**이다 (티켓 20).
 *
 * 비우면 발송 시점의 설문 소유자에게 답장이 간다. 필수로 두면 소유자 연동이 도달 불가능한
 * 기능이 되므로(누구도 비울 수 없다) 계약이 그 자리를 열어 둔다. 빈 문자열·공백은 「미설정」
 * 으로 정규화한다 — 컬럼에 빈 문자열이 들어가면 `?? 소유자` 폴백이 서지 않고 회신 헤더가
 * 빈 채로 나간다.
 */
const BASE = {
  name: '초대 메일',
  subject: '조사 안내',
  bodyHtml: '<p>본문</p>',
  fromLocal: 'survey',
  fromName: '메가리서치',
  attachments: [],
};

describe('mailTemplateInputSchema replyTo', () => {
  it('유효한 이메일은 그대로 통과한다', () => {
    const parsed = mailTemplateInputSchema.parse({ ...BASE, replyTo: 'info@example.kr' });
    expect(parsed.replyTo).toBe('info@example.kr');
  });

  it('빈 문자열은 미설정(null)으로 정규화한다', () => {
    expect(mailTemplateInputSchema.parse({ ...BASE, replyTo: '' }).replyTo).toBeNull();
  });

  it('공백만 입력해도 미설정이다', () => {
    expect(mailTemplateInputSchema.parse({ ...BASE, replyTo: '   ' }).replyTo).toBeNull();
  });

  it('필드를 아예 보내지 않아도 미설정이다', () => {
    expect(mailTemplateInputSchema.parse(BASE).replyTo).toBeNull();
  });

  it('이메일 형식이 아니면 거부한다 — 비우는 것과 잘못 적는 것은 다르다', () => {
    expect(mailTemplateInputSchema.safeParse({ ...BASE, replyTo: 'not-an-email' }).success).toBe(
      false,
    );
  });
});
