import { describe, expect, it } from 'vitest';

import { MAX_RECIPIENTS_PER_MAIL } from '@/lib/mail/split-email-addresses';

import {
  FORWARD_SIZE_BUDGET_BYTES,
  MAX_SENDER_ACCOUNTS,
  buildForwardMail,
  buildOmittedAttachmentsNotice,
  buildReplyGuideNotice,
  detectForwardLoop,
  exceedsForwardSizeBudget,
  listOmittedAttachments,
  measureForwardSize,
  collectReplyAddresses,
  extractSenderAccounts,
  findCompanyDomainMatch,
  formatForwardFrom,
  mergeForwardAddresses,
  parseMailbox,
  sanitizeDisplayName,
  type OmittedAttachment,
  type ReceivedAttachment,
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
    // 전달 메일의 보낸 사람 주소는 `계정+중계 꼬리` 다 — 꼬리의 서명이 맞든 틀리든 계정은 + 앞이다.
    ['+ 뒤(중계 꼬리)는 떼고 본다', ['survey+kim=corp.co.kr=42a7387e98@send.example.co.kr'], ['survey']],
    ['꼬리의 모양이 달라도 + 앞이 계정이다', ['Survey+anything@send.example.co.kr'], ['survey']],
    ['꼬리만 다른 같은 계정은 한 번만', ['survey+a=b.c=0000000000@send.example.co.kr', 'survey@send.example.co.kr'], ['survey']],
    ['+ 앞이 비면 계정이 아니다', ['+kim=corp.co.kr=42a7387e98@send.example.co.kr'], []],
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
      headers: { 'X-Survey-Reply-Forward': '1', 'Auto-Submitted': 'auto-forwarded' },
      tags: [{ name: 'kind', value: 'reply-forward' }],
    });
  });

  it('첨부를 뺀 전달 메일에도 고리 표식 헤더가 붙는다', () => {
    const mail = buildForwardMail({
      reply,
      senderAccount: 'survey',
      sendDomain: SEND_DOMAIN,
      forwardAddresses: ['help@example.co.kr'],
      omitAttachments: true,
    });
    expect(mail.headers).toEqual({ 'X-Survey-Reply-Forward': '1', 'Auto-Submitted': 'auto-forwarded' });
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

describe('measureForwardSize · exceedsForwardSizeBudget — 발송 한도 판정', () => {
  const attachment = (base64Length: number): ReceivedAttachment => ({
    filename: 'scan.pdf',
    mimeType: 'application/pdf',
    contentId: null,
    contentBase64: 'A'.repeat(base64Length),
  });

  it('한도는 발송 서비스의 40MB 에서 여유를 둔 값이다', () => {
    expect(FORWARD_SIZE_BUDGET_BYTES).toBeLessThan(40 * 1024 * 1024);
    expect(FORWARD_SIZE_BUDGET_BYTES).toBeGreaterThanOrEqual(30 * 1024 * 1024);
  });

  it('인코딩한 첨부 합계와 본문(HTML·텍스트)의 바이트를 더한다 — 한글은 글자가 아니라 바이트로 센다', () => {
    const size = measureForwardSize({
      html: '<p>가</p>',
      text: '가나',
      attachments: [attachment(8), attachment(4)],
    });
    // 첨부 8 + 4, HTML 7 + 3(가), 텍스트 6(가나)
    expect(size).toBe(12 + 10 + 6);
  });

  it('본문이 없으면 첨부만 센다', () => {
    expect(measureForwardSize({ html: null, text: null, attachments: [attachment(8)] })).toBe(8);
  });

  it.each<[string, number, boolean]>([
    ['한도보다 1바이트 작으면 그대로 보낸다', -1, false],
    ['한도와 꼭 같으면 그대로 보낸다', 0, false],
    ['한도를 1바이트 넘으면 첨부를 뺀다', 1, true],
  ])('%s', (_name, delta, expected) => {
    const text = 'abcd';
    const reply = {
      html: null,
      text,
      attachments: [attachment(FORWARD_SIZE_BUDGET_BYTES - text.length + delta)],
    };
    expect(exceedsForwardSizeBudget(reply)).toBe(expected);
  });

  it('첨부가 없으면 본문이 아무리 커도 뺄 것이 없다', () => {
    const reply = { html: null, text: 'a'.repeat(FORWARD_SIZE_BUDGET_BYTES + 10), attachments: [] };
    expect(exceedsForwardSizeBudget(reply)).toBe(false);
  });
});

describe('listOmittedAttachments — 빠진 파일의 이름·크기', () => {
  it('크기는 인코딩 전(원래 파일) 바이트이고, 본문 속 이미지는 따로 표시한다', () => {
    const files = listOmittedAttachments(
      [
        // base64 8글자 = 6바이트, 패딩 하나면 5바이트
        { filename: '설문지.pdf', mimeType: 'application/pdf', contentId: null, contentBase64: 'QUJDREU=' },
        { filename: 'sign.png', mimeType: 'image/png', contentId: '<sign@corp>', contentBase64: 'QUJD' },
      ],
      '<p><img src="cid:sign@corp"></p>',
    );
    expect(files).toEqual([
      { filename: '설문지.pdf', sizeBytes: 5, inline: false },
      { filename: 'sign.png', sizeBytes: 3, inline: true },
    ]);
  });

  it('이름 없는 첨부에는 전달할 때와 같은 이름을 붙인다', () => {
    const files = listOmittedAttachments([
      { filename: null, mimeType: 'image/jpeg', contentId: null, contentBase64: 'QQ==' },
      { filename: '  ', mimeType: 'application/zip', contentId: null, contentBase64: '' },
    ]);
    expect(files).toEqual([
      { filename: 'attachment-1.jpg', sizeBytes: 1, inline: false },
      { filename: 'attachment-2', sizeBytes: 0, inline: false },
    ]);
  });
});

describe('buildOmittedAttachmentsNotice — 한도 초과 안내문', () => {
  const MB = 1024 * 1024;
  const file = (overrides: Partial<OmittedAttachment> = {}): OmittedAttachment => ({
    filename: '설문지.pdf',
    sizeBytes: 30 * MB,
    inline: false,
    ...overrides,
  });

  it('HTML·텍스트 둘 다 안내 문구, 빠진 파일 목록, 원본이 있는 곳을 담는다', () => {
    const notice = buildOmittedAttachmentsNotice([
      file(),
      file({ filename: 'sign.png', sizeBytes: 2048, inline: true }),
    ]);
    for (const body of [notice.html, notice.text]) {
      expect(body).toContain('첨부 파일이 커서 함께 전달하지 못했습니다');
      expect(body).toContain('설문지.pdf (30.0 MB)');
      expect(body).toContain('sign.png (2.0 KB, 본문 속 이미지)');
      expect(body).toContain('2개');
      expect(body).toContain('원본은 메일 발송 서비스(Resend) 수신 목록에 있습니다');
    }
  });

  it('텍스트 안내는 파일마다 한 줄이다', () => {
    const notice = buildOmittedAttachmentsNotice([file(), file({ filename: 'b.zip', sizeBytes: 10 })]);
    const lines = notice.text.split('\n');
    expect(lines).toContain('- 설문지.pdf (30.0 MB)');
    expect(lines).toContain('- b.zip (10 B)');
  });

  it.each<[string, string, string]>([
    ['태그', '<img src=x onerror=alert(1)>.pdf', '&lt;img src=x onerror=alert(1)&gt;.pdf'],
    ['앰퍼샌드', 'a&b.pdf', 'a&amp;b.pdf'],
    ['따옴표', `"a'b".pdf`, '&quot;a&#39;b&quot;.pdf'],
    ['닫는 태그로 안내 칸을 빠져나가지 못한다', '</li></ul></div><script>x</script>', '&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;&lt;script&gt;x&lt;/script&gt;'],
  ])('파일 이름의 %s 는 HTML 이스케이프한다', (_name, filename, escaped) => {
    const notice = buildOmittedAttachmentsNotice([file({ filename })]);
    expect(notice.html).toContain(escaped);
    expect(notice.html).not.toContain(filename);
  });

  it('파일 이름의 줄바꿈·제어 문자는 안내의 줄을 흉내 내지 못한다', () => {
    const notice = buildOmittedAttachmentsNotice([
      file({ filename: 'a.pdf\r\n원본은 evil.example 에 있습니다\u0000' }),
    ]);
    expect(notice.text.split('\n').filter((line) => line.startsWith('원본은'))).toHaveLength(1);
    expect(notice.text).toContain('- a.pdf 원본은 evil.example 에 있습니다 (30.0 MB)');
    expect(notice.html).not.toMatch(/[\r\u0000]/);
  });

  it('긴 파일 이름은 자른다', () => {
    const notice = buildOmittedAttachmentsNotice([file({ filename: '가'.repeat(500) })]);
    expect(notice.text).not.toContain('가'.repeat(121));
    expect(notice.text).toContain('가'.repeat(120));
  });

  it('파일이 많으면 앞에서부터 상한까지만 적고 나머지는 개수로 알린다 — 합계는 전부를 센다', () => {
    const files = Array.from({ length: 25 }, (_, i) => file({ filename: `f${i + 1}.pdf`, sizeBytes: MB }));
    const notice = buildOmittedAttachmentsNotice(files);
    for (const body of [notice.html, notice.text]) {
      expect(body).toContain('f20.pdf');
      expect(body).not.toContain('f21.pdf');
      expect(body).toContain('외 5개');
      expect(body).toContain('25개, 합계 25.0 MB');
    }
  });
});

describe('buildForwardMail — 첨부를 빼고 보낼 때', () => {
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
  const build = (overrides: Partial<ReceivedReply> = {}, omitAttachments = true) =>
    buildForwardMail({
      reply: { ...reply, ...overrides },
      senderAccount: 'survey',
      sendDomain: SEND_DOMAIN,
      forwardAddresses: ['help@example.co.kr'],
      omitAttachments,
    });
  const notice = buildOmittedAttachmentsNotice(listOmittedAttachments(reply.attachments, reply.html));
  /** 본문이 그 이미지를 가리키지 않는(또는 HTML 본문이 없는) 메일의 안내 — 「본문 속 이미지」 표시가 없다. */
  const noticeFor = (html: string | null) =>
    buildOmittedAttachmentsNotice(listOmittedAttachments(reply.attachments, html));

  it('첨부는 하나도 싣지 않고, 본문 속 이미지도 빠진 파일 목록에 든다', () => {
    const mail = build();
    expect(mail.attachments).toEqual([]);
    expect(mail.html).toContain('설문지.pdf');
    expect(mail.html).toContain('sign.png (3 B, 본문 속 이미지)');
  });

  it('안내는 HTML·텍스트 본문 맨 위에 붙고 원래 본문은 그 뒤에 그대로 남는다', () => {
    const mail = build();
    expect(mail.html).toBe(`${notice.html}${reply.html}`);
    expect(mail.text).toBe(`${notice.text}${reply.text}`);
  });

  it('받는 사람·보낸 사람 표기·답장 주소·제목·태그는 그대로다', () => {
    const { html: _html, text: _text, attachments: _attachments, ...omitted } = build();
    const { html: _h, text: _t, attachments: _a, ...full } = build({}, false);
    expect(omitted).toEqual(full);
  });

  it('온전한 HTML 문서면 안내를 body 여는 태그 바로 뒤에 넣는다', () => {
    const html = '<!DOCTYPE html><html><head><title>t</title></head><BODY class="x"><p>본문</p></body></html>';
    expect(build({ html }).html).toBe(
      `<!DOCTYPE html><html><head><title>t</title></head><BODY class="x">${noticeFor(html).html}<p>본문</p></body></html>`,
    );
  });

  it('본문이 한쪽만 있으면 그쪽에만 안내를 붙인다', () => {
    const textOnly = build({ html: null });
    expect(textOnly.html).toBeUndefined();
    expect(textOnly.text).toBe(`${noticeFor(null).text}${reply.text}`);

    const htmlOnly = build({ text: null });
    expect(htmlOnly.html).toBe(`${notice.html}${reply.html}`);
    expect(htmlOnly.text).toBeUndefined();
  });

  it('본문이 아예 없으면(첨부만 보낸 스캔본) 안내 뒤에 자리 채움 글자가 온다', () => {
    const mail = build({ html: null, text: null });
    expect(mail.html).toBeUndefined();
    expect(mail.text).toBe(`${noticeFor(null).text}(본문 없음)`);
  });

  it('첨부가 없는 메일은 뺄 것이 없으니 안내도 없다', () => {
    const mail = build({ attachments: [] });
    expect(mail.html).toBe(reply.html);
    expect(mail.text).toBe(reply.text);
  });

  it('옵션을 주지 않으면 01 과 똑같이 첨부를 싣고 안내가 없다', () => {
    const mail = build({}, false);
    expect(mail.attachments).toHaveLength(2);
    expect(mail.html).toBe(reply.html);
    expect(mail.text).toBe(reply.text);
  });
});

describe('본문 속 이미지 판정 — 내용 ID 는 본문 속 이미지에만 넘긴다', () => {
  const HTML_WITH_SIGN = '<p>서명 <img src="cid:sign@corp"></p>';
  const base: ReceivedReply = {
    senderAddress: 'kim@corp.co.kr',
    senderName: '김응답',
    replyTo: [],
    subject: 'x',
    html: HTML_WITH_SIGN,
    text: '서명',
    attachments: [],
  };
  const forwardedAttachment = (attachment: ReceivedAttachment, html: string | null = HTML_WITH_SIGN) =>
    buildForwardMail({
      reply: { ...base, html, attachments: [attachment] },
      senderAccount: 'survey',
      sendDomain: SEND_DOMAIN,
      forwardAddresses: ['help@example.co.kr'],
    }).attachments[0];

  it.each<[string, ReceivedAttachment, string | null, string | undefined]>([
    [
      '원본 풀기가 본문 속(related)이라고 한 이미지',
      { filename: 'logo.png', mimeType: 'image/png', contentId: '<logo@corp>', related: true, contentBase64: 'QQ==' },
      '<p>본문이 그 이미지를 가리키지 않아도</p>',
      'logo@corp',
    ],
    [
      '본문 속 파트가 아니어도 HTML 본문이 그 cid 를 참조하는 이미지',
      { filename: 'sign.png', mimeType: 'image/png', contentId: '<sign@corp>', contentBase64: 'QQ==' },
      HTML_WITH_SIGN,
      'sign@corp',
    ],
    [
      'cid 참조의 대소문자가 달라도',
      { filename: 'sign.png', mimeType: 'image/png', contentId: '<Sign@Corp>', contentBase64: 'QQ==' },
      '<img src="CID:sign@corp">',
      'Sign@Corp',
    ],
    [
      '내용 ID 가 붙었을 뿐인 일반 PDF — 본문이 참조하지 않는다',
      { filename: '설문지.pdf', mimeType: 'application/pdf', contentId: '<part1.abc@corp>', contentBase64: 'QQ==' },
      HTML_WITH_SIGN,
      undefined,
    ],
    [
      '다른 내용 ID 의 앞부분만 같은 첨부',
      { filename: 'x.png', mimeType: 'image/png', contentId: '<sign@corp.extra>', contentBase64: 'QQ==' },
      '<img src="cid:sign@corp">',
      undefined,
    ],
    [
      'HTML 본문이 없는 메일 — 보여 줄 자리가 없으니 일반 첨부다',
      { filename: 'logo.png', mimeType: 'image/png', contentId: '<logo@corp>', related: true, contentBase64: 'QQ==' },
      null,
      undefined,
    ],
    [
      '내용 ID 가 없는 첨부',
      { filename: 'a.pdf', mimeType: 'application/pdf', contentId: null, related: true, contentBase64: 'QQ==' },
      HTML_WITH_SIGN,
      undefined,
    ],
    [
      '내용 ID 가 꺾쇠뿐인 첨부',
      { filename: 'a.pdf', mimeType: 'application/pdf', contentId: '<>', related: true, contentBase64: 'QQ==' },
      HTML_WITH_SIGN,
      undefined,
    ],
  ])('%s', (_name, attachment, html, expectedContentId) => {
    const forwarded = forwardedAttachment(attachment, html);

    expect(forwarded?.contentId).toBe(expectedContentId);
    // 일반 첨부로 보낼 때는 내용 ID 칸 자체가 없다 — 있으면 받는 쪽 메일 프로그램이 첨부를 숨긴다.
    if (expectedContentId === undefined) expect(forwarded).not.toHaveProperty('contentId');
    // 안내문의 「본문 속 이미지」 표시도 같은 기준이다.
    expect(listOmittedAttachments([attachment], html)[0]?.inline).toBe(expectedContentId !== undefined);
  });

  it('첨부를 뺄 때 안내의 「본문 속 이미지」 표시는 실제로 본문 속 이미지인 것에만 붙는다', () => {
    const mail = buildForwardMail({
      reply: {
        ...base,
        attachments: [
          { filename: '설문지.pdf', mimeType: 'application/pdf', contentId: '<part1@corp>', contentBase64: 'QUJD' },
          { filename: 'sign.png', mimeType: 'image/png', contentId: '<sign@corp>', related: true, contentBase64: 'QUJD' },
        ],
      },
      senderAccount: 'survey',
      sendDomain: SEND_DOMAIN,
      forwardAddresses: ['help@example.co.kr'],
      omitAttachments: true,
    });

    expect(mail.text).toContain('- 설문지.pdf (3 B)');
    expect(mail.text).toContain('- sign.png (3 B, 본문 속 이미지)');
  });
});

describe('발송으로 넘기는 첨부 파일 이름 — 줄바꿈·제어 문자를 걷는다', () => {
  const namesOf = (attachments: ReceivedAttachment[]) =>
    buildForwardMail({
      reply: {
        senderAddress: 'kim@corp.co.kr',
        senderName: null,
        replyTo: [],
        subject: 'x',
        html: null,
        text: '본문',
        attachments,
      },
      senderAccount: 'survey',
      sendDomain: SEND_DOMAIN,
      forwardAddresses: ['help@example.co.kr'],
    }).attachments.map((attachment) => attachment.filename);
  const pdf = (filename: string | null): ReceivedAttachment => ({
    filename,
    mimeType: 'application/pdf',
    contentId: null,
    contentBase64: 'QQ==',
  });

  it.each<[string, string, string]>([
    ['줄바꿈', '설문지\r\nContent-Type: text/html.pdf', '설문지 Content-Type: text/html.pdf'],
    ['탭과 널 문자', 'a\tb\u0000c.pdf', 'a b c.pdf'],
    ['유니코드 줄 구분자', 'a\u2028b\u2029c.pdf', 'a b c.pdf'],
    ['C1 제어 문자', 'a\u0085b.pdf', 'a b.pdf'],
    ['앞뒤 공백', '  설문지.pdf  ', '설문지.pdf'],
    ['평범한 이름은 그대로', '설문지 (최종).pdf', '설문지 (최종).pdf'],
  ])('%s', (_name, filename, expected) => {
    expect(namesOf([pdf(filename)])).toEqual([expected]);
  });

  it('걷어내고 나면 빈 이름에는 대체 이름을 쓴다', () => {
    expect(namesOf([pdf('\r\n\t'), pdf('\u0000'), pdf(null)])).toEqual([
      'attachment-1.pdf',
      'attachment-2.pdf',
      'attachment-3.pdf',
    ]);
  });

  it('안내문의 빠진 파일 이름도 같은 이름이다', () => {
    expect(listOmittedAttachments([pdf('a\r\nb.pdf'), pdf('\r\n')], null).map((file) => file.filename)).toEqual([
      'a b.pdf',
      'attachment-2.pdf',
    ]);
  });
});

describe('buildOmittedAttachmentsNotice — 첨부를 뺀 까닭에 따라 문구가 갈린다', () => {
  const files: OmittedAttachment[] = [{ filename: 'run.exe', sizeBytes: 10, inline: false }];

  it('크기 초과면 「커서」라고 말한다 — 까닭을 주지 않아도 같다', () => {
    for (const notice of [buildOmittedAttachmentsNotice(files), buildOmittedAttachmentsNotice(files, 'size')]) {
      expect(notice.text).toContain('[안내] 첨부 파일이 커서 함께 전달하지 못했습니다.');
      expect(notice.html).toContain('첨부 파일이 커서 함께 전달하지 못했습니다.');
    }
  });

  it('발송 서비스가 거절한 것이면 크기를 탓하지 않는다 — 파일 목록과 원본이 있는 곳은 그대로다', () => {
    const notice = buildOmittedAttachmentsNotice(files, 'rejected');

    for (const body of [notice.text, notice.html]) {
      expect(body).toContain('첨부 파일을 함께 전달하지 못했습니다.');
      expect(body).not.toContain('커서');
      expect(body).toContain('run.exe (10 B)');
      expect(body).toContain('원본은 메일 발송 서비스(Resend) 수신 목록에 있습니다.');
    }
  });
});

describe('detectForwardLoop — 넘기면 고리가 되는 메일', () => {
  const REPORT = 'multipart/report; report-type=delivery-status; boundary="b1"';

  it.each<[string, string, Array<{ key: string; value: string }>, ReturnType<typeof detectForwardLoop>]>([
    ['우리 표식 헤더를 단 메일 — 전달 메일이 되돌아왔다', 'kim@corp.co.kr', [{ key: 'x-survey-reply-forward', value: '1' }], 'forward_mark'],
    ['표식 헤더 이름의 대소문자가 달라도', 'kim@corp.co.kr', [{ key: 'X-Survey-Reply-Forward', value: '1' }], 'forward_mark'],
    ['표식 헤더의 값이 달라도 이름으로 알아본다', 'kim@corp.co.kr', [{ key: 'x-survey-reply-forward', value: 'yes' }], 'forward_mark'],
    ['배달 상태 통지(multipart/report 의 delivery-status)', 'bounce@mx.corp.co.kr', [{ key: 'content-type', value: REPORT }], 'delivery_report'],
    ['통지 종류에 따옴표·대문자가 섞여도', 'bounce@mx.corp.co.kr', [{ key: 'Content-Type', value: 'Multipart/Report; boundary=x; Report-Type="Delivery-Status"' }], 'delivery_report'],
    ['보낸 사람이 mailer-daemon', 'MAILER-DAEMON@mx.corp.co.kr', [], 'delivery_report'],
    ['보낸 사람이 postmaster', 'Postmaster@corp.co.kr', [], 'delivery_report'],
    ['응답자의 부재중 자동응답은 넘긴다', 'kim@corp.co.kr', [{ key: 'auto-submitted', value: 'auto-replied' }, { key: 'x-autoreply', value: 'yes' }], null],
    ['남이 자동 전달한 메일(우리 표식 없음)은 넘긴다', 'kim@corp.co.kr', [{ key: 'auto-submitted', value: 'auto-forwarded' }], null],
    ['읽음 확인(multipart/report 의 disposition-notification)은 넘긴다', 'kim@corp.co.kr', [{ key: 'content-type', value: 'multipart/report; report-type=disposition-notification; boundary=x' }], null],
    ['평범한 첨부 메일', 'kim@corp.co.kr', [{ key: 'content-type', value: 'multipart/mixed; boundary=x' }], null],
    ['이름에 daemon 이 들어갈 뿐인 사람', 'mailer-daemon-fan@corp.co.kr', [], null],
    ['헤더가 없는 메일', 'kim@corp.co.kr', [], null],
  ])('%s', (_name, senderAddress, headers, expected) => {
    expect(detectForwardLoop({ senderAddress, headers })).toBe(expected);
  });
});

describe('buildForwardMail — 보낸 사람 주소의 모양', () => {
  const reply: ReceivedReply = {
    senderAddress: 'kim@corp.co.kr',
    senderName: '김응답',
    replyTo: [],
    subject: 'RE: 설문 회신드립니다',
    html: '<p>스캔본 보냅니다</p>',
    text: '스캔본 보냅니다',
    attachments: [{ filename: '설문지.pdf', mimeType: 'application/pdf', contentId: null, contentBase64: 'UERG' }],
  };
  const base = { reply, senderAccount: 'survey', sendDomain: SEND_DOMAIN, forwardAddresses: ['help@example.co.kr'] };
  const GUIDE_LINE = '이 메일에 답장할 때는 받는 사람을 kim@corp.co.kr 로 직접 넣어 주세요.';

  it('중계 주소를 주면 보낸 사람 주소의 @ 앞이 그것이 된다 — 이름·답장 주소·본문·첨부는 그대로다', () => {
    const plain = buildForwardMail(base);
    const relayed = buildForwardMail({
      ...base,
      fromAddress: { kind: 'relay', localPart: 'survey+kim=corp.co.kr=42a7387e98' },
    });

    expect(relayed.from).toBe('김응답 <survey+kim=corp.co.kr=42a7387e98@send.example.co.kr>');
    expect({ ...relayed, from: plain.from }).toEqual(plain);
  });

  it('중계 주소를 쓰지 못하면 보낸이 계정 그대로 두고 본문 맨 위에 안내 한 줄을 붙인다', () => {
    const mail = buildForwardMail({
      ...base,
      fromAddress: { kind: 'account_with_guide', respondentAddress: 'kim@corp.co.kr' },
    });

    expect(mail.from).toBe('김응답 <survey@send.example.co.kr>');
    expect(mail.replyTo).toEqual(['kim@corp.co.kr']);
    expect(mail.text).toBe(`[안내] ${GUIDE_LINE}\n----------------------------------------\n\n스캔본 보냅니다`);
    expect(String(mail.html).endsWith('<p>스캔본 보냅니다</p>')).toBe(true);
    expect(String(mail.html).startsWith('<div ')).toBe(true);
    expect(mail.html).toContain(GUIDE_LINE);
    expect(mail.attachments).toHaveLength(1);
  });

  it('안내의 주소는 HTML 이스케이프하고 줄바꿈을 걷는다', () => {
    const notice = buildReplyGuideNotice('"a<b>&c"@corp.co.kr\r\nBcc: x@evil.com');

    expect(notice.html).toContain('&quot;a&lt;b&gt;&amp;c&quot;@corp.co.kr Bcc: x@evil.com');
    expect(notice.html).not.toContain('<b>');
    expect(notice.text.split('\n')[0]).toBe(
      '[안내] 이 메일에 답장할 때는 받는 사람을 "a<b>&c"@corp.co.kr Bcc: x@evil.com 로 직접 넣어 주세요.',
    );
  });

  it('첨부까지 빼면 답장 안내가 먼저, 첨부 안내가 그 뒤에 온다 — 원래 본문은 맨 끝이다', () => {
    const mail = buildForwardMail({
      ...base,
      fromAddress: { kind: 'account_with_guide', respondentAddress: 'kim@corp.co.kr' },
      omitAttachments: true,
      omitReason: 'rejected',
    });
    const guide = buildReplyGuideNotice('kim@corp.co.kr');
    const omitted = buildOmittedAttachmentsNotice(listOmittedAttachments(reply.attachments, reply.html), 'rejected');

    expect(mail.attachments).toEqual([]);
    expect(mail.html).toBe(`${guide.html}${omitted.html}${reply.html}`);
    expect(mail.text).toBe(`${guide.text}${omitted.text}${reply.text}`);
  });

  it('본문이 아예 없는 메일도 안내 뒤에 자리 채움 글자가 온다', () => {
    const mail = buildForwardMail({
      ...base,
      reply: { ...reply, html: null, text: null },
      fromAddress: { kind: 'account_with_guide', respondentAddress: 'kim@corp.co.kr' },
    });

    expect(mail.text).toBe(`${buildReplyGuideNotice('kim@corp.co.kr').text}(본문 없음)`);
  });
});
