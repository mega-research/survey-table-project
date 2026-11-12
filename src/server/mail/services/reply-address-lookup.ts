import 'server-only';

import { and, desc, eq, gte, isNotNull, isNull, max, sql } from 'drizzle-orm';

import { db } from '@/db';
import { mailCampaigns, mailRecipients, mailTemplates } from '@/db/schema/mail';
import { splitEmailAddresses } from '@/lib/mail/split-email-addresses';

import { collectReplyAddresses } from '../domain/reply-forward';

/**
 * 회신 주소 조회 (DB 읽기 전용) — 회신 전달이 「어느 회신 주소로 넘길지」를 찾는 자리.
 *
 * 전달 주소는 여기서 읽은 값, 곧 우리 DB 에 적힌 회신 주소에서만 나온다. 받은 메일의 어떤 값도
 * 전달 주소가 되지 않는다(릴레이 악용 방지) — 새 조회를 더할 때도 이 성질을 지킬 것.
 */

/**
 * 주소를 찾은 방법 — 응답자 주소가 걸린 발송 회차의 회신 주소 / 그 계정의 발송 회차 회신 주소 전부 /
 * 그 계정을 쓰는 템플릿의 회신 주소.
 */
export type ReplyAddressSource = 'respondent' | 'campaign' | 'template';

export interface AccountReplyAddresses {
  /** null = 쓴 적 없는 보낸이 계정(전달 주소 없음). */
  source: Exclude<ReplyAddressSource, 'respondent'> | null;
  /** 전달 주소 후보 — 최근 것부터, 대소문자 무시 중복 없이, 발송 전용 도메인 주소 제외. */
  addresses: string[];
}

export interface RespondentReplyAddress {
  /** null = 그 계정의 수신자 기록에 응답자 주소가 없다(호출부가 계정 기준으로 물러난다). */
  source: 'respondent' | null;
  /** 응답자 주소에 가장 최근에 보낸 발송 회차의 회신 주소 — 한 회차의 것만. */
  addresses: string[];
}

/** 응답자 주소 후보 수신자를 한 번에 읽는 줄 수. */
const RESPONDENT_PAGE_SIZE = 200;
/** 후보를 읽는 쪽 수 상한 — 넘으면 못 찾은 것으로 보고 계정 기준으로 물러난다. */
const RESPONDENT_MAX_PAGES = 25;

/**
 * 응답자 주소 기준 전달 주소 — 같은 보낸이 계정이 설문마다 다른 회신 주소를 쓸 때 한 곳만 고른다.
 *
 * 그 계정의 발송 회차(단체·단건·대체 발송·테스트 회차, 보관된 회차, 실/테스트 파티션 전부, 기간 제한 없음) 수신자
 * 가운데 발송 스냅샷 주소에 응답자 주소가 들어 있는 것을 최근에 보낸 순으로 훑어, 처음 걸린 회차의 회신 주소를 돌려준다.
 * 회신 주소가 비었거나 발송 전용 도메인뿐인 회차는 건너뛰고 다음으로 최근 것을 본다.
 *
 * 비교는 두 단계다. SQL 은 후보를 좁히기만 한다(공백을 지운 스냅샷에 응답자 주소가 글자 그대로 들어 있는가 —
 * 부분 문자열도 걸린다). 판정은 발송 때와 같은 주소 나누기 규칙으로 칸을 나눠 **주소 하나하나와 정확히**(대소문자 무시)
 * 한다 — 그래서 `kim@x.com` 이 `akim@x.com` 수신자에 걸리지 않는다. 주소 나누기 규칙을 SQL 로 옮기지 말 것.
 *
 * @param senderAccount 보낸이 계정 — 대소문자 무시.
 * @param respondentAddress 답장을 보낸 주소. 여기서 읽는 재료일 뿐 전달 주소가 되지 않는다.
 */
export async function findReplyAddressByRespondent(
  senderAccount: string,
  respondentAddress: string,
  options: { sendDomain: string },
): Promise<RespondentReplyAddress> {
  const notFound: RespondentReplyAddress = { source: null, addresses: [] };
  const account = senderAccount.trim().toLowerCase();
  const respondent = respondentAddress.trim().toLowerCase();
  if (!account || !respondent.includes('@')) return notFound;

  for (let page = 0; page < RESPONDENT_MAX_PAGES; page += 1) {
    const rows = await db
      .select({ email: mailRecipients.emailSnapshot, replyTo: mailCampaigns.replyToSnapshot })
      .from(mailRecipients)
      .innerJoin(mailCampaigns, eq(mailRecipients.campaignId, mailCampaigns.id))
      .where(
        and(
          sql`lower(${mailCampaigns.fromLocalSnapshot}) = ${account}`,
          isNotNull(mailCampaigns.replyToSnapshot),
          sql`btrim(${mailCampaigns.replyToSnapshot}) <> ''`,
          // LIKE 가 아니라 strpos — 주소에 흔한 `_`·`%` 가 와일드카드로 읽히지 않는다.
          sql`strpos(regexp_replace(lower(${mailRecipients.emailSnapshot}), '\\s+', '', 'g'), ${respondent}) > 0`,
        ),
      )
      // 보낸 수신자가 먼저(보낸 시각 최근순), 아직 안 보낸 수신자는 그 뒤(만든 시각 최근순).
      .orderBy(
        sql`${mailRecipients.sentAt} desc nulls last`,
        desc(mailRecipients.createdAt),
        desc(mailRecipients.id),
      )
      .limit(RESPONDENT_PAGE_SIZE)
      .offset(page * RESPONDENT_PAGE_SIZE);

    for (const row of rows) {
      const sentTo = splitEmailAddresses(row.email ?? '');
      if (!sentTo.some((address) => address.toLowerCase() === respondent)) continue;
      const addresses = collectReplyAddresses([row.replyTo], options.sendDomain);
      if (addresses.length > 0) return { source: 'respondent', addresses };
    }
    if (rows.length < RESPONDENT_PAGE_SIZE) break;
  }
  return notFound;
}

/** 계정 기준으로 볼 발송 회차의 기간. */
const ACCOUNT_LOOKBACK_YEARS = 1;
/** 서로 다른 회신 주소 값을 읽는 상한 — 한 통의 수신자 상한(50)보다 넉넉히 읽고 규칙이 자른다. */
const DISTINCT_REPLY_LIMIT = 200;

/**
 * 보낸이 계정 기준 전달 주소.
 *
 * 그 계정으로 최근 1년 안에 만든 발송 회차(단체·단건·대체 발송·테스트 회차, 보관된 회차, 실/테스트 파티션 전부)의
 * 회신 주소 스냅샷을 중복 없이 모은다. 하나도 없으면 그 계정을 쓰는 삭제되지 않은 템플릿의 회신 주소다
 * (캠페인 없이 「테스트 발송」만 한 템플릿의 답장). 회신 주소가 빈 회차와 발송 전용 도메인의 주소는 후보가 아니다.
 *
 * @param senderAccount 보낸이 계정 — 소문자로 넘길 것(대소문자 무시 비교).
 */
export async function loadAccountReplyAddresses(
  senderAccount: string,
  options: { sendDomain: string; now?: Date },
): Promise<AccountReplyAddresses> {
  const account = senderAccount.trim().toLowerCase();
  if (!account) return { source: null, addresses: [] };

  const since = new Date(options.now ?? new Date());
  since.setFullYear(since.getFullYear() - ACCOUNT_LOOKBACK_YEARS);

  const campaignLastAt = max(mailCampaigns.createdAt);
  const campaignRows = await db
    .select({ replyTo: mailCampaigns.replyToSnapshot })
    .from(mailCampaigns)
    .where(
      and(
        sql`lower(${mailCampaigns.fromLocalSnapshot}) = ${account}`,
        gte(mailCampaigns.createdAt, since),
        isNotNull(mailCampaigns.replyToSnapshot),
        sql`btrim(${mailCampaigns.replyToSnapshot}) <> ''`,
      ),
    )
    .groupBy(mailCampaigns.replyToSnapshot)
    .orderBy(desc(campaignLastAt))
    .limit(DISTINCT_REPLY_LIMIT);
  const fromCampaigns = collectReplyAddresses(
    campaignRows.map((row) => row.replyTo),
    options.sendDomain,
  );
  if (fromCampaigns.length > 0) return { source: 'campaign', addresses: fromCampaigns };

  const templateLastAt = max(mailTemplates.updatedAt);
  const templateRows = await db
    .select({ replyTo: mailTemplates.replyTo })
    .from(mailTemplates)
    .where(
      and(
        sql`lower(${mailTemplates.fromLocal}) = ${account}`,
        isNull(mailTemplates.deletedAt),
        isNotNull(mailTemplates.replyTo),
        sql`btrim(${mailTemplates.replyTo}) <> ''`,
      ),
    )
    .groupBy(mailTemplates.replyTo)
    .orderBy(desc(templateLastAt))
    .limit(DISTINCT_REPLY_LIMIT);
  const fromTemplates = collectReplyAddresses(
    templateRows.map((row) => row.replyTo),
    options.sendDomain,
  );
  if (fromTemplates.length > 0) return { source: 'template', addresses: fromTemplates };

  return { source: null, addresses: [] };
}
