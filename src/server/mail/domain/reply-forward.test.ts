import { describe, expect, it } from 'vitest';

import { MAX_RECIPIENTS_PER_MAIL } from '@/lib/mail/split-email-addresses';

import {
  FORWARD_SIZE_BUDGET_BYTES,
  MAX_SENDER_ACCOUNTS,
  buildForwardMail,
  buildOmittedAttachmentsNotice,
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
    const files = listOmittedAttachments([
      // base64 8글자 = 6바이트, 패딩 하나면 5바이트
      { filename: '설문지.pdf', mimeType: 'application/pdf', contentId: null, contentBase64: 'QUJDREU=' },
      { filename: 'sign.png', mimeType: 'image/png', contentId: '<sign@corp>', contentBase64: 'QUJD' },
    ]);
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
  const notice = buildOmittedAttachmentsNotice(listOmittedAttachments(reply.attachments));

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
      `<!DOCTYPE html><html><head><title>t</title></head><BODY class="x">${notice.html}<p>본문</p></body></html>`,
    );
  });

  it('본문이 한쪽만 있으면 그쪽에만 안내를 붙인다', () => {
    const textOnly = build({ html: null });
    expect(textOnly.html).toBeUndefined();
    expect(textOnly.text).toBe(`${notice.text}${reply.text}`);

    const htmlOnly = build({ text: null });
    expect(htmlOnly.html).toBe(`${notice.html}${reply.html}`);
    expect(htmlOnly.text).toBeUndefined();
  });

  it('본문이 아예 없으면(첨부만 보낸 스캔본) 안내 뒤에 자리 채움 글자가 온다', () => {
    const mail = build({ html: null, text: null });
    expect(mail.html).toBeUndefined();
    expect(mail.text).toBe(`${notice.text}(본문 없음)`);
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
