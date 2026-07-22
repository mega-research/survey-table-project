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
  /** 수신거부 링크 URL. null 이면 footer 표시 안 함 (정책상 발송 코드에서는 항상 채움). */
  unsubscribeUrl: string | null;
}

const main: React.CSSProperties = {
  margin: 0,
  padding: 0,
  backgroundColor: '#f9fafb',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

const container: React.CSSProperties = {
  maxWidth: '700px',
  margin: '0 auto',
  padding: '24px 16px',
  backgroundColor: '#ffffff',
};

const content: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#1f2937',
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

export function MailWrapper({ bodyHtml, previewText, unsubscribeUrl }: Props) {
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
        </Container>
      </Body>
    </Html>
  );
}
