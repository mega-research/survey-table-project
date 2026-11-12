import { describe, expect, it } from 'vitest';

import { MAX_RECIPIENTS_PER_MAIL } from '@/lib/mail/split-email-addresses';

import {
  MAX_SENDER_ACCOUNTS,
  buildForwardMail,
  collectReplyAddresses,
  extractSenderAccounts,
  findCompanyDomainMatch,
  formatForwardFrom,
  mergeForwardAddresses,
  parseMailbox,
  sanitizeDisplayName,
  type ReceivedReply,
} from './reply-forward';

const SEND_DOMAIN = 'send.example.co.kr';

describe('extractSenderAccounts — 받는 주소에서 보낸이 계정 뽑기', () => {
  it.each<[string, string[], string[]]>([
    ['발송 전용 도메인의 주소만 본다', ['survey@send.example.co.kr', 'boss@example.co.kr'], ['survey']],
    ['대소문자를 무시한다', ['Survey@SEND.Example.co.kr'], ['survey']],
    ['같은 계정은 한 번만', ['survey@send.example.co.kr', 'SURVEY@send.example.co.kr'], ['survey']],
    ['계정이 여럿이면 받은 순서대로', ['b@send.example.co.kr', 'a@send.example.co.kr'], ['b', 'a']],
    ['꺾쇠로 감싼 주소도 읽는다', ['<survey@send.example.co.kr>'], ['survey']],
    ['비슷한 도메인은 아니다', ['survey@send.example.co.kr.evil.com', 'x@notsend.example.co.kr'], []],
    ['@ 앞이 비면 계정이 아니다', ['@send.example.co.kr'], []],
    ['하나도 없으면 빈 배열', [], []],
  ])('%s', (_name, receivedFor, expected) => {
    expect(extractSenderAccounts(receivedFor, SEND_DOMAIN)).toEqual(expected);
  });
});

describe('extractSenderAccounts — 상한', () => {
  it('받는 주소를 부풀린 메일은 앞에서부터 상한까지만 본다', () => {
    const receivedFor = Array.from({ length: MAX_SENDER_ACCOUNTS + 5 }, (_, i) => `acct${i}@${SEND_DOMAIN}`);
    const accounts = extractSenderAccounts(receivedFor, SEND_DOMAIN);
    expect(accounts).toHaveLength(MAX_SENDER_ACCOUNTS);
    expect(accounts[0]).toBe('acct0');
  });
});

describe('parseMailbox — 보낸 사람 표기 읽기', () => {
  it.each<[string, string, { name: string; address: string } | null]>([
    ['이름과 주소', '김응답 <kim@corp.co.kr>', { name: '김응답', address: 'kim@corp.co.kr' }],
    ['따옴표 이름 속 쉼표', '"Kim, Eungdap" <kim@corp.co.kr>', { name: 'Kim, Eungdap', address: 'kim@corp.co.kr' }],
    ['주소만', 'kim@corp.co.kr', { name: '', address: 'kim@corp.co.kr' }],
    ['MIME 로 인코딩된 이름', '=?UTF-8?B?6rmA7J2R64u1?= <kim@corp.co.kr>', { name: '김응답', address: 'kim@corp.co.kr' }],
    ['주소 모양이 아니면 null', '담당자 부재', null],
    ['빈 값은 null', '  ', null],
  ])('%s', (_name, raw, expected) => {
    expect(parseMailbox(raw)).toEqual(expected);
  });
});

describe('sanitizeDisplayName — 보낸 사람 이름 정제', () => {
  it.each<[string, string, string]>([
    ['보통 이름은 그대로', '김응답', '김응답'],
    ['줄바꿈으로 헤더를 끼워 넣지 못한다', '김응답\r\nBcc: evil@x.com', '김응답 Bcc: evil@x.com'],
    ['제어 문자를 걷어낸다', '김\u0000응\u0007답\u007f', '김응답'],
    ['꺾쇠와 큰따옴표를 걷어낸다', '"김응답" <evil@x.com>', '김응답 evil@x.com'],
    ['역슬래시를 걷어낸다', '김\\응답', '김응답'],
    ['앞뒤 공백과 겹친 공백을 정리한다', '  김   응답  ', '김 응답'],
    ['전부 걷히면 빈 문자열', '<>"\r\n', ''],
  ])('%s', (_name, raw, expected) => {
    expect(sanitizeDisplayName(raw)).toBe(expected);
  });

  it('길면 100자에서 자른다', () => {
    expect(sanitizeDisplayName('가'.repeat(300))).toBe('가'.repeat(100));
  });
});

describe('formatForwardFrom — 전달 메일의 보낸 사람 표기', () => {
  it.each<[string, string | null, string]>([
    ['응답자가 쓴 이름', '김응답', '김응답 <survey@send.example.co.kr>'],
    ['이름이 없으면 응답자 주소', null, '"kim@corp.co.kr" <survey@send.example.co.kr>'],
    ['정제하고 나니 빈 이름이면 응답자 주소', '<>', '"kim@corp.co.kr" <survey@send.example.co.kr>'],
    ['쉼표가 든 이름은 따옴표로 감싼다', 'Kim, Eungdap', '"Kim, Eungdap" <survey@send.example.co.kr>'],
    ['주입 문자는 표기를 깨지 못한다', 'a" <evil@x.com>\r\nBcc: b@x.com', '"a evil@x.com Bcc: b@x.com" <survey@send.example.co.kr>'],
  ])('%s', (_name, senderName, expected) => {
    expect(
      formatForwardFrom({
        senderName,
        senderAddress: 'kim@corp.co.kr',
        senderAccount: 'survey',
        sendDomain: SEND_DOMAIN,
      }),
    ).toBe(expected);
  });
});

describe('collectReplyAddresses — 회신 주소 값에서 전달 주소 후보 모으기', () => {
  it.each<[string, Array<string | null>, string[]]>([
    ['빈 값과 null 은 후보가 아니다', [null, '', '   ', 'help@example.co.kr'], ['help@example.co.kr']],
    ['대소문자만 다른 주소는 한 번만 — 먼저 온 표기', ['Help@Example.co.kr', 'help@example.co.kr'], ['Help@Example.co.kr']],
    ['발송 전용 도메인의 주소는 전달 주소가 될 수 없다', ['survey@send.example.co.kr', 'SURVEY@Send.Example.co.kr'], []],
    ['받은 순서를 지킨다', ['b@example.co.kr', 'a@example.co.kr'], ['b@example.co.kr', 'a@example.co.kr']],
    ['주소 모양이 아닌 값은 버린다', ['담당자 미정'], []],
  ])('%s', (_name, values, expected) => {
    expect(collectReplyAddresses(values, SEND_DOMAIN)).toEqual(expected);
  });
});

describe('mergeForwardAddresses — 계정별 전달 주소 합치기', () => {
  it('중복 없이 합치고 앞 계정의 주소가 먼저다', () => {
    expect(
      mergeForwardAddresses([
        ['a@example.co.kr', 'b@example.co.kr'],
        ['B@example.co.kr', 'c@example.co.kr'],
      ]),
    ).toEqual(['a@example.co.kr', 'b@example.co.kr', 'c@example.co.kr']);
  });

  it('한 통의 수신자 상한을 넘으면 앞(최근)부터 남긴다', () => {
    const many = Array.from({ length: MAX_RECIPIENTS_PER_MAIL + 5 }, (_, i) => `u${i}@example.co.kr`);
    const merged = mergeForwardAddresses([many]);
    expect(merged).toHaveLength(MAX_RECIPIENTS_PER_MAIL);
    expect(merged[0]).toBe('u0@example.co.kr');
  });
});

describe('findCompanyDomainMatch — 회사 도메인에서 온 메일 판정', () => {
  const forwardAddresses = ['help@example.co.kr'];

  it.each<[string, string, string[], ReturnType<typeof findCompanyDomainMatch>]>([
    ['발송 전용 도메인에서 온 메일', 'survey@send.example.co.kr', forwardAddresses, { kind: 'send_domain' }],
    ['발송 전용 도메인은 대소문자를 무시한다', 'x@SEND.Example.co.kr', forwardAddresses, { kind: 'send_domain' }],
    ['전달 주소와 같은 도메인', 'boss@Example.co.kr', forwardAddresses, { kind: 'reply_domain', external: false }],
    ['다른 회사에서 온 답장은 아니다', 'kim@corp.co.kr', forwardAddresses, null],
    ['하위 도메인은 같은 도메인이 아니다', 'kim@mail.example.co.kr', forwardAddresses, null],
    ['전달 주소가 없으면 발송 전용 도메인만 본다', 'boss@example.co.kr', [], null],
    [
      '회신 주소가 외부 메일이면 같은 도메인 응답자가 막힌다 — external 로 알린다',
      'kim@gmail.com',
      ['manager@gmail.com'],
      { kind: 'reply_domain', external: true },
    ],
  ])('%s', (_name, senderAddress, addresses, expected) => {
    expect(findCompanyDomainMatch(senderAddress, SEND_DOMAIN, addresses)).toEqual(expected);
  });
});

describe('buildForwardMail — 받은 메일을 전달 메일로', () => {
  const reply: ReceivedReply = {
    senderAddress: 'kim@corp.co.kr',
    senderName: '김응답',
    replyTo: [],
    subject: 'RE: 설문 회신드립니다',
    html: '<p>스캔본 보냅니다 <img src="cid:sign@corp"></p>',
    text: '스캔본 보냅니다',
    attachments: [
      { filename: '설문지.pdf', mimeType: 'application/pdf', contentId: null, contentBase64: 'UERG' },
      { filename: 'sign.png', mimeType: 'image/png', contentId: '<sign@corp>', contentBase64: 'UE5H' },
    ],
  };
  const build = (overrides: Partial<ReceivedReply> = {}) =>
    buildForwardMail({
      reply: { ...reply, ...overrides },
      senderAccount: 'survey',
      sendDomain: SEND_DOMAIN,
      forwardAddresses: ['help@example.co.kr'],
    });

  it('제목·본문·첨부를 받은 그대로 옮기고 본문 속 이미지는 내용 ID 를 유지한다', () => {
    expect(build()).toEqual({
      from: '김응답 <survey@send.example.co.kr>',
      to: ['help@example.co.kr'],
      replyTo: ['kim@corp.co.kr'],
      subject: 'RE: 설문 회신드립니다',
      html: '<p>스캔본 보냅니다 <img src="cid:sign@corp"></p>',
      text: '스캔본 보냅니다',
      attachments: [
        { filename: '설문지.pdf', content: 'UERG', contentType: 'application/pdf' },
        { filename: 'sign.png', content: 'UE5H', contentType: 'image/png', contentId: 'sign@corp' },
      ],
      tags: [{ name: 'kind', value: 'reply-forward' }],
    });
  });

  it('받은 메일에 답장 주소가 따로 있으면 그것을 쓴다', () => {
    expect(build({ replyTo: ['team@corp.co.kr'] }).replyTo).toEqual(['team@corp.co.kr']);
  });

  it.each<[string, string | null]>([
    ['빈 제목', ''],
    ['공백뿐인 제목', '   '],
    ['제목 없음', null],
  ])('%s 은 「(제목 없음)」이 된다', (_name, subject) => {
    expect(build({ subject }).subject).toBe('(제목 없음)');
  });

  it('본문이 한쪽만 있으면 그쪽만 싣는다', () => {
    const mail = build({ html: null });
    expect(mail.html).toBeUndefined();
    expect(mail.text).toBe('스캔본 보냅니다');
  });

  it('본문이 아예 없으면(첨부만 보낸 메일) 발송이 거절되지 않게 자리 채움 글자를 싣는다', () => {
    const mail = build({ html: null, text: '' });
    expect(mail.html).toBeUndefined();
    expect(mail.text).toBe('(본문 없음)');
  });

  it('이름 없는 첨부에는 종류에 맞는 이름을 붙인다', () => {
    const mail = build({
      attachments: [
        { filename: null, mimeType: 'image/jpeg', contentId: '<a@b>', contentBase64: 'QQ==' },
        { filename: '  ', mimeType: 'application/octet-stream', contentId: null, contentBase64: 'Qg==' },
      ],
    });
    expect(mail.attachments.map((a) => a.filename)).toEqual(['attachment-1.jpg', 'attachment-2']);
  });
});
