/**
 * 시스템 글자 사전 (CONTEXT.md 「다국어 설문」) — 응답 화면이 저작자 글자 밖에서 스스로 내는 문장.
 *
 * 다국어 설문의 응답자는 고른 언어(현재 언어)로 이 문장들을 본다. 다국어 설문이 아니면 현재 언어가
 * 늘 한국어라 지금 화면 글자가 한 글자도 바뀌지 않는다 — 한국어 문장은 옮겨 오기 전 문장 그대로다.
 * 저작자 문구(필수 안내 문구·합계 제약 문구 등)는 번역하지 않는다 — 언어판마다 저작자가 쓴다.
 *
 * 공용 구역에 두는 이유: 검증 문구를 만드는 순수 함수(`utils/required-message` 등)와
 * 일시중지·쿼터 마감 기본 문구(`shared/lib`·`lib/quota`)가 이 사전을 읽는다.
 *
 * 자리표시자는 `{이름}`(영문) — `systemText` 의 `values` 로 채운다.
 */
import { DEFAULT_SURVEY_LOCALE, SURVEY_LOCALES, type SurveyLocale } from '@/types/survey-locale';

const KO = {
  // 이동
  'nav.previous': '이전',
  'nav.next': '다음',
  'nav.submitting': '처리 중...',
  'progress.answered': '{answered}/{total} 응답 완료',
  'flow.requiredUnanswered': '* 필수 질문에 답변해주세요',

  // 응답 흐름 안내
  'flow.reedit.before': '재응답이 허용된 설문입니다. 답변을 수정한 뒤 ',
  'flow.reedit.emphasis': '끝까지 진행해 제출',
  'flow.reedit.after': '해야 완료로 반영됩니다. 제출하지 않고 나가면 완료 처리되지 않습니다.',
  'flow.inviteInvalidAnonymous': '초대 링크가 유효하지 않아 익명 응답으로 진행됩니다.',
  'flow.resumed': '이전 응답을 이어서 진행합니다',
  'flow.versionRebased': '설문이 업데이트되어 최신 버전으로 이어집니다',

  // 전체 화면
  'screen.checking': '확인 중...',
  'screen.loading.title': '설문을 불러오는 중...',
  'screen.loading.body': '잠시만 기다려주세요.',
  'screen.goHome': '홈으로 돌아가기',
  'screen.inviteRequired.title': '초대 링크가 필요합니다',
  'screen.inviteRequired.body':
    '이 설문은 초대된 응답자만 응답할 수 있습니다. 받으신 메일/메시지의 링크로 다시 접속해주세요.',
  'screen.invalidInviteLink.title': '유효하지 않은 초대 링크입니다',
  'screen.invalidInviteLink.body':
    '초대 링크가 잘못되었거나 더 이상 사용할 수 없습니다. 설문 담당자에게 문의해주세요.',
  'screen.tooManyRequests.title': '잠시 후 다시 시도해주세요',
  'screen.tooManyRequests.body':
    '접속이 일시적으로 몰렸습니다. 링크는 그대로 유효하니 잠시 뒤 다시 열어주세요.',
  'screen.invalidTestLink.title': '유효하지 않은 테스트 링크입니다',
  'screen.invalidTestLink.body': '테스트 모드가 종료되었거나 이 링크를 더 이상 사용할 수 없습니다.',
  'screen.desktopOnly.title': 'PC 에서 열어 주세요',
  'screen.desktopOnly.body':
    '이 설문은 조사표를 나란히 보면서 판단하는 형식이라 넓은 화면이 필요합니다.',
  'screen.desktopOnly.hint':
    '같은 링크를 PC 브라우저에서 열면 이어서 진행할 수 있습니다. 창을 넓히면 이 화면은 바로 사라집니다.',

  // 완료 화면
  'completion.title': '응답 완료!',
  'completion.screenedOutTitle': '설문 종료',
  'completion.defaultMessage': '설문에 참여해주셔서 감사합니다!',
  'completion.completedAt': '응답 완료 시간: {time}',
  'completion.previewTitle': '설문 확인 완료',
  'completion.previewMessage': '입력 내용은 저장되지 않았습니다.',

  // 종료 후 이동
  'endRedirect.waiting': '잠시만 기다려 주세요.',
  'endRedirect.fallbackBefore': '이동하지 않으면 ',
  'endRedirect.fallbackLink': '여기를 눌러 주세요',
  'endRedirect.fallbackAfter': '.',
  'endRedirect.testNotice':
    '테스트 응답이라 이동하지 않습니다. 실제 응답은 아래 주소로 이동합니다.',

  // 차단·안내 화면 (already-responded-view)
  'notice.contactEmail': '문의 이메일',
  'notice.testVersionRepublished.title': '설문이 수정되었습니다',
  'notice.testVersionRepublished.body': '새로고침하면 바뀐 곳부터 이어집니다.',
  'notice.responseConcluded.title': '이미 완료된 설문입니다',
  'notice.responseConcluded.body':
    '이 응답은 이미 제출이 완료되었습니다. 참여해 주셔서 감사합니다.',
  'notice.invalidToken.title': '잘못된 초대 링크입니다',
  'notice.invalidToken.body': '이 링크는 유효하지 않거나 만료되었습니다. 운영자에게 문의해 주세요.',
  'notice.alreadyResponded.title': '이미 응답하신 설문입니다',
  'notice.tokenAlreadyUsed.body':
    '이 초대 링크로는 이미 응답이 제출되었습니다. 중복 응답은 허용되지 않습니다.',
  'notice.deviceAlreadyResponded.body':
    '이 기기에서 이 설문에 응답한 기록이 있습니다. 한 분당 한 번만 응답 가능합니다.',
  'notice.invalidTestToken.title': '테스트 링크가 유효하지 않습니다',
  'notice.invalidTestToken.body':
    '테스트 모드가 꺼져 있거나 링크가 잘못되었습니다. 운영 콘솔에서 테스트 링크를 다시 복사해 주세요.',
  'notice.notAccepting.title': '지금은 응답을 받고 있지 않습니다',
  'notice.notAccepting.body':
    '이 설문은 현재 응답을 받지 않습니다. 링크가 맞는지 확인하시거나 운영자에게 문의해 주세요.',

  // 저작자가 비웠을 때의 기본 문구 — 라이브 설정이라 저작 문구는 한국어 한 벌이다
  'default.paused': '설문이 일시 중단되었습니다. 잠시 후 다시 시도해 주세요.',
  'default.quotaClosed':
    '해당 조건의 모집이 완료되어 더 이상 참여하실 수 없습니다. 참여해 주셔서 감사합니다.',
  'default.quotaMidSurveyClosed':
    '죄송합니다. 응답 중에 해당 조건의 모집이 완료되어 더 이상 진행하실 수 없습니다. 소중한 시간을 내어 참여해 주셔서 감사합니다.',
} as const;

export type SystemStringKey = keyof typeof KO;

type Dictionary = Readonly<Record<SystemStringKey, string>>;

/** 중국어(간체). */
const ZH: Dictionary = {
  'nav.previous': '上一步',
  'nav.next': '下一步',
  'nav.submitting': '处理中...',
  'progress.answered': '已回答 {answered}/{total}',
  'flow.requiredUnanswered': '* 请回答必答题',

  'flow.reedit.before': '本问卷允许重新作答。修改答案后，需',
  'flow.reedit.emphasis': '继续作答至最后并提交',
  'flow.reedit.after': '，才会记为完成。未提交就离开将不会记为完成。',
  'flow.inviteInvalidAnonymous': '邀请链接无效，将以匿名方式作答。',
  'flow.resumed': '继续之前的作答',
  'flow.versionRebased': '问卷已更新，将在最新版本中继续作答',

  'screen.checking': '正在确认...',
  'screen.loading.title': '正在加载问卷...',
  'screen.loading.body': '请稍候。',
  'screen.goHome': '返回首页',
  'screen.inviteRequired.title': '需要邀请链接',
  'screen.inviteRequired.body': '本问卷仅限受邀者作答。请通过您收到的邮件或消息中的链接重新访问。',
  'screen.invalidInviteLink.title': '邀请链接无效',
  'screen.invalidInviteLink.body': '邀请链接有误或已无法使用。请联系问卷负责人。',
  'screen.tooManyRequests.title': '请稍后再试',
  'screen.tooManyRequests.body': '当前访问人数较多。链接仍然有效，请稍后重新打开。',
  'screen.invalidTestLink.title': '测试链接无效',
  'screen.invalidTestLink.body': '测试模式已结束，或此链接已无法使用。',
  'screen.desktopOnly.title': '请在电脑上打开',
  'screen.desktopOnly.body': '本问卷需要对照调查表作答，因此需要较宽的屏幕。',
  'screen.desktopOnly.hint':
    '在电脑浏览器中打开同一链接即可继续作答。窗口变宽后，此页面会立即消失。',

  'completion.title': '作答完成！',
  'completion.screenedOutTitle': '问卷结束',
  'completion.defaultMessage': '感谢您参与本次问卷调查！',
  'completion.completedAt': '作答完成时间：{time}',
  'completion.previewTitle': '问卷检查完成',
  'completion.previewMessage': '填写的内容未被保存。',

  'endRedirect.waiting': '请稍候。',
  'endRedirect.fallbackBefore': '如果页面没有跳转，',
  'endRedirect.fallbackLink': '请点击这里',
  'endRedirect.fallbackAfter': '。',
  'endRedirect.testNotice': '这是测试作答，因此不会跳转。实际作答将跳转至以下地址。',

  'notice.contactEmail': '咨询邮箱',
  'notice.testVersionRepublished.title': '问卷已修改',
  'notice.testVersionRepublished.body': '刷新页面后，将从修改处继续。',
  'notice.responseConcluded.title': '问卷已完成',
  'notice.responseConcluded.body': '此作答已提交完成。感谢您的参与。',
  'notice.invalidToken.title': '邀请链接有误',
  'notice.invalidToken.body': '此链接无效或已过期。请联系问卷负责人。',
  'notice.alreadyResponded.title': '您已作答过本问卷',
  'notice.tokenAlreadyUsed.body': '此邀请链接已提交过作答，不允许重复作答。',
  'notice.deviceAlreadyResponded.body': '此设备已有本问卷的作答记录。每人仅可作答一次。',
  'notice.invalidTestToken.title': '测试链接无效',
  'notice.invalidTestToken.body': '测试模式已关闭或链接有误。请在运营控制台重新复制测试链接。',
  'notice.notAccepting.title': '目前不接受作答',
  'notice.notAccepting.body': '本问卷目前不接受作答。请确认链接是否正确，或联系问卷负责人。',

  'default.paused': '问卷已暂停。请稍后再试。',
  'default.quotaClosed': '该条件的名额已满，无法继续参与。感谢您的参与。',
  'default.quotaMidSurveyClosed':
    '非常抱歉，在您作答期间该条件的名额已满，无法继续作答。感谢您抽出宝贵时间参与。',
};

const EN: Dictionary = {
  'nav.previous': 'Previous',
  'nav.next': 'Next',
  'nav.submitting': 'Processing...',
  'progress.answered': '{answered}/{total} answered',
  'flow.requiredUnanswered': '* Please answer the required questions',

  'flow.reedit.before': 'You are allowed to edit your response. After editing, you must ',
  'flow.reedit.emphasis': 'continue to the end and submit',
  'flow.reedit.after':
    ' for it to be recorded as complete. If you leave without submitting, it will not be completed.',
  'flow.inviteInvalidAnonymous': 'The invitation link is invalid, so you will respond anonymously.',
  'flow.resumed': 'Continuing your previous response',
  'flow.versionRebased': 'The survey has been updated. You will continue in the latest version.',

  'screen.checking': 'Checking...',
  'screen.loading.title': 'Loading the survey...',
  'screen.loading.body': 'Please wait a moment.',
  'screen.goHome': 'Back to home',
  'screen.inviteRequired.title': 'An invitation link is required',
  'screen.inviteRequired.body':
    'Only invited respondents can take this survey. Please open it again using the link in the email or message you received.',
  'screen.invalidInviteLink.title': 'Invalid invitation link',
  'screen.invalidInviteLink.body':
    'The invitation link is incorrect or can no longer be used. Please contact the survey administrator.',
  'screen.tooManyRequests.title': 'Please try again shortly',
  'screen.tooManyRequests.body':
    'There are too many connections at the moment. Your link is still valid, so please open it again in a moment.',
  'screen.invalidTestLink.title': 'Invalid test link',
  'screen.invalidTestLink.body': 'Test mode has ended, or this link can no longer be used.',
  'screen.desktopOnly.title': 'Please open this on a PC',
  'screen.desktopOnly.body':
    'This survey is answered while viewing the questionnaire side by side, so it needs a wide screen.',
  'screen.desktopOnly.hint':
    'Open the same link in a PC browser to continue. This screen disappears as soon as the window is wide enough.',

  'completion.title': 'Response complete!',
  'completion.screenedOutTitle': 'Survey ended',
  'completion.defaultMessage': 'Thank you for taking part in the survey!',
  'completion.completedAt': 'Completed at: {time}',
  'completion.previewTitle': 'Survey check complete',
  'completion.previewMessage': 'Your entries were not saved.',

  'endRedirect.waiting': 'Please wait a moment.',
  'endRedirect.fallbackBefore': 'If you are not redirected, ',
  'endRedirect.fallbackLink': 'click here',
  'endRedirect.fallbackAfter': '.',
  'endRedirect.testNotice':
    'This is a test response, so you will not be redirected. Real responses go to the address below.',

  'notice.contactEmail': 'Contact email',
  'notice.testVersionRepublished.title': 'The survey has been modified',
  'notice.testVersionRepublished.body': 'Refresh the page to continue from where it changed.',
  'notice.responseConcluded.title': 'This survey is already completed',
  'notice.responseConcluded.body':
    'This response has already been submitted. Thank you for taking part.',
  'notice.invalidToken.title': 'Incorrect invitation link',
  'notice.invalidToken.body':
    'This link is invalid or has expired. Please contact the survey administrator.',
  'notice.alreadyResponded.title': 'You have already responded to this survey',
  'notice.tokenAlreadyUsed.body':
    'A response has already been submitted with this invitation link. Duplicate responses are not allowed.',
  'notice.deviceAlreadyResponded.body':
    'This device has already responded to this survey. Only one response per person is allowed.',
  'notice.invalidTestToken.title': 'The test link is invalid',
  'notice.invalidTestToken.body':
    'Test mode is off or the link is incorrect. Please copy the test link again from the operations console.',
  'notice.notAccepting.title': 'Responses are not being accepted right now',
  'notice.notAccepting.body':
    'This survey is not accepting responses at the moment. Please check the link or contact the survey administrator.',

  'default.paused': 'The survey has been paused. Please try again later.',
  'default.quotaClosed':
    'Recruitment for your group is complete, so you can no longer take part. Thank you for your interest.',
  'default.quotaMidSurveyClosed':
    'We are sorry. Recruitment for your group was completed while you were responding, so you cannot continue. Thank you for taking the time to take part.',
};

export const SYSTEM_STRINGS: Readonly<Record<SurveyLocale, Dictionary>> = {
  ko: KO,
  zh: ZH,
  en: EN,
};

export type SystemStringValues = Readonly<Record<string, string | number>>;

function fill(template: string, values: SystemStringValues | undefined): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/**
 * 한 언어의 문장 목록 — 언어가 정해지면 그 언어 하나, 미정(`null`)이면 한국어 · 中文 · English
 * 순으로 세 언어(같은 문장은 한 번). 언어가 정해지기 전 안내 화면이 세 언어를 위아래로 쌓는다.
 */
export function systemTextLines(
  key: SystemStringKey,
  locale: SurveyLocale | null,
  values?: SystemStringValues,
): { locale: SurveyLocale; text: string }[] {
  const locales = locale === null ? SURVEY_LOCALES : [locale];
  const seen = new Set<string>();
  const lines: { locale: SurveyLocale; text: string }[] = [];
  for (const l of locales) {
    const text = fill(SYSTEM_STRINGS[l][key], values);
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push({ locale: l, text });
  }
  return lines;
}

/**
 * 시스템 문장 하나. 언어를 주지 않으면 한국어 — 기존 호출부는 지금 문장 그대로다.
 * 미정(`null`)이면 세 언어를 줄바꿈으로 잇는다(줄바꿈을 살리는 자리에서 위아래로 쌓인다).
 */
export function systemText(
  key: SystemStringKey,
  locale: SurveyLocale | null = DEFAULT_SURVEY_LOCALE,
  values?: SystemStringValues,
): string {
  return systemTextLines(key, locale, values)
    .map((line) => line.text)
    .join('\n');
}
