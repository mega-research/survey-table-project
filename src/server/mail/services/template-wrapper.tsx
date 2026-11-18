import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
} from '@react-email/components';

import { sanitizeRichHtml } from '@/lib/sanitize';

interface Props {
  bodyHtml: string;
  /** 받은편지함 프리뷰 텍스트 (subject 옆 회색 글자). 비우면 표시 안 함. */
  previewText?: string;
  /**
   * 테스트 footer 종류. template·template-live 는 단독 테스트 발송, campaign 은 테스트 캠페인.
   *
   * 단독 테스트 발송이 둘로 갈리는 것은 본문의 설문 링크가 둘 중 하나라서다(CONTEXT.md
   * 「테스트 발송」) — 테스트 조사 대상자가 있으면 눌러서 열리는 그 대상자의 링크(template-live),
   * 없으면 열리지 않는 견본(template). 한 문구로 두면 열리는 링크에 「비활성화되어 있다」가 붙는다.
   */
  testFooterKind?: 'template' | 'template-live' | 'campaign' | null;
  /** 수신거부 링크 URL. null 이면 footer 표시 안 함 (정책상 발송 코드에서는 항상 채움). */
  unsubscribeUrl: string | null;
}

const main: React.CSSProperties = {
  margin: 0,
  padding: 0,
  backgroundColor: '#f9fafb',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

// 900px: 텍스트가 구워진 큰 이미지(1534px 등)의 데스크톱 축소율을 완화하기 위한 값.
// 메일 관례(600~700px)보다 넓지만 Gmail 웹 표시 영역(~900px+)에는 안전.
// 모바일은 이미지가 화면 폭으로 줄어들어 이 값과 무관.
const container: React.CSSProperties = {
  maxWidth: '900px',
  margin: '0 auto',
  padding: '24px 16px',
  backgroundColor: '#ffffff',
};

const content: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#1f2937',
};

const footer: React.CSSProperties = {
  marginTop: '32px',
  paddingTop: '16px',
  borderTop: '1px solid #e5e7eb',
  fontSize: '12px',
  color: '#6b7280',
  lineHeight: '1.5',
};

const unsubFooter: React.CSSProperties = {
  marginTop: '24px',
  paddingTop: '12px',
  borderTop: '1px solid #e5e7eb',
  fontSize: '12px',
  color: '#6b7280',
  lineHeight: '1.6',
};

const unsubLink: React.CSSProperties = {
  color: '#374151',
  textDecoration: 'underline',
  fontWeight: 600,
};

export function MailWrapper({
  bodyHtml,
  previewText,
  testFooterKind = 'template',
  unsubscribeUrl,
}: Props) {
  return (
    <Html lang="ko">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
      </Head>
      {previewText ? <Preview>{previewText}</Preview> : null}
      <Body style={main}>
        <Container style={container}>
          <Section style={content}>
            {/* TipTap 에디터의 HTML 을 그대로 삽입. react-email Section 은 children 기반이라
                dangerouslySetInnerHTML 을 직접 못 받으므로 plain div 로 한 단계 감싼다.
                admin 작성 HTML 이지만 발신 직전 sanitize 로 위험 태그를 한 번 더 정규화. */}
            <div dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(bodyHtml) }} />
          </Section>
          {unsubscribeUrl ? (
            <Section style={unsubFooter}>
              이메일 수신을 원치 않으시면{' '}
              <a href={unsubscribeUrl} style={unsubLink}>[수신거부]</a>를 클릭하십시오.
              <br />
              If you don&apos;t want to receive this e-mail anymore, please click the{' '}
              <a href={unsubscribeUrl} style={unsubLink}>[unsubscribe]</a>.
            </Section>
          ) : null}
          {testFooterKind === 'template' ? (
            <Section style={footer}>
              이 메일은 템플릿 테스트 발송입니다. 본문 내 설문 링크는
              미리보기용으로 비활성화되어 있어, 클릭하셔도 실제 응답으로 기록되지
              않습니다.
            </Section>
          ) : null}
          {testFooterKind === 'template-live' ? (
            <Section style={footer}>
              이 메일은 템플릿 테스트 발송입니다. 본문 내 설문 링크는 테스트 조사
              대상자의 링크라, 제출한 응답은 테스트 응답으로 기록됩니다.
            </Section>
          ) : null}
          {testFooterKind === 'campaign' ? (
            <Section style={footer}>
              이 메일은 테스트 캠페인 메일입니다. 설문 링크로 제출한 응답은 테스트
              응답으로 기록됩니다.
            </Section>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
