/**
 * 2025년 인공지능산업 실태조사 가상 응답 1건 생성 스크립트
 *
 * 접근:
 * - 가상 중소 AI 기업 프로필을 기반으로 일관된 수치·선택 응답 생성
 * - branch-logic 구조를 인라인 복제(shouldDisplayQuestion / getBranchRule)
 * - 시나리오 맵(질문 UUID → 응답값/함수)으로 주요 분기·수치·텍스트 지정
 * - 미정의 질문은 현실감 있는 기본값 (첫 옵션 편향 피해 행별 편차 부여)
 * - survey_responses INSERT 후 response_answers 이중쓰기, 실패 시 수동 롤백
 *
 * 실행: pnpm tsx scripts/generate-ai-survey-response.ts
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

import { normalizeToAnswers } from '../src/lib/response-normalizer';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uyfahntiitrcuizdnlbq.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다. .env.local 확인');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ========================================
// 상수
// ========================================
const SURVEY_ID = '1d7153b0-f4fe-4ee6-ac54-ac81668e24ee';
// 현재 published 버전 (surveys.current_version_id 와 일치해야 함)
const VERSION_ID = 'f7f35027-9ef1-4e29-a9fd-e0780e106335';

// 질문 UUID (주요 분기/시나리오 대상)
const QID = {
  // notice 3건 (응답 저장 안 함)
  INTRO_NOTICE: 'e2350353-6079-4cf0-9f7e-c6ca6657e08f',
  GUIDE_NOTICE: '4f1aa852-3700-4c9e-8a26-db29d0861fe7',
  EXPORT_NOTICE: '1fda4020-a82b-4e64-87ea-00bbd6fb5fd8',
  // 인트로·일반현황
  Q1_INTRO: 'f134db63-6f94-4d34-a4ea-9edb5330a2d0', // table 기업 소개
  Q1_GENERAL: '634c89ea-476d-4e26-be7e-09c05e8718e1', // table 일반현황
  // 기술·사업현황
  Q2: '485e66ee-fedb-4664-901e-3586ad172eb1', // table 보유 기술
  Q3: 'd5269ab6-dd6f-41ff-b63d-9106b4232fe8', // ranking 주력 사업
  Q4: '04bcfbe3-9a3d-4e69-8c66-19dfb594a040', // ranking 응용 산업
  Q5: '24a50d59-0532-4aa4-9ff2-41f3947ab046', // checkbox 도구 형태
  Q5_1: '2914bbeb-6f21-401e-8a10-dc943dc6e715', // checkbox 오픈소스 활용
  Q6: 'f3c5d6a8-b486-4b9e-b3d6-0420f90865eb', // checkbox 모델 규모
  Q6_1: '065adc57-497d-4ea4-a7da-aa77b6a331b9', // checkbox 연산량
  Q7: '68d3f9f4-7725-449e-a6fd-fe691597dfa5', // radio 인프라
  Q7_1: '60f77390-218f-4a94-8dbf-3c3d99b3258d', // table 현재 비율
  Q7_2: 'a9b3777e-e117-40e4-8ec7-305104375660', // table 3년 후 비율
  Q8: '386acb45-c7b0-4cef-b897-d8eab9dd3562', // table GPU 보유
  Q10: '240a10b6-f14f-47a1-a895-0ad9220d18fb', // radio NPU
  Q11: '956d9e02-5f14-4d53-994d-070f65ec9dbb', // checkbox 데이터 확보
  Q11_1: '56ab1c1b-55bc-476b-9c09-e79ecc9d893e', // table 공공데이터 비중
  Q11_2: '27bca1da-f472-4580-9f23-4e646d6dab23', // checkbox 데이터 애로
  Q12: '0bf90fd9-ef40-4662-8f5e-e39c45ea7845', // table 정부지원
  Q12_1: '05c2c01d-b2c1-440c-8277-eac9405828ea', // table 과기부 지원
  Q12_2: 'e16dfb24-75ff-4033-bebe-8aad524720b2', // textarea 지원 의견
  Q13: '5157b2fd-dc8f-4c57-b0ce-edecb37b25dc', // radio 가이드라인
  Q14: '29c5ea68-66d5-4e73-bbfe-9e99cd51aa97', // radio 전담 조직
  Q15: 'be8c5c2e-7c8f-4208-bf59-c437301e49b3', // table 신뢰성 활동
  // 매출
  Q16: 'b83f29a6-07eb-41af-a138-86f1424262f7', // table 매출
  // 해외 수출
  Q17: '71bc208d-6588-4cd4-8602-b13dbe083f96', // radio 수출 여부
  Q18: 'd434c734-103c-4cb8-947b-452fe52cb693', // table 수출액
  Q18_1: 'd4a3de1d-7973-4e68-b17f-9934254c1c0d', // table 수출 국가
  Q19: '8b101b32-7835-4978-9179-9aafa36b59d6', // table 수출 계획
  Q20: '437bd80c-eefb-440c-85f8-538739554458', // checkbox 수출 안 하는 이유 (Q17=아니오 시)
  Q21: 'f2827498-b2eb-434f-a2e5-af2ea4c7790f', // radio 수출 계획 시점
  Q21_1: '2882abb0-1644-4e5a-b622-2a0100d2decd', // checkbox 희망 수출 지역
  Q22: '7b85927c-e7c7-4f24-8323-87db8805641f', // table 수출 지원
  Q13_1: '732854ee-021c-40e3-b254-d7ce96088c87', // radio 가이드라인 도입 계획 (Q13=아니오 시)
  // 인력
  Q23: '950e93b4-0fe1-4a4a-bf6a-41bfacb97fb3', // table 인력
  Q24: 'a180b53b-f17a-4473-aeed-6139899c5a08', // table 직업별
  Q25: '6adbade3-e6bf-499d-8f7f-34cd993ef2cb', // table 학력별
  Q26: 'b7155cc5-86a2-4681-92d6-e161f7977bfa', // ranking 채용 고려사항
  Q27: '55846ec4-e6b1-49d0-8c8b-3be4a901c730', // radio 교육
  // 투자·개발
  Q28: '274e9f58-feb0-4e34-be92-8e1a1c6305ae', // table 자금
  Q29: '413bd6a3-0eae-49bb-9b04-12dc363e28c3', // table R&D
  Q30: '445190b4-2f1e-4c73-8855-9f01826c6e9c', // radio 투자유치
  Q30_1: '4a14c68d-923c-4f79-9fe3-ccd0876c4411', // table 투자 건수
  Q30_2: '1e73b0ac-cb5f-4b30-8d77-2fa96d0ba677', // table 투자 방법
  Q31: 'c975eff5-385a-41ea-9d5a-ffa47c8aa326', // table 특허
  Q32: '261475d2-a321-4478-b355-96d58e6828e8', // radio 국제 표준
  // 애로사항
  Q33: '20114768-2f52-44b8-8e56-c73a452e6d17', // table 애로사항
  Q33_1: '9fe1b896-f884-4720-b1c7-1b34b80c8297', // textarea 애로 서술
};

// ========================================
// 가상 기업 프로필 (50종)
// ========================================
type AiDomain =
  | 'llm'           // 언어모델/생성형
  | 'vision'        // 컴퓨터비전
  | 'speech'        // 음성/STT/TTS
  | 'recsys'        // 추천/검색/광고
  | 'robotics'      // 로보틱스/자율주행
  | 'medical'       // 의료/바이오
  | 'finance'       // 금융/리스크
  | 'manufacturing' // 제조/품질검사
  | 'edu'           // 교육/HR
  | 'agent';        // 에이전트/RPA

const DOMAIN_KO: Record<AiDomain, string> = {
  llm: '언어모델/생성형',
  vision: '컴퓨터비전',
  speech: '음성·음향',
  recsys: '추천/검색',
  robotics: '로보틱스·자율주행',
  medical: '의료·바이오',
  finance: '금융·리스크',
  manufacturing: '제조·품질검사',
  edu: '교육·HR',
  agent: '에이전트·자동화',
};

interface Profile {
  companyName: string;
  ceoName: string;
  ceoGender: string;
  contactName: string;
  contactTitle: string;
  contactDept: string;
  contactPhone: string;
  contactMobile: string;
  contactEmail: string;
  bizNo: string;
  corpRegNo: string;
  foundedYear: number;
  foundedMonth: number;
  planDevYear: number;
  planDevMonth: number;
  launchYear: number;
  launchMonth: number;
  address: string;
  homepage: string;
  employees: number;
  aiEmployees: number;
  revenueTotal2024: number;
  revenueAi2024: number;
  revenueTotal2025: number;
  revenueAi2025: number;
  export2024Total: number;
  investment2024: number;
  gpu: { A100: number; H100: number };
  patentKorea: number;
  patentAbroad: number;
  capitalM: number;          // 자본금 (백만원)
  domain: AiDomain;          // 주력 도메인
  domainSecondary?: AiDomain; // 보조 도메인 (일부 회사)
  selfInfraRatio: number;    // Q7-1 자체 인프라 비율 (0~100, 정수)
  selfInfraRatio3y: number;  // Q7-2 3년 후 자체 인프라 비율
  // 분기 결정
  hasExport: boolean;       // Q17
  hasInvestment: boolean;   // Q30
  hasGuideline: boolean;    // Q13 → Q14 vs Q13_1
  hasTraining: boolean;     // Q27
  hasIntlStandard: boolean; // Q32
  npuChoice: '옵션1' | '옵션2' | '옵션3' | '옵션4'; // Q10
  infraChoice: '옵션1' | '옵션2' | '옵션3';          // Q7
  useOtherRare: boolean;    // 이 응답자가 기타 옵션 활용 여부 (Q5_1 등)
}

const COMPANY_NAMES = [
  '(주)네오픽셀에이아이', '(주)브릿지에이아이', '(주)코어마인드', '딥서치테크(주)', '(주)알파레이',
  '(주)시그널네트웍스', '비전플로우(주)', '(주)텐서스튜디오', '루프라보', '(주)엣지브레인',
  '(주)솔라리스AI', '뉴럴스케일', '(주)모먼텀랩스', '퍼셉트론웍스', '(주)컨텍스트AI',
  '리얼플로우(주)', '(주)하이퍼노드', '믹스매트릭스', '(주)옵틱센스', '코그넷시스템',
  '(주)프로메테우스AI', '데이터스피어', '(주)애로우AI', '스칼라머신', '(주)리플AI',
  '퓨전마인드(주)', '(주)컴파스AI', '라이트하우스랩', '(주)아테네테크', '카르마AI(주)',
  '(주)페르마랩', '노바신스', '(주)멜팅포인트', '옥타브테크', '(주)리렐티브',
  '피크스타AI(주)', '(주)센티멘트', '글로벌엣지AI', '(주)밸런스테크', '아크노바',
  '(주)씨이라', '프론티어AI(주)', '(주)오아시스랩', '뮤타블AI', '(주)플라즈마노드',
  '딥엔트로피(주)', '(주)시너지AI', '원픽셀랩', '(주)큐빗테크', '(주)해리슨AI',
  // 51~120 (총 120건 지원)
  '(주)인텔리젠스', '딥코어AI', '(주)뉴로핀', '센스메이커(주)', '(주)볼트마인드',
  '아토믹AI', '(주)퀀텀리프', '메타뷰랩스', '(주)시냅스', '코드웨이브',
  '(주)인사이트AI', '플럭스테크', '(주)제로엔트로피', '래티스AI', '(주)스펙트럼',
  '옵티마인드(주)', '(주)베리타스AI', '딥캐스트', '(주)노바코어', '하모닉스AI',
  '(주)트레이스', '큐리오시티랩', '(주)패러다임', '센티언스(주)', '(주)볼테라',
  '에테르AI', '(주)크로노스', '미디어파이', '(주)그래비티AI', '심플렉스랩',
  '(주)포텐셜', '뉴클리어스AI', '(주)아르고스', '비욘드테크(주)', '(주)래디언트',
  '프리즘AI', '(주)에코시스템', '딥필드', '(주)모자이크', '클러스터AI',
  '(주)벡터스페이스', '하이드라테크', '(주)썬더볼트', '레조넌스AI', '(주)인피니트',
  '코스모스랩(주)', '(주)에지워크', '뉴턴AI', '(주)스택플로우', '바이탈리티테크',
  '(주)오라클마인드', '제니스AI', '(주)포지트론', '루미너스랩', '(주)카탈리스트',
  '스파크AI(주)', '(주)트랜스폼', '딥하버', '(주)노드웍스', '엘리먼트AI',
  '(주)퓨처스택', '인테그랄테크', '(주)미라클AI', '솔리드랩', '(주)에버그린AI',
  '퀀텀독(주)', '(주)라이트스피드', '뉴로블룸', '(주)센터AI', '아크라이트랩',
];

const CEO_NAMES_M = [
  '김주원', '이재혁', '박성훈', '최민규', '정우진', '강태호', '윤상현', '장동민',
  '한경석', '오세훈', '신동현', '임재현', '조민규', '권성윤', '남궁훈', '유승원',
  '안재영', '고진호', '배성재', '하준혁',
];
const CEO_NAMES_F = [
  '김소연', '이지은', '박하은', '최유진', '정서현', '강예린', '윤수빈', '장미경',
  '한다영', '오은서',
];
const CONTACT_NAMES = [
  '박서연', '김민지', '이수영', '정하늘', '최유리', '강도윤', '윤지안', '장서우',
  '한승호', '오민재', '신예진', '임채현', '조유나', '권동찬', '남혜린', '유태경',
];
const TITLES = ['경영기획팀 팀장', '전략기획실 실장', '사업개발팀 팀장', 'AI연구소 소장', '경영관리팀 과장'];
const DEPTS = ['경영기획팀', '전략기획실', '사업개발팀', 'AI연구소', '경영관리팀'];
const ADDRESSES = [
  '서울특별시 강남구 테헤란로 427', '서울특별시 서초구 반포대로 45', '서울특별시 마포구 양화로 100',
  '경기도 성남시 분당구 판교로 235', '경기도 수원시 영통구 광교중앙로 300',
  '서울특별시 구로구 디지털로 26길 61', '대전광역시 유성구 대학로 291', '부산광역시 해운대구 센텀중앙로 79',
  '서울특별시 송파구 올림픽로 300', '경기도 성남시 수정구 성남대로 1342',
];

// 난수 시드 고정 (재현성)
function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const DOMAINS: AiDomain[] = [
  'llm', 'vision', 'speech', 'recsys', 'robotics',
  'medical', 'finance', 'manufacturing', 'edu', 'agent',
];

function generateProfile(idx: number): Profile {
  const rng = seededRand(idx * 101 + 7);
  const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
  const randi = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;

  const companyName = COMPANY_NAMES[idx];
  const isMaleCeo = idx % 5 !== 0; // 약 80% 남성 (AI 업계 현실 반영)
  const ceoName = isMaleCeo ? CEO_NAMES_M[idx % CEO_NAMES_M.length] : CEO_NAMES_F[idx % CEO_NAMES_F.length];

  // 도메인: 50건을 10개 도메인에 균등 분포(각 5건). 일부 회사에 보조 도메인 부여.
  const domain: AiDomain = DOMAINS[idx % DOMAINS.length];
  const hasSecondary = rng() < 0.35;
  const domainSecondary: AiDomain | undefined = hasSecondary
    ? DOMAINS[(idx + 3 + Math.floor(rng() * (DOMAINS.length - 1))) % DOMAINS.length]
    : undefined;

  // 규모 계층 (소-중-중견) — 120건 기준 40%/40%/20% 분포
  // idx 0~47: 소형(10~40), 48~95: 중형(40~120), 96~119: 중견(120~300)
  let employees: number;
  if (idx < 48) employees = randi(10, 40);
  else if (idx < 96) employees = randi(40, 120);
  else employees = randi(120, 300);
  const aiRatio = 0.55 + rng() * 0.4; // 55~95%
  const aiEmployees = Math.max(5, Math.round(employees * aiRatio));

  // 설립: 2010~2023 (최근 빈도 높게)
  const foundedYear = 2010 + Math.floor(rng() ** 0.6 * 14);
  const foundedMonth = randi(1, 12);
  const planDevYear = Math.min(2024, foundedYear);
  const planDevMonth = randi(1, 12);
  const launchOffsetYears = randi(0, 2);
  const launchYear = Math.min(2024, foundedYear + launchOffsetYears);
  const launchMonth = randi(1, 12);

  // 매출: 직원 × 0.5~1.8 억원 (중견일수록 1인당 매출 높게)
  const revPerHead = employees < 40 ? (0.4 + rng() * 0.6) : employees < 120 ? (0.7 + rng() * 0.8) : (1.0 + rng() * 1.2);
  const revenueTotal2024 = Math.round(employees * revPerHead);
  const revenueAi2024 = Math.round(revenueTotal2024 * (0.55 + rng() * 0.4));
  const revenueTotal2025 = Math.round(revenueTotal2024 * (1.15 + rng() * 0.35)); // 15~50% 성장
  const revenueAi2025 = Math.round(revenueAi2024 * (1.2 + rng() * 0.4));

  // 분기 결정 (독립 확률, idx 기반 의사난수로 분포 제어)
  const hasExport = rng() < 0.4;
  const hasInvestment = rng() < 0.3;
  const hasGuideline = rng() < 0.5;
  const hasTraining = rng() < 0.6;
  const hasIntlStandard = rng() < 0.18;
  const useOtherRare = rng() < 0.12;

  const export2024Total = hasExport ? Math.max(1, Math.round(revenueAi2024 * (0.08 + rng() * 0.25))) : 0;
  const investment2024 = hasInvestment ? randi(20, 300) : 0;

  // NPU 분포 (이미도입 10% / 계획 20% / 의향 45% / 없음 25%)
  const npuRng = rng();
  const npuChoice: Profile['npuChoice'] =
    npuRng < 0.10 ? '옵션1' : npuRng < 0.30 ? '옵션2' : npuRng < 0.75 ? '옵션3' : '옵션4';

  // 인프라 분포 (자사 20% / 혼합 50% / 클라우드 30%)
  const infraRng = rng();
  const infraChoice: Profile['infraChoice'] = infraRng < 0.20 ? '옵션1' : infraRng < 0.70 ? '옵션2' : '옵션3';

  // Q7-1/Q7-2 자체 인프라 비율: 인프라 선택과 일관성 유지
  // 자사 → 80~100, 혼합 → 30~70 (선형), 클라우드 → 0~20
  const selfInfraRatio =
    infraChoice === '옵션1' ? randi(80, 100)
    : infraChoice === '옵션2' ? randi(30, 70)
    : randi(0, 20);
  // 3년 후: 자사형은 그대로~약간 감소(클라우드 전환), 클라우드형은 변동 거의 없음
  const selfInfraRatio3y = Math.max(0, Math.min(100, selfInfraRatio - randi(0, 25)));

  // 자본금 (백만원): 규모와 약한 양의 상관 + 폭넓은 분산
  const capitalBase = employees < 40 ? randi(200, 1500)
                    : employees < 120 ? randi(800, 3500)
                    : randi(2500, 8000);
  const capitalM = capitalBase;

  // GPU: 규모 비례
  const a100 = Math.max(0, Math.round(aiEmployees / 12));
  const h100 = Math.max(0, Math.round(aiEmployees / 30));

  // 법인/사업자번호 (숫자만, 랜덤)
  const bizNo = String(1000000000 + randi(100000000, 999999999)).slice(0, 10);
  const corpRegNo = String(randi(100000, 999999)) + String(randi(1000000, 9999999));

  // 연락처
  const phoneArea = pick(['02', '031', '032', '042', '051', '053']);
  const contactPhone = `${phoneArea}-${randi(100, 999)}-${randi(1000, 9999)}`;
  const contactMobile = `010-${randi(1000, 9999)}-${randi(1000, 9999)}`;
  const slug = `comp${String(idx + 1).padStart(2, '0')}`;
  const contactEmail = `contact@${slug}.co.kr`;
  const homepage = `www.${slug}.co.kr`;

  return {
    companyName,
    ceoName,
    ceoGender: isMaleCeo ? '남' : '여',
    contactName: CONTACT_NAMES[idx % CONTACT_NAMES.length],
    contactTitle: pick(TITLES),
    contactDept: pick(DEPTS),
    contactPhone,
    contactMobile,
    contactEmail,
    bizNo,
    corpRegNo,
    foundedYear,
    foundedMonth,
    planDevYear,
    planDevMonth,
    launchYear,
    launchMonth,
    address: ADDRESSES[idx % ADDRESSES.length],
    homepage,
    employees,
    aiEmployees,
    revenueTotal2024,
    revenueAi2024,
    revenueTotal2025,
    revenueAi2025,
    export2024Total,
    investment2024,
    gpu: { A100: a100, H100: h100 },
    patentKorea: Math.max(0, Math.round(aiEmployees / 8)),
    patentAbroad: Math.max(0, Math.round(aiEmployees / 25)),
    capitalM,
    domain,
    domainSecondary,
    selfInfraRatio,
    selfInfraRatio3y,
    hasExport,
    hasInvestment,
    hasGuideline,
    hasTraining,
    hasIntlStandard,
    npuChoice,
    infraChoice,
    useOtherRare,
  };
}

// 현재 반복의 프로필 (루프마다 갱신)
let P: Profile = generateProfile(0);

// ========================================
// 타입 (인라인)
// ========================================
type QType = 'text' | 'textarea' | 'radio' | 'checkbox' | 'select' | 'multiselect' | 'table' | 'notice' | 'ranking';
interface QOption { id: string; label: string; value: string; hasOther?: boolean; allowTextInput?: boolean; branchRule?: BranchRule }
interface BranchRule { id: string; value: string; action: 'goto' | 'end'; targetQuestionId?: string }
interface TableCell {
  id: string;
  // choice_opt/ranking_opt: 테이블형 선택/순위 셀 (Case A / Case 2) — 응답 식별자는 cell.id
  type: 'text' | 'image' | 'video' | 'checkbox' | 'radio' | 'select' | 'input' | 'choice_opt' | 'ranking_opt';
  content?: string;
  placeholder?: string;
  checkboxOptions?: QOption[];
  radioOptions?: QOption[];
  selectOptions?: QOption[];
}
interface TableRow { id: string; label: string; cells: TableCell[]; displayCondition?: QConditionGroup }
interface QCondition {
  id: string;
  sourceQuestionId: string;
  conditionType: 'value-match' | 'table-cell-check' | 'custom';
  requiredValues?: string[];
  tableConditions?: { rowIds: string[]; cellColumnIndex?: number; checkType: 'any' | 'all' | 'none'; expectedValues?: string[] };
  logicType?: 'AND' | 'OR' | 'NOT';
  enabled?: boolean;
}
interface QConditionGroup { conditions: QCondition[]; logicType: 'AND' | 'OR' | 'NOT' }
interface Question {
  id: string;
  type: QType;
  title: string;
  required: boolean;
  order: number;
  options?: QOption[];
  tableRowsData?: TableRow[];
  tableColumns?: { id: string; label: string }[];
  displayCondition?: QConditionGroup;
  tableValidationRules?: unknown[];
  groupId?: string;
  allowOtherOption?: boolean;
  questionCode?: string;
  rankingConfig?: {
    positions: number;
    branchRankPosition?: number;
    optionsSource?: 'manual' | 'table';
    positionsColumns?: number;
    allowDuplicateRanks?: boolean;
    requireAllPositions?: boolean;
  };
}
interface QGroup {
  id: string;
  parentGroupId?: string;
  order: number;
  displayCondition?: QConditionGroup;
}

// ========================================
// 매퍼 (snake_case → camelCase)
// ========================================
function mapQuestion(q: Record<string, unknown>): Question {
  return {
    id: q.id as string,
    type: q.type as QType,
    title: (q.title as string) || '',
    required: Boolean(q.required),
    order: (q.order as number) || 0,
    options: (q.options as QOption[]) || [],
    tableRowsData: (q.table_rows_data as TableRow[]) || [],
    tableColumns: (q.table_columns as { id: string; label: string }[]) || [],
    displayCondition: (q.display_condition as QConditionGroup) || undefined,
    tableValidationRules: (q.table_validation_rules as unknown[]) || [],
    groupId: (q.group_id as string) || undefined,
    allowOtherOption: Boolean(q.allow_other_option),
    questionCode: (q.question_code as string) || undefined,
    rankingConfig: (q.ranking_config as Question['rankingConfig']) || undefined,
  };
}

function mapGroup(g: Record<string, unknown>): QGroup {
  return {
    id: g.id as string,
    parentGroupId: (g.parent_group_id as string) || undefined,
    order: (g.order as number) || 0,
    displayCondition: (g.display_condition as QConditionGroup) || undefined,
  };
}

// ========================================
// 조건 평가 (branch-logic 인라인 복제)
// ========================================
function checkValueMatch(response: unknown, required: string[]): boolean {
  if (!required?.length || response == null) return false;
  if (typeof response === 'string') return required.includes(response);
  if (Array.isArray(response)) {
    return response.some(v => {
      if (typeof v === 'string') return required.includes(v);
      if (v && typeof v === 'object' && 'selectedValue' in v) return required.includes((v as { selectedValue: string }).selectedValue);
      return false;
    });
  }
  if (typeof response === 'object' && response != null && 'selectedValue' in response) {
    return required.includes((response as { selectedValue: string }).selectedValue);
  }
  return false;
}

function evaluateCondition(c: QCondition, responses: Record<string, unknown>, questions: Question[]): boolean {
  if (c.enabled === false) return false;
  const src = responses[c.sourceQuestionId];
  if (src == null) return false;
  if (c.conditionType === 'value-match') return checkValueMatch(src, c.requiredValues || []);
  if (c.conditionType === 'table-cell-check' && c.tableConditions) {
    const srcQ = questions.find(q => q.id === c.sourceQuestionId);
    if (!srcQ?.tableRowsData) return false;
    const tc = c.tableConditions;
    const resp = src as Record<string, unknown>;
    const checked: string[] = [];
    for (const row of srcQ.tableRowsData) {
      if (!tc.rowIds.includes(row.id)) continue;
      const cells = tc.cellColumnIndex !== undefined ? [row.cells[tc.cellColumnIndex]] : row.cells;
      for (const cell of cells) {
        if (!cell) continue;
        const cv = resp[cell.id];
        if (cv) { checked.push(row.id); break; }
      }
    }
    if (tc.checkType === 'any') return checked.length > 0;
    if (tc.checkType === 'all') return tc.rowIds.every(id => checked.includes(id));
    if (tc.checkType === 'none') return checked.length === 0;
  }
  return c.conditionType === 'custom';
}

function evaluateGroup(cg: QConditionGroup | undefined, responses: Record<string, unknown>, questions: Question[]): boolean {
  if (!cg) return true;
  const enabledConds = cg.conditions.filter(c => c.enabled !== false);
  if (enabledConds.length === 0) return true;
  const results = enabledConds.map(c => evaluateCondition(c, responses, questions));
  switch (cg.logicType) {
    case 'OR': return results.some(r => r);
    case 'NOT': return !results.some(r => r);
    default: return results.every(r => r);
  }
}

function shouldDisplayQuestion(q: Question, responses: Record<string, unknown>, questions: Question[], groups: QGroup[]): boolean {
  if (q.groupId) {
    const g = groups.find(x => x.id === q.groupId);
    if (g?.displayCondition && !evaluateGroup(g.displayCondition, responses, questions)) return false;
    if (g?.parentGroupId) {
      const p = groups.find(x => x.id === g.parentGroupId);
      if (p?.displayCondition && !evaluateGroup(p.displayCondition, responses, questions)) return false;
    }
  }
  if (!q.displayCondition) return true;
  return evaluateGroup(q.displayCondition, responses, questions);
}

function getBranchRule(q: Question, response: unknown): BranchRule | null {
  if (response == null || !q.options) return null;
  if (q.type === 'radio' || q.type === 'select') {
    const val = typeof response === 'object' && response != null && 'selectedValue' in response
      ? (response as { selectedValue: string }).selectedValue : response;
    return q.options.find(o => o.value === val)?.branchRule || null;
  }
  if (q.type === 'checkbox' && Array.isArray(response)) {
    const values = response.map(v => typeof v === 'object' && v != null && 'selectedValue' in v
      ? (v as { selectedValue: string }).selectedValue : v);
    for (const opt of q.options) {
      if (values.includes(opt.value) && opt.branchRule) return opt.branchRule;
    }
  }
  return null;
}

// ========================================
// 값 생성 유틸
// ========================================
function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOptionValues(q: Question, n: number): string[] {
  const opts = (q.options || []).filter(o => !o.hasOther);
  return opts.slice(0, Math.min(n, opts.length)).map(o => o.value);
}

function nonOtherOptions(q: Question): QOption[] {
  // 기타(hasOther)·주관식(allowTextInput) 옵션은 일반 선택 풀에서 제외 —
  // 기타는 applyOtherInputs 가 __optTexts__ 사이드카와 함께 별도 처리.
  return (q.options || []).filter(o => !o.hasOther && !o.allowTextInput);
}

/** 프로필 기반 결정적 시드 */
function profileSeed(): number {
  return (P.employees * 31 + P.foundedYear * 7 + P.aiEmployees * 13 + P.foundedMonth) % 1_000_000;
}

/** 결정적 Fisher-Yates 셔플 (seed 고정 시 동일 순열) */
function deterministicShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 응답자별 checkbox 부분집합: seed 셔플 후 minN~maxN 개 선택 */
function pickOptionSubset(q: Question, seed: number, minN: number, maxN: number): string[] {
  const opts = nonOtherOptions(q);
  if (opts.length === 0) return [];
  const range = Math.max(1, maxN - minN + 1);
  const count = Math.min(opts.length, minN + (seed % range));
  return deterministicShuffle(opts, seed).slice(0, count).map(o => o.value);
}

/** 도메인 문자열을 결정적 정수 시드로 변환 (옵션 분포 다양화용) */
function domainSeed(): number {
  const d = P.domain;
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) % 1_000_003;
  return h;
}

/** pickOptionSubset + 특정 옵션 강제 포함 (분기 노출 보장용) */
function pickOptionSubsetBiased(
  q: Question,
  seed: number,
  minN: number,
  maxN: number,
  forceInclude: string[] = [],
): string[] {
  const base = pickOptionSubset(q, seed, minN, maxN);
  if (forceInclude.length === 0) return base;
  const validForced = forceInclude.filter(v => (q.options || []).some(o => o.value === v));
  if (validForced.length === 0) return base;
  const set = new Set(base);
  for (const v of validForced) set.add(v);
  return Array.from(set);
}

/** 테이블형 선택 셀(choice_opt) id 수집 — Case A checkbox/radio 응답 식별자 */
function collectChoiceCellIds(q: Question): string[] {
  const ids: string[] = [];
  for (const row of q.tableRowsData || []) {
    for (const cell of row.cells || []) {
      if (cell.type === 'choice_opt') ids.push(cell.id);
    }
  }
  return ids;
}

/** 테이블형 순위 셀(ranking_opt) id 수집 — Case 2 ranking optionValue 식별자 */
function collectRankingCellIds(q: Question): string[] {
  const ids: string[] = [];
  for (const row of q.tableRowsData || []) {
    for (const cell of row.cells || []) {
      if (cell.type === 'ranking_opt') ids.push(cell.id);
    }
  }
  return ids;
}

/** allowTextInput(상세 기재) 옵션 선택 시 채울 그럴듯한 텍스트 풀 */
const RANKING_OPTION_TEXTS: string[] = [
  '직무 적합성', '조직 문화 적합도', '성장 가능성', '실무 프로젝트 경험',
  '포트폴리오 완성도', '커뮤니케이션 역량', '문제 해결 역량', '추천인 평판',
];

/**
 * ranking: rankingConfig.positions 존중 + 셔플.
 * Case 2(optionsSource='table')는 ranking_opt 셀 id 를 optionValue 로 사용(앱 응답 형식과 일치).
 * Case 1(manual)은 options value 사용.
 * allowTextInput 옵션을 뽑으면 optionText(상세 기재) 도 채운다(앱 응답 형식과 일치).
 */
function pickRanking(
  q: Question,
  seed: number,
): Array<{ rank: number; optionValue: string; optionText?: string }> {
  const cellIds = collectRankingCellIds(q);
  // ranking 은 applyOtherInputs 대상이 아니므로 allowTextInput 기타도 후보에 포함(뽑히면 optionText 채움).
  // synthetic 기타(hasOther → __other__)만 제외.
  const manualValues = (q.options || []).filter((o) => !o.hasOther).map((o) => o.value);
  const candidates = cellIds.length > 0 ? cellIds : manualValues;
  if (candidates.length === 0) return [];
  const positions = q.rankingConfig?.positions ?? 3;
  const take = Math.min(positions, candidates.length);
  return deterministicShuffle(candidates, seed)
    .slice(0, take)
    .map((v, i) => {
      const entry: { rank: number; optionValue: string; optionText?: string } = {
        rank: i + 1,
        optionValue: v,
      };
      const opt = (q.options || []).find((o) => o.value === v);
      if (opt?.allowTextInput) {
        entry.optionText = RANKING_OPTION_TEXTS[(seed + i) % RANKING_OPTION_TEXTS.length];
      }
      return entry;
    });
}

/** 셀 input 의도 분석: placeholder `ex) ...` 패턴과 content 단위를 결합해 분류 */
type CellIntent =
  | 'year' | 'month' | 'email' | 'phone_landline' | 'phone_mobile'
  | 'company' | 'person_name' | 'job_title' | 'dept'
  | 'biz_no' | 'corp_reg_no' | 'address' | 'homepage'
  | 'gender' | 'count' | 'amount_M' | 'amount_1M' | 'amount_10K' | 'percent'
  | 'pieces' | 'years_experience' | 'unknown';

function parseCellIntent(cell: TableCell, rowLabel: string): CellIntent {
  const phRaw = (cell.placeholder || '').trim();
  const ph = phRaw.toLowerCase();
  const content = (cell.content || '').toLowerCase();
  const row = (rowLabel || '').toLowerCase();
  const all = `${ph} ${content} ${row}`;

  // placeholder의 ex) 뒤 샘플값 우선 분석
  const exMatch = phRaw.match(/ex\)\s*(.+)$/i);
  const exSample = (exMatch?.[1] || '').trim();

  // 1) 연도: 4자리 19xx/20xx
  if (/^(19|20)\d{2}$/.test(exSample)) return 'year';
  // 2) 월: 1~2자리 + content/row에 "월" 또는 연도와 쌍 패턴
  if (/^\d{1,2}$/.test(exSample) && Number(exSample) >= 1 && Number(exSample) <= 12) {
    if (/월/.test(content) || /월/.test(row) || content === '' && /시점|연도|기획|개발|출시|설립/.test(row)) {
      // 행이 "설립연도/XXX_시점" 같이 연도-월 쌍이면 ex) 12는 월
      if (/시점|연도/.test(row)) return 'month';
    }
  }

  // 3) 이메일
  if (/@|example@|메일|이메일/.test(ph + content) || exSample.includes('@')) return 'email';

  // 4) 전화
  if (/010[-\s]?\d/.test(exSample) || /휴대|핸드폰|이동/.test(all)) return 'phone_mobile';
  if (/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/.test(exSample) || /전화|tel|대표번호/.test(all)) return 'phone_landline';

  // 5) 회사/법인 이름
  if (/\(?주\)?|주식회사|메가리서치/.test(exSample)) return 'company';

  // 6) 인물 이름 (한글 2~4자)
  if (/^[가-힣]{2,4}$/.test(exSample) && !/대표|팀장|부장|과장|사원|이사|부서/.test(all)) {
    return 'person_name';
  }

  // 7) 직책/부서
  if (/대표|팀장|부장|과장|사원|이사/.test(exSample)) return 'job_title';
  if (/^(기획|영업|연구|개발|경영)(팀|부|실)?$/.test(exSample) || /부서/.test(row)) return 'dept';

  // 8) 성별
  if (/남|여|m|f/.test(exSample) && (/성별|gender/.test(all))) return 'gender';

  // 9) 사업자/법인 등록번호
  if (/^\d{10}$/.test(exSample)) return 'biz_no';
  if (/^\d{12,13}$/.test(exSample) || /법인등록/.test(row)) return 'corp_reg_no';

  // 10) 주소/홈페이지
  if (/주소|소재지|address/.test(all)) return 'address';
  if (/홈페이지|www|http/.test(all)) return 'homepage';

  // 11) 단위 기반 숫자
  if (/%/.test(content) || /비중|비율|%/.test(content)) return 'percent';
  if (/백만원/.test(content)) return 'amount_M';
  if (/천원/.test(content)) return 'amount_10K';
  if (/만원/.test(content)) return 'amount_1M';
  if (/명|인원/.test(content)) return 'count';
  if (/건/.test(content)) return 'pieces';
  if (/년|경력/.test(content) && /경력|년/.test(all)) return 'years_experience';

  return 'unknown';
}

/** intent에 따라 프로필/현실값 생성. 시드로 행마다 편차. */
function valueFromIntent(
  intent: CellIntent,
  _cell: TableCell,
  rowLabel: string,
  _qTitle: string,
  seed: number,
): string {
  const row = (rowLabel || '').toLowerCase();
  switch (intent) {
    case 'year': {
      if (/기획|개발/.test(row)) return String(P.planDevYear);
      if (/출시|서비스/.test(row)) return String(P.launchYear);
      return String(P.foundedYear);
    }
    case 'month': {
      if (/기획|개발/.test(row)) return String(P.planDevMonth);
      if (/출시|서비스/.test(row)) return String(P.launchMonth);
      return String(P.foundedMonth);
    }
    case 'email': return P.contactEmail;
    case 'phone_mobile': return P.contactMobile;
    case 'phone_landline': return P.contactPhone;
    case 'company': return P.companyName;
    case 'person_name': {
      if (/대표/.test(row)) return P.ceoName;
      return P.contactName;
    }
    case 'job_title': return P.contactTitle;
    case 'dept': return P.contactDept;
    case 'gender': return P.ceoGender;
    case 'biz_no': return P.bizNo;
    case 'corp_reg_no': return P.corpRegNo;
    case 'address': return P.address;
    case 'homepage': return P.homepage;
    case 'percent': return String(rand(10, 60));
    case 'amount_M': return String(rand(100, 8000));       // 백만원 단위 (1억~80억)
    case 'amount_10K': return String(rand(10000, 500000)); // 천원
    case 'amount_1M': return String(rand(500, 50000));     // 만원
    case 'count': return String(rand(1, 15));
    case 'pieces': return String(rand(1, 10));
    case 'years_experience': return String(rand(2, 10));
    case 'unknown':
    default:
      return String(rand(1 + seed, 30 + seed));
  }
}

/** 셀 input 값 추정: parseCellIntent → valueFromIntent */
function guessInputValue(cell: TableCell, rowLabel: string, qTitle: string, seed: number): string {
  const intent = parseCellIntent(cell, rowLabel);
  return valueFromIntent(intent, cell, rowLabel, qTitle, seed);
}

// ========================================
// textarea 템플릿 (회사명·도메인 치환)
// ========================================
const Q12_2_TEMPLATES: string[] = [
  '{COMPANY}는 {DOMAIN_KO} 분야 중심으로 사업을 운영 중이며, 과학기술정보통신부의 AI 바우처와 공공 GPU 자원 공유 사업이 초기 인프라 부담을 크게 줄여주었습니다. 지원 규모가 제한적이라 아쉽고, 단계별 후속 지원과 해외 진출 컨설팅이 보강되면 좋겠습니다.',
  '정부지원 사업의 체감 효과는 긍정적이나 행정 절차가 복잡해 {DOMAIN_KO} 스타트업 실무 부담이 큽니다. 신청-선정-정산 단계의 간소화와 실적 중심의 성과 평가 방식 도입을 건의드립니다.',
  '{DOMAIN_KO} 전문 인력 채용 부담이 가장 큰 이슈이며, 관련 인건비 지원 확대가 필요합니다. 중소기업이 활용 가능한 고성능 GPU 자원 공유 사업을 상시 운영으로 전환해 주시기를 희망합니다.',
  '연구개발 바우처는 도움이 되지만 수출·글로벌 진출에 직접 연결되는 지원이 부족합니다. {COMPANY} 같은 {DOMAIN_KO} 기업 입장에서는 현지 파트너 매칭, 해외 인증·표준 대응 컨설팅, 수출 금융 보증이 함께 제공되면 실질적 도움이 될 것 같습니다.',
  '지원 사업의 가시적 효과를 체감하고 있으나, 대상 선정 기준이 매출·인력 규모 중심이라 초기 스타트업에게는 진입 장벽이 높습니다. 기술성·성장 잠재력 중심의 평가 비중 확대를 제안합니다.',
  '{DOMAIN_KO} 분야 특성상 모델 학습용 고품질 데이터 확보가 핵심인데, 공공데이터 개방 범위와 갱신 주기 측면에서 개선 여지가 큽니다. AI 허브 데이터셋의 도메인 다양성 확대를 요청드립니다.',
  '정부 R&D 과제의 보고·정산 행정 부담이 실제 연구 시간을 잠식하고 있습니다. 중소기업 대상으로는 정산 간소화 트랙을 별도로 운영해 주시면 좋겠습니다.',
  '바우처 단가가 시중 클라우드/SaaS 가격을 따라가지 못해 실효성이 떨어지는 경우가 있습니다. {DOMAIN_KO} 워크로드 기준 단가 현실화가 필요합니다.',
  '공공 GPU 자원 공유 프로그램은 도움이 되지만 자원 할당 대기 시간이 길어 모델 학습 사이클 관리가 어렵습니다. 예약·우선순위 정책의 투명한 공개를 건의합니다.',
  '{DOMAIN_KO} 분야에서 활용할 수 있는 산학 협력 채널과 박사급 연구원 매칭 프로그램이 강화되면 인력난 해소에 도움이 됩니다. 인건비 매칭형 지원도 확대 부탁드립니다.',
  '국내 시장만으로는 매출 한계가 분명해 해외 진출 지원이 절실합니다. 현지 데이터 컴플라이언스(GDPR·HIPAA·CCPA 등) 대응 자문이 통합 패키지로 제공되면 좋겠습니다.',
  '신청 가능한 사업이 부처별·기관별로 분산되어 있어 우리 같은 {DOMAIN_KO} 중소기업이 전체 조망을 갖기 어렵습니다. 통합 포털과 맞춤형 알림 기능 강화를 제안합니다.',
];

const Q33_1_TEMPLATES: string[] = [
  '{COMPANY}는 {DOMAIN_KO} 분야 중심 사업을 영위하며, 가장 큰 어려움은 고성능 GPU 확보와 유지 비용 부담입니다. 시니어 AI 연구 인력 수급도 제한적이라 채용 경쟁이 치열하고, 해외 고객 확보를 위한 수출 금융과 현지 파트너십 지원 체계가 미흡합니다.',
  'AI 학습 데이터 품질과 라벨링 비용이 가장 부담되는 영역이며, 공공데이터의 표준화·최신성 개선이 필요합니다. 규제 환경이 빠르게 바뀌어 대응 비용도 증가 추세입니다.',
  '해외 수출을 위한 현지 인증·규제 대응 부담이 가장 크고, 법률·표준 자문 비용이 {DOMAIN_KO} 중소기업에는 큰 장벽입니다. 관련 컨설팅 바우처 확대가 절실합니다.',
  '{DOMAIN_KO} 기술 개발 특성상 단기 성과 압박이 크고 장기 R&D 투자 여력이 부족합니다. R&D 세액 공제 확대와 장기 연구 과제 지원 채널이 강화되면 좋겠습니다.',
  '고객사의 보안 요구와 자체 인프라 구축 비용 사이의 균형을 맞추기가 어렵습니다. 공공 부문에서 보안 인증을 받은 클라우드 인프라 공동 활용 프로그램이 있으면 도움이 될 것 같습니다.',
  '{DOMAIN_KO} 분야 인력 풀 자체가 협소해 시니어 채용 시 연봉 인플레이션이 심합니다. 산학협력 기반 신진 연구원 인큐베이팅 사업 확대가 필요합니다.',
  '대기업·플랫폼사와의 가격 경쟁에서 {COMPANY} 같은 전문 AI 스타트업이 마진을 확보하기 어렵습니다. 공공조달 우대와 기술 변별력 가점이 강화되면 좋겠습니다.',
  'AI 모델 라이선스 및 가중치 활용에 대한 법적 가이드라인이 모호해 제품 출시 의사결정에 시간이 많이 소요됩니다. 명확한 컴플라이언스 가이드 발간이 필요합니다.',
  '대규모 학습용 데이터 확보가 가장 큰 비용 항목이며, 도메인 특화 공공데이터 개방과 라이선스 명확화가 시급합니다. 데이터 거래소 활성화도 함께 진행되었으면 합니다.',
  '글로벌 빅테크의 빠른 모델 업데이트 주기 때문에 {DOMAIN_KO} 분야 기술 격차 유지가 어렵습니다. 국가 차원의 파운데이션 모델 R&D 컨소시엄 참여 기회 확대를 제안합니다.',
  '수출 사업에서 현지화·LQA·고객 지원 비용이 매출 대비 비중이 높아 손익 분기를 맞추기 어렵습니다. 해외 거점 인큐베이팅 지원 사업이 확대되면 좋겠습니다.',
  '인공지능 신뢰성·안전성 관련 외부 감리·인증 비용 부담이 중소기업에 큰 편입니다. 공공 인증기관 이용 시 비용 매칭 지원 확대를 건의드립니다.',
];

function renderTemplate(templates: string[], seed: number): string {
  const tpl = templates[Math.abs(seed) % templates.length];
  const domainKo = DOMAIN_KO[P.domain] ?? '인공지능';
  return tpl
    .replace(/\{COMPANY\}/g, P.companyName)
    .replace(/\{DOMAIN_KO\}/g, domainKo);
}

// ========================================
// 시나리오 맵: 질문 UUID → 응답값 또는 함수
// 참고: table의 경우 함수가 cellId 기반 response 객체 반환
// row-level displayCondition 평가가 필요한 필러는 responses/questions 활용
// ========================================
type ScenarioFn = (q: Question, responses: Record<string, unknown>, questions: Question[]) => unknown;
const SCENARIOS: Record<string, ScenarioFn> = {
  // --------- radio/checkbox (플랜 분기 결정표) ---------
  [QID.Q5]: (_q) => {
    // 프로필별로 1~3개 도구 조합
    const combos = [
      ['옵션1', '옵션2', '옵션3'], // 자체+오픈소스+AI솔루션
      ['옵션2', '옵션3'],          // 오픈소스+AI솔루션
      ['옵션1', '옵션3'],          // 자체+AI솔루션
      ['옵션1'],                   // 자체만
      ['옵션2'],                   // 오픈소스만
    ];
    const idx = (P.employees + P.foundedYear) % combos.length;
    return combos[idx];
  },
  [QID.Q5_1]: (q) =>
    // 도메인별 오픈소스 활용 패턴이 달라지도록 domainSeed 합성.
    // 기타 입력은 applyOtherInputs 가 __optTexts__ 와 함께 처리(잘못된 'other' push 제거).
    pickOptionSubset(q, profileSeed() + domainSeed() + 11, 1, 3),
  [QID.Q6]: (q) => pickOptionSubset(q, profileSeed() + domainSeed() + 23, 1, 3), // 모델 규모 1~3개
  [QID.Q6_1]: (q) => pickOptionSubset(q, profileSeed() + domainSeed() + 31, 1, 2), // 연산량 1~2개
  [QID.Q7]: () => P.infraChoice,
  [QID.Q10]: () => P.npuChoice,
  [QID.Q11]: (q) => {
    // Q11_1 노출 보장(30%): Q11에 '옵션3'(공공데이터) 강제 포함
    const forceQ3 = (profileSeed() % 10) < 3 ? ['옵션3'] : [];
    return pickOptionSubsetBiased(
      q,
      profileSeed() + domainSeed() + 47,
      P.employees < 50 ? 2 : 3,
      5,
      forceQ3,
    );
  },
  [QID.Q11_2]: (q) => pickOptionSubset(q, profileSeed() + domainSeed() + 59, 2, 4), // 데이터 애로 2~4개
  [QID.Q13]: () => (P.hasGuideline ? '옵션1' : '옵션2'),
  [QID.Q13_1]: () => {
    // Q13=아니오일 때만 노출. 도입 계획 여부 분포: 예(기타) 40% / 아니오 60%
    return ((P.employees + P.foundedMonth) % 10) < 4
      ? { selectedValue: 'other', otherValue: '도입 검토 중입니다', hasOther: true }
      : '옵션2';
  },
  [QID.Q14]: () => (P.aiEmployees > 20 ? '옵션1' : '옵션2'), // 규모 클수록 전담 조직 있음
  [QID.Q17]: () => (P.hasExport ? '옵션1' : '옵션2'),
  [QID.Q20]: (q) => pickOptionSubset(q, profileSeed() + 71, 2, 4),       // 수출 안 하는 이유 2~4개
  [QID.Q21]: (q) => {
    const opts = nonOtherOptions(q);
    if (opts.length === 0) return null;
    return opts[profileSeed() % opts.length].value;
  },
  [QID.Q21_1]: (q) => pickOptionSubset(q, profileSeed() + 83, 1, 4),     // 희망 수출 지역 1~4개
  [QID.Q27]: () => (P.hasTraining ? '옵션1' : '옵션2'),
  [QID.Q30]: () => (P.hasInvestment ? '옵션1' : '옵션2'),
  [QID.Q32]: () => (P.hasIntlStandard ? '옵션1' : '옵션2'),

  // --------- ranking (rankingConfig.positions 존중 + 프로필+도메인 셔플) ---------
  [QID.Q3]: (q) => pickRanking(q, profileSeed() + domainSeed() + 101),
  [QID.Q4]: (q) => pickRanking(q, profileSeed() + domainSeed() + 103),
  [QID.Q26]: (q) => pickRanking(q, profileSeed() + 107), // 채용 고려사항은 도메인보다 회사 규모/문화 영향

  // --------- textarea ---------
  [QID.Q12_2]: () => renderTemplate(Q12_2_TEMPLATES, P.employees * 13 + P.foundedYear * 7 + domainSeed()),
  [QID.Q33_1]: () => renderTemplate(Q33_1_TEMPLATES, P.aiEmployees * 11 + P.foundedMonth * 17 + domainSeed() * 3),

  // --------- table (커스텀: 라벨 기반 매핑) ---------
  [QID.Q1_INTRO]: (q) => fillIntroTable(q),
  [QID.Q1_GENERAL]: (q) => fillGeneralTable(q),
  [QID.Q16]: (q) => fillRevenueTable(q),
  [QID.Q18]: (q) => fillExportAmountTable(q),
  [QID.Q18_1]: (q) => fillExportByCountryTable(q),
  [QID.Q23]: (q) => fillHumanResourceTable(q),
  [QID.Q24]: (q) => fillJobBreakdownTable(q),
  [QID.Q25]: (q) => fillEducationBreakdownTable(q),
  [QID.Q28]: (q) => fillFinanceTable(q),
  [QID.Q30_1]: (q) => fillInvestmentDealsTable(q),
  [QID.Q31]: (q) => fillPatentsTable(q),
  [QID.Q7_1]: (q) => fillInfraRatioTable(q, { self: P.selfInfraRatio, cloud: 100 - P.selfInfraRatio }),
  [QID.Q7_2]: (q) => fillInfraRatioTable(q, { self: P.selfInfraRatio3y, cloud: 100 - P.selfInfraRatio3y }),
  [QID.Q8]: (q, responses, questions) => fillGpuTable(q, responses, questions),
  [QID.Q11_1]: (q) => fillPublicDataPortionTable(q),
  [QID.Q19]: (q, responses, questions) => fillExportPlanTable(q, responses, questions),
};

// ========================================
// 커스텀 테이블 필러 (라벨 패턴 매칭)
// 테이블 구조를 DB에서 읽어 행 라벨·셀 타입을 보고 프로필 값 주입
// ========================================
function fillTableDefault(q: Question, responses: Record<string, unknown>, questions: Question[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  // 프로필 seed를 합성해 응답자마다 테이블 내 선택이 달라지게 함
  const pSeed = profileSeed();
  let seed = 0;
  for (const row of rows) {
    if (row.displayCondition && !evaluateGroup(row.displayCondition, responses, questions)) continue;
    seed++;
    let cellSeed = 0;
    for (const cell of row.cells) {
      if (cell.type === 'text' || cell.type === 'image' || cell.type === 'video') continue;
      cellSeed++;
      if (cell.type === 'radio' && cell.radioOptions?.length) {
        const idx = (pSeed + seed * 7 + cellSeed) % cell.radioOptions.length;
        out[cell.id] = cell.radioOptions[idx].value;
      } else if (cell.type === 'select' && cell.selectOptions?.length) {
        const idx = (pSeed + seed * 11 + cellSeed * 2) % cell.selectOptions.length;
        out[cell.id] = cell.selectOptions[idx].value;
      } else if (cell.type === 'checkbox' && cell.checkboxOptions?.length) {
        // 응답자×행 단위로 셔플 후 1~min(3, len)개 선택
        const shuffled = deterministicShuffle(cell.checkboxOptions, pSeed + seed * 13 + cellSeed);
        const count = 1 + ((pSeed + seed) % Math.min(3, shuffled.length));
        out[cell.id] = shuffled.slice(0, count).map(o => o.value);
      } else if (cell.type === 'input') {
        out[cell.id] = guessInputValue(cell, row.label || '', q.title, seed + pSeed);
      }
    }
  }
  return out;
}


/**
 * 기업 소개/일반현황 테이블 공통 필러.
 * 행 라벨만 보고 판단하면 같은 행 내 여러 input 셀(예: 이름+이메일, 연도+월)이
 * 같은 값으로 덮어써지는 문제가 있어, **셀 placeholder intent**를 우선 분석한다.
 */
/**
 * 의미가 정해진 라벨은 첫 옵션을 유지(법인 여부, 단위 등),
 * 그 외 미식별 셀은 profileSeed+cellSeed로 분산 선택.
 */
function MEANING_KEEP_FIRST(lbl: string): boolean {
  const l = lbl.toLowerCase();
  return (
    l.includes('법인') ||
    l.includes('단위') ||
    l.includes('통화') ||
    l.includes('연도') ||
    l.includes('년도')
  );
}

function fillCompanyInfoTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  const pSeed = profileSeed();
  let seed = 0;
  for (const row of rows) {
    const lbl = row.label || '';
    seed++;
    let inputSeq = 0; // 같은 행 내 input 순번
    let cellSeed = 0;
    for (const cell of row.cells) {
      if (cell.type === 'text' || cell.type === 'image' || cell.type === 'video') continue;
      cellSeed++;
      if (cell.type === 'input') {
        const intent = parseCellIntent(cell, lbl);
        // 특수 케이스: intent='person_name'일 때 행 라벨로 대표/응답자 구분
        let value = valueFromIntent(intent, cell, lbl, q.title, seed);
        // 행 라벨에 명시적 단서가 있고 intent=unknown이면 라벨 fallback
        if (intent === 'unknown') {
          const l = lbl.toLowerCase();
          // 복합 라벨 "기업명/대표자 성별": 첫 셀=회사명, 둘째 셀=성별
          if (l.includes('기업명') && l.includes('성별')) {
            value = inputSeq === 0 ? P.companyName : P.ceoGender;
          } else if (l.includes('기업명') || l.includes('회사') || l.includes('업체명')) {
            value = P.companyName;
          } else if (l.includes('대표')) value = inputSeq === 0 ? P.ceoName : P.ceoGender;
          else if (l.includes('주소') || l.includes('소재')) value = P.address;
          else if (l.includes('홈페이지')) value = P.homepage;
          else if (l.includes('자본')) value = String(P.capitalM); // 50건 다양화
          else if (l.includes('매출')) value = String(P.revenueTotal2024 * 100);
          else if (l.includes('직원') || l.includes('임직원') || l.includes('인력')) value = String(P.employees);
          else value = '';
        }
        out[cell.id] = value;
        inputSeq++;
      } else if (cell.type === 'radio' && cell.radioOptions?.length) {
        // 의미 라벨(법인/단위 등)은 첫 옵션 유지, 그 외는 프로필 시드로 분산
        const idx = MEANING_KEEP_FIRST(lbl)
          ? 0
          : (pSeed + seed * 7 + cellSeed) % cell.radioOptions.length;
        out[cell.id] = cell.radioOptions[idx].value;
      } else if (cell.type === 'select' && cell.selectOptions?.length) {
        const lower = lbl.toLowerCase();
        if (lower.includes('성별')) {
          // 성별 셀: 대표 프로필 성별과 일치
          const want = P.ceoGender === '남' ? /남|m/i : /여|f/i;
          const found = cell.selectOptions.find(o => want.test(o.label));
          out[cell.id] = (found || cell.selectOptions[0]).value;
        } else if (MEANING_KEEP_FIRST(lbl)) {
          out[cell.id] = cell.selectOptions[0].value;
        } else {
          const idx = (pSeed + seed * 11 + cellSeed * 3) % cell.selectOptions.length;
          out[cell.id] = cell.selectOptions[idx].value;
        }
      } else if (cell.type === 'checkbox' && cell.checkboxOptions?.length) {
        if (MEANING_KEEP_FIRST(lbl)) {
          out[cell.id] = [cell.checkboxOptions[0].value];
        } else {
          const shuffled = deterministicShuffle(cell.checkboxOptions, pSeed + seed * 13 + cellSeed);
          const count = 1 + ((pSeed + seed) % Math.min(2, shuffled.length));
          out[cell.id] = shuffled.slice(0, count).map(o => o.value);
        }
      }
    }
  }
  return out;
}

function fillIntroTable(q: Question): Record<string, unknown> {
  return fillCompanyInfoTable(q);
}

function fillGeneralTable(q: Question): Record<string, unknown> {
  return fillCompanyInfoTable(q);
}

function fillRevenueTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  // 일반적 구조: 행(전체 매출, AI 매출) × 열(2024, 2025(E))
  for (const row of rows) {
    const lbl = (row.label || '').toLowerCase();
    const inputCells = row.cells.filter(c => c.type === 'input');
    const isAi = lbl.includes('인공지능') || lbl.includes('ai');
    const isTotal = lbl.includes('전체') || (!isAi && (lbl.includes('매출') || lbl.includes('총')));
    // 2개 input 열 가정: [0]=2024, [1]=2025(E)
    if (inputCells.length >= 2) {
      if (isAi) {
        out[inputCells[0].id] = String(P.revenueAi2024 * 100); // 백만원 단위 추정
        out[inputCells[1].id] = String(P.revenueAi2025 * 100);
      } else if (isTotal) {
        out[inputCells[0].id] = String(P.revenueTotal2024 * 100);
        out[inputCells[1].id] = String(P.revenueTotal2025 * 100);
      }
    } else {
      // 비인터랙티브 셀 처리
      for (const c of row.cells) {
        if (c.type === 'radio' && c.radioOptions?.length) out[c.id] = c.radioOptions[0].value;
        else if (c.type === 'select' && c.selectOptions?.length) out[c.id] = c.selectOptions[0].value;
      }
    }
  }
  return out;
}

function fillExportAmountTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  for (const row of rows) {
    const inputCells = row.cells.filter(c => c.type === 'input');
    // 단순 1~2 입력 — 총 수출액 12억 = 1200백만원
    if (inputCells[0]) out[inputCells[0].id] = String(P.export2024Total * 100);
    if (inputCells[1]) out[inputCells[1].id] = String(Math.round(P.export2024Total * P.revenueAi2024 / P.revenueTotal2024 * 100));
  }
  return out;
}

function fillExportByCountryTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  // 수출 국가·비중: 행 3~5개 중 상위 3개 국가 비중 분배
  const shares = [50, 30, 20]; // %
  const amounts2024 = [600, 360, 240]; // 백만원
  const amounts2025 = [900, 480, 320];
  let seed = 0;
  for (const row of rows) {
    const inputCells = row.cells.filter(c => c.type === 'input');
    const selectCells = row.cells.filter(c => c.type === 'select');
    const radioCells = row.cells.filter(c => c.type === 'radio');
    if (seed < 3) {
      // select/radio 국가 선택
      for (const c of selectCells) {
        if (c.selectOptions?.length) {
          const opts = c.selectOptions;
          // 일본/미국/싱가포르 우선, 없으면 첫 옵션
          const prefer = opts.find(o => /일본|싱가포르|미국|US|JP|SG/i.test(o.label)) || opts[0];
          out[c.id] = prefer.value;
        }
      }
      for (const c of radioCells) {
        if (c.radioOptions?.length) out[c.id] = c.radioOptions[0].value;
      }
      // 입력 값들 (수출액/비중)
      if (inputCells.length >= 1) out[inputCells[0].id] = String(amounts2024[seed] || rand(100, 500));
      if (inputCells.length >= 2) out[inputCells[1].id] = String(amounts2025[seed] || rand(200, 800));
      if (inputCells.length >= 3) out[inputCells[2].id] = String(shares[seed] || rand(5, 20));
    }
    seed++;
  }
  return out;
}

function fillHumanResourceTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  for (const row of rows) {
    const lbl = (row.label || '').toLowerCase();
    const inputCells = row.cells.filter(c => c.type === 'input');
    const isAi = lbl.includes('인공지능') || lbl.includes('ai');
    if (inputCells.length >= 2) {
      if (isAi) {
        out[inputCells[0].id] = String(P.aiEmployees);
        out[inputCells[1].id] = String(P.aiEmployees + 8); // 2025(E)
      } else {
        out[inputCells[0].id] = String(P.employees);
        out[inputCells[1].id] = String(P.employees + 12);
      }
    }
  }
  return out;
}

function fillJobBreakdownTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  // AI 인력 58 = 연구개발 36 + 기획/PM 10 + 데이터 8 + 운영/기타 4
  const dist: Record<string, number> = {
    '연구개발': 36, '개발': 36, '엔지니어': 36,
    '기획': 10, 'pm': 10,
    '데이터': 8, '라벨링': 8, '수집': 8,
    '운영': 4, '관리': 4, '기타': 4, '교육': 4,
  };
  let assigned = 0;
  for (const row of rows) {
    const lbl = (row.label || '').toLowerCase();
    const inputCells = row.cells.filter(c => c.type === 'input');
    let match = 0;
    for (const [k, v] of Object.entries(dist)) {
      if (lbl.includes(k)) { match = v; break; }
    }
    if (match === 0) match = Math.max(1, Math.floor((P.aiEmployees - assigned) / Math.max(1, rows.length)));
    assigned += match;
    if (inputCells[0]) out[inputCells[0].id] = String(match);
    // 추가 열(성별 분포 등) 자동 분배
    for (let i = 1; i < inputCells.length; i++) {
      out[inputCells[i].id] = String(Math.max(1, Math.floor(match / (i + 1))));
    }
  }
  return out;
}

function fillEducationBreakdownTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  // AI 58 = 학사 22 + 석사 28 + 박사 8
  const dist: Record<string, number> = {
    '학사': 22, '4년': 22,
    '석사': 28, '대학원': 28,
    '박사': 8, 'phd': 8,
    '고졸': 0, '전문': 0,
    '기타': 0,
  };
  // 경력: 1~3년=15, 3~5년=20, 5~10년=15, 10년+=8
  const careerDist: Record<string, number> = {
    '1': 15, '3': 20, '5': 15, '10': 8,
  };
  for (const row of rows) {
    const lbl = (row.label || '').toLowerCase();
    const inputCells = row.cells.filter(c => c.type === 'input');
    let match = 0;
    for (const [k, v] of Object.entries(dist)) {
      if (lbl.includes(k)) { match = v; break; }
    }
    if (match === 0) {
      for (const [k, v] of Object.entries(careerDist)) {
        if (lbl.includes(k + '년') || lbl.includes(k + '~') || lbl.includes(k)) { match = v; break; }
      }
    }
    if (match === 0) match = rand(3, 12);
    for (let i = 0; i < inputCells.length; i++) {
      out[inputCells[i].id] = String(i === 0 ? match : Math.max(1, Math.floor(match / 2)));
    }
  }
  return out;
}

function fillFinanceTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  // 자금 사용: 연구개발 28억, 인건비 30억, 마케팅 5억, 기타 9억 (2024 총비용 72억 ≒ 매출)
  for (const row of rows) {
    const lbl = (row.label || '').toLowerCase();
    const inputCells = row.cells.filter(c => c.type === 'input');
    let y2024 = 500, y2025 = 700;
    if (lbl.includes('연구') || lbl.includes('r&d') || lbl.includes('개발')) { y2024 = 2800; y2025 = 3600; }
    else if (lbl.includes('인건') || lbl.includes('급여')) { y2024 = 3000; y2025 = 3800; }
    else if (lbl.includes('마케팅') || lbl.includes('영업')) { y2024 = 500; y2025 = 800; }
    else if (lbl.includes('기타') || lbl.includes('일반')) { y2024 = 900; y2025 = 1200; }
    else if (lbl.includes('시설') || lbl.includes('설비') || lbl.includes('인프라')) { y2024 = 600; y2025 = 1000; }
    if (inputCells[0]) out[inputCells[0].id] = String(y2024);
    if (inputCells[1]) out[inputCells[1].id] = String(y2025);
  }
  return out;
}

function fillInvestmentDealsTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  // 2024에 Series B 1건 85억 (전체 = AI), 2025 없음
  for (const row of rows) {
    const lbl = (row.label || '').toLowerCase();
    const inputCells = row.cells.filter(c => c.type === 'input');
    const isAi = lbl.includes('인공지능') || lbl.includes('ai');
    if (inputCells.length >= 2) {
      if (isAi) {
        out[inputCells[0].id] = '1'; // 건수
        out[inputCells[1].id] = '8500'; // 백만원 (85억)
      } else {
        out[inputCells[0].id] = '1';
        out[inputCells[1].id] = '8500';
      }
    }
    if (inputCells.length >= 4) {
      // 2025(E) 건수/금액 — 없음
      out[inputCells[2].id] = '0';
      out[inputCells[3].id] = '0';
    }
  }
  return out;
}

function fillPatentsTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  for (const row of rows) {
    const lbl = (row.label || '').toLowerCase();
    const inputCells = row.cells.filter(c => c.type === 'input');
    const isAi = lbl.includes('인공지능') || lbl.includes('ai');
    const isAbroad = lbl.includes('해외') || lbl.includes('국외') || lbl.includes('pct');
    let val = 3;
    if (isAi && isAbroad) val = P.patentAbroad;
    else if (isAi) val = P.patentKorea;
    else if (isAbroad) val = P.patentAbroad + 1;
    else val = P.patentKorea + 2;
    for (const c of inputCells) out[c.id] = String(val);
  }
  return out;
}

function fillInfraRatioTable(q: Question, ratio: { self: number; cloud: number }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  const cols = q.tableColumns || [];

  // 열 라벨에서 self/cloud 열 인덱스 추출 (열 단위 분기)
  let selfColIdx = -1;
  let cloudColIdx = -1;
  cols.forEach((c, i) => {
    const l = (c.label || '').toLowerCase();
    if (selfColIdx < 0 && (l.includes('자사') || l.includes('자체') || l.includes('온프레') || l.includes('직접'))) selfColIdx = i;
    if (cloudColIdx < 0 && (l.includes('클라우드') || l.includes('cloud'))) cloudColIdx = i;
  });

  for (const row of rows) {
    if (row.displayCondition) continue; // row-level cond이 있다면 외부 로직에 맡김
    if (selfColIdx >= 0 || cloudColIdx >= 0) {
      // 열 인덱스 기반: 행의 cells[colIdx] 가 input이면 채움
      if (selfColIdx >= 0 && row.cells[selfColIdx]?.type === 'input') {
        out[row.cells[selfColIdx].id] = String(ratio.self);
      }
      if (cloudColIdx >= 0 && row.cells[cloudColIdx]?.type === 'input') {
        out[row.cells[cloudColIdx].id] = String(ratio.cloud);
      }
    } else {
      // fallback — 행 라벨로 매칭 (예전 동작)
      const lbl = (row.label || '').toLowerCase();
      const inputCells = row.cells.filter(c => c.type === 'input');
      if (inputCells.length === 0) continue;
      let v: number | null = null;
      if (lbl.includes('자사') || lbl.includes('자체') || lbl.includes('온프레') || lbl.includes('직접')) v = ratio.self;
      else if (lbl.includes('클라우드') || lbl.includes('cloud')) v = ratio.cloud;
      if (v === null) continue;
      for (const c of inputCells) out[c.id] = String(v);
    }
  }
  return out;
}

function fillGpuTable(
  q: Question,
  responses: Record<string, unknown>,
  questions: Question[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  const pSeed = profileSeed();
  let rowSeed = 0;
  // 보유: A100 8, H100 2, 기타 0 / 수요(향후): A100 +4, H100 +3
  for (const row of rows) {
    // row-level displayCondition (예: Q7=자사/혼합일 때만 노출되는 행)
    if (row.displayCondition && !evaluateGroup(row.displayCondition, responses, questions)) continue;
    rowSeed++;
    const lbl = (row.label || '').toLowerCase();
    const inputCells = row.cells.filter(c => c.type === 'input');
    let holding = 0, demand = 0;
    if (lbl.includes('a100')) { holding = P.gpu.A100; demand = 4; }
    else if (lbl.includes('h100')) { holding = P.gpu.H100; demand = 3; }
    else if (lbl.includes('v100')) { holding = 0; demand = 0; }
    else if (lbl.includes('b100') || lbl.includes('b200')) { holding = 0; demand = 2; }
    else if (lbl.includes('a6000') || lbl.includes('a40') || lbl.includes('rtx')) { holding = 6; demand = 2; }
    else if (lbl.includes('기타') || lbl.includes('consumer')) { holding = 4; demand = 0; }
    else { holding = rand(0, 2); demand = rand(0, 3); }
    if (inputCells[0]) out[inputCells[0].id] = String(holding);
    if (inputCells[1]) out[inputCells[1].id] = String(demand);
    // radio/select 셀 처리 — 첫옵션 편향 제거
    let cellSeed = 0;
    for (const c of row.cells) {
      if (c.type === 'radio' && c.radioOptions?.length) {
        cellSeed++;
        const idx = (pSeed + rowSeed * 7 + cellSeed) % c.radioOptions.length;
        out[c.id] = c.radioOptions[idx].value;
      } else if (c.type === 'select' && c.selectOptions?.length) {
        cellSeed++;
        const idx = (pSeed + rowSeed * 11 + cellSeed * 3) % c.selectOptions.length;
        out[c.id] = c.selectOptions[idx].value;
      }
    }
  }
  return out;
}

/**
 * Q19 수출 계획 테이블 — 응답자 수출 상태에 따라 정확히 1행만 체크.
 * Q20(수출 불가 이유) 노출 조건은 Q19의 2·4행(중단/향후 없음) 중 하나 체크.
 *
 * 수출 중(hasExport=true)  → "지속 수출" 행 (1행) → Q20 스킵
 * 수출 없음+계획 있음(50%) → "향후 수출 계획(준비) 중" 행 (3행) → Q20 스킵
 * 수출 없음+계획 없음(50%) → "향후에도 수출하지 않을 계획" 행 (4행) → Q20 노출
 */
function fillExportPlanTable(
  q: Question,
  responses: Record<string, unknown>,
  questions: Question[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  type RowKind = 'continue' | 'stop' | 'plan' | 'no_plan' | 'other';
  const classify = (lbl: string): RowKind => {
    const l = lbl.toLowerCase();
    if (l.includes('지속')) return 'continue';
    if (l.includes('중단')) return 'stop';
    if (l.includes('준비') || (l.includes('계획') && l.includes('중'))) return 'plan';
    if (l.includes('하지 않')) return 'no_plan';
    return 'other';
  };

  let targetKind: RowKind;
  if (P.hasExport) {
    targetKind = 'continue';
  } else {
    targetKind = ((P.employees + P.foundedYear) % 2 === 0) ? 'plan' : 'no_plan';
  }

  // row-level displayCondition 평가: 선택된 행이 숨김 대상이면 응답하지 않음(ghost 방지)
  const visibleRows = rows.filter(r =>
    !r.displayCondition || evaluateGroup(r.displayCondition, responses, questions),
  );
  const target = visibleRows.find(r => classify(r.label || '') === targetKind);
  if (!target) return out;

  const pSeed = profileSeed();
  let cellSeed = 0;
  for (const cell of target.cells) {
    if (cell.type === 'text' || cell.type === 'image' || cell.type === 'video') continue;
    cellSeed++;
    if (cell.type === 'radio' && cell.radioOptions?.length) {
      const idx = (pSeed + cellSeed * 7) % cell.radioOptions.length;
      out[cell.id] = cell.radioOptions[idx].value;
    } else if (cell.type === 'select' && cell.selectOptions?.length) {
      const idx = (pSeed + cellSeed * 11) % cell.selectOptions.length;
      out[cell.id] = cell.selectOptions[idx].value;
    } else if (cell.type === 'checkbox' && cell.checkboxOptions?.length) {
      const shuffled = deterministicShuffle(cell.checkboxOptions, pSeed + cellSeed * 13);
      const count = 1 + (pSeed % Math.min(2, shuffled.length));
      out[cell.id] = shuffled.slice(0, count).map(o => o.value);
    } else if (cell.type === 'input') {
      out[cell.id] = String(rand(5, 25));
    }
  }
  return out;
}

function fillPublicDataPortionTable(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = q.tableRowsData || [];
  for (const row of rows) {
    const inputCells = row.cells.filter(c => c.type === 'input');
    for (const c of inputCells) out[c.id] = String(rand(10, 30)); // 공공데이터 10~30%
    // radio/select — 행 라벨에 따라 '낮음/보통' 선택
    for (const c of row.cells) {
      if (c.type === 'radio' && c.radioOptions?.length) {
        // 중간 옵션 선택
        const midIdx = Math.min(Math.floor(c.radioOptions.length / 2), c.radioOptions.length - 1);
        out[c.id] = c.radioOptions[midIdx].value;
      } else if (c.type === 'select' && c.selectOptions?.length) {
        out[c.id] = c.selectOptions[Math.floor(c.selectOptions.length / 2)].value;
      }
    }
  }
  return out;
}

// ========================================
// 메인 값 생성 디스패처
// ========================================
function generateValue(q: Question, responses: Record<string, unknown>, questions: Question[]): unknown {
  // 시나리오 맵 우선
  const scen = SCENARIOS[q.id];
  if (scen) return scen(q, responses, questions);

  // 타입별 기본값
  switch (q.type) {
    case 'notice':
      return null; // requires_acknowledgment=false → 저장 안 함
    case 'text':
      return '';
    case 'textarea':
      return '';
    case 'radio':
    case 'select': {
      // Case A: 테이블형 라디오(choice_opt) → 응답은 단일 cell.id
      const choiceIds = collectChoiceCellIds(q);
      if (choiceIds.length > 0) {
        return choiceIds[(profileSeed() + domainSeed()) % choiceIds.length];
      }
      const opts = nonOtherOptions(q);
      return opts[0]?.value ?? null;
    }
    case 'checkbox':
    case 'multiselect': {
      // Case A: 테이블형 체크박스(choice_opt) → 응답은 선택된 cell.id 배열
      const choiceIds = collectChoiceCellIds(q);
      if (choiceIds.length > 0) {
        const shuffled = deterministicShuffle(choiceIds, profileSeed() + domainSeed() + 7);
        const count = Math.min(choiceIds.length, 1 + (profileSeed() % Math.min(4, choiceIds.length)));
        return shuffled.slice(0, count);
      }
      return pickOptionValues(q, 2);
    }
    case 'ranking':
      // Case 1(manual)/Case 2(table) 모두 pickRanking 이 식별자 처리
      return pickRanking(q, profileSeed() + domainSeed() + 17);
    case 'table':
      return fillTableDefault(q, responses, questions);
    default:
      return null;
  }
}

// ========================================
// 루프: 분기 평가 + 응답 생성
// ========================================
interface RunResult {
  responses: Record<string, unknown>;
  exposedIds: string[];
}

function runSurvey(questions: Question[], groups: QGroup[]): RunResult {
  const responses: Record<string, unknown> = {};
  const exposedIds: string[] = [];
  const total = questions.length;
  let idx = 0;
  let guard = 0;
  const maxGuard = total * 3;

  while (idx >= 0 && idx < total && guard < maxGuard) {
    guard++;
    const q = questions[idx];

    if (!shouldDisplayQuestion(q, responses, questions, groups)) {
      idx++;
      continue;
    }

    const value = generateValue(q, responses, questions);

    if (value !== null && value !== undefined && q.type !== 'notice') {
      responses[q.id] = value;
      exposedIds.push(q.id);
    }

    // 분기 규칙
    const branch = getBranchRule(q, value);
    if (branch) {
      if (branch.action === 'end') {
        console.log(`  [END] ${q.title.substring(0, 40)}`);
        break;
      }
      if (branch.action === 'goto' && branch.targetQuestionId) {
        const targetIdx = questions.findIndex(qq => qq.id === branch.targetQuestionId);
        if (targetIdx !== -1) {
          idx = targetIdx;
          continue;
        }
      }
    }
    idx++;
  }

  return { responses, exposedIds };
}

// ========================================
// 기타/주관식(__optTexts__) 후처리
// ========================================
/** 질문 맥락에 맞는 기타 상세 텍스트 선택 */
function pickOtherText(q: Question, seed: number): string {
  const t = q.title || '';
  let pool: string[];
  if (/수출\s*지역|희망\s*수출/.test(t)) pool = ['중동 지역', '동남아시아', '중남미', '아프리카'];
  else if (/수출.*않|수출.*계획.*없/.test(t)) pool = ['내수 시장 우선 집중', '수출 인력·예산 부족', '현지 인증 대응 어려움'];
  else if (/데이터/.test(t)) pool = ['자체 수집·생성 데이터', '제휴 기관 제공 데이터', '크롤링 기반 자체 구축'];
  else if (/오픈소스/.test(t)) pool = ['자체 파인튜닝 모델', '상용 폐쇄형 모델 병행', '사내 자체 구축 모델'];
  else if (/제품|서비스|도구|개발/.test(t)) pool = ['자체 개발 프레임워크', '상용 MLOps 플랫폼', '클라우드 매니지드 서비스'];
  else if (/가이드라인|프레임워크/.test(t)) pool = ['도입 검토 중', '내부 정책 수립 예정'];
  else pool = ['기타 내부 검토 사항', '자체 방식으로 대응'];
  return pool[Math.abs(seed) % pool.length];
}

/**
 * 응답의 기타(allowTextInput/hasOther) 옵션에 __optTexts__ 사이드카 텍스트를 채운다.
 * - checkbox/multiselect: 기타 미선택이면 결정적 ~30% 확률로 추가
 * - radio/select: 이미 기타가 선택된 경우만 정규화(분기 영향 회피) + 레거시 otherValue 흡수
 * 반환: { [questionId]: { [optionId]: text } } (앱 __optTexts__ 형식, 키는 option.id)
 * ranking 은 RankingAnswer.optionText 로 별도 처리되므로 여기서 제외.
 */
function applyOtherInputs(
  responses: Record<string, unknown>,
  questions: Question[],
): Record<string, Record<string, string>> {
  const optTexts: Record<string, Record<string, string>> = {};
  for (const q of questions) {
    if (!(q.id in responses)) continue;
    const otherOpts = (q.options || []).filter(o => o.allowTextInput || o.hasOther);
    if (otherOpts.length === 0) continue;
    const seed = profileSeed() + q.order;

    if (q.type === 'checkbox' || q.type === 'multiselect') {
      const arr = Array.isArray(responses[q.id])
        ? (responses[q.id] as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      let chosen = otherOpts.find(o => arr.includes(o.value));
      if (!chosen && seed % 10 < 3) {
        chosen = otherOpts[seed % otherOpts.length];
        arr.push(chosen.value);
        responses[q.id] = arr;
      }
      if (chosen) optTexts[q.id] = { [chosen.id]: pickOtherText(q, seed) };
    } else if (q.type === 'radio' || q.type === 'select') {
      const val = responses[q.id];
      let selVal: string | null = null;
      let legacyText: string | null = null;
      if (typeof val === 'string') {
        selVal = val;
      } else if (val && typeof val === 'object') {
        const o = val as { selectedValue?: string; otherValue?: string };
        selVal = o.selectedValue ?? null;
        legacyText = o.otherValue ?? null;
      }
      const chosen = otherOpts.find(o => o.value === selVal);
      if (chosen) {
        // 신규 형식으로 정규화: 응답값 = 옵션 value, 텍스트는 __optTexts__
        responses[q.id] = chosen.value;
        optTexts[q.id] = { [chosen.id]: legacyText || pickOtherText(q, seed) };
      }
    }
  }
  return optTexts;
}

// ========================================
// 디바이스/페이지 visit 헬퍼 (운영 콘솔 응답시간 통계용)
// ========================================
function derivePlatform(ua: string): 'desktop' | 'mobile' | 'tablet' {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/iPhone|Android.*Mobile|Mobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

interface PageVisit {
  stepId: string;
  enteredAt: string;
  leftAt: string;
}

/**
 * 노출된 질문들을 페이지(stepId) 단위로 묶고 totalMs를 가중치 분배.
 * stepId 규칙(page-dwell.server.ts와 일치):
 *  - table 질문: 'table:' + questionId
 *  - 그 외: 'group:' + rootGroupId('root' fallback)
 */
function buildPageVisits(
  exposedIds: string[],
  questions: Question[],
  groups: QGroup[],
  startedAt: Date,
  completedAt: Date,
  noiseSeed: number,
): PageVisit[] {
  const totalMs = completedAt.getTime() - startedAt.getTime();
  if (totalMs <= 0 || exposedIds.length === 0) return [];

  const groupMap = new Map(groups.map(g => [g.id, g]));
  const rootOf = (gid?: string): string => {
    if (!gid) return 'root';
    let cur = groupMap.get(gid);
    while (cur?.parentGroupId) cur = groupMap.get(cur.parentGroupId);
    return cur?.id ?? 'root';
  };
  const qMap = new Map(questions.map(q => [q.id, q]));

  // 페이지 순서 + 페이지별 질문 수 누적
  const pageOrder: string[] = [];
  const pageQCount: Record<string, number> = {};
  for (const qid of exposedIds) {
    const q = qMap.get(qid);
    if (!q) continue;
    const stepId = q.type === 'table' ? `table:${qid}` : `group:${rootOf(q.groupId)}`;
    if (!(stepId in pageQCount)) {
      pageOrder.push(stepId);
      pageQCount[stepId] = 0;
    }
    pageQCount[stepId]++;
  }
  if (pageOrder.length === 0) return [];

  // 가중치: 질문 수 + 결정적 노이즈(0.5~1.5배)
  const rng = seededRand(noiseSeed);
  const weights = pageOrder.map(s => pageQCount[s] * (0.7 + rng() * 0.8));
  const sumW = weights.reduce((a, b) => a + b, 0);

  const visits: PageVisit[] = [];
  let cursorMs = startedAt.getTime();
  pageOrder.forEach((stepId, i) => {
    const ms = Math.round((totalMs * weights[i]) / sumW);
    const enteredAt = new Date(cursorMs).toISOString();
    cursorMs = i === pageOrder.length - 1 ? completedAt.getTime() : cursorMs + ms;
    const leftAt = new Date(cursorMs).toISOString();
    visits.push({ stepId, enteredAt, leftAt });
  });
  return visits;
}

// ========================================
// User Agents (다양성)
// ========================================
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/135.0.0.0',
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

// ========================================
// 상태 분포 (완료/진행중/일탈)
// ========================================
type ResponseStatus = 'completed' | 'in_progress' | 'drop';
const STATUS_DIST: Record<ResponseStatus, number> = {
  completed: 80,
  in_progress: 15,
  drop: 25,
};
const TOTAL = STATUS_DIST.completed + STATUS_DIST.in_progress + STATUS_DIST.drop; // 120

/**
 * 상태 시퀀스 생성 후 결정적 셔플 — 일자/플랫폼과 status 가 골고루 섞이도록.
 * (Math.random 미사용: 재현성 유지)
 */
function buildStatusSequence(): ResponseStatus[] {
  const seq: ResponseStatus[] = [
    ...Array<ResponseStatus>(STATUS_DIST.completed).fill('completed'),
    ...Array<ResponseStatus>(STATUS_DIST.in_progress).fill('in_progress'),
    ...Array<ResponseStatus>(STATUS_DIST.drop).fill('drop'),
  ];
  // Fisher-Yates with fixed seed
  let s = 987654321;
  for (let i = seq.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = s % (i + 1);
    [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  return seq;
}

/**
 * 부분 응답(progress) 진행률: 노출된 마지막 질문의 snapshot position 기준.
 * completed=100, 그 외 1~99 로 clamp. position 0(미응답)이면 null.
 */
function calcProgressPct(
  exposedIds: string[],
  positionMap: Map<string, number>,
  totalQuestions: number,
): number | null {
  if (exposedIds.length === 0 || totalQuestions === 0) return null;
  const lastId = exposedIds[exposedIds.length - 1];
  const pos = positionMap.get(lastId) ?? 0;
  if (pos === 0) return null;
  const pct = Math.round((pos / totalQuestions) * 100);
  return Math.max(1, Math.min(99, pct));
}

async function main() {
  console.log(`=== 2025 AI 산업 실태조사 가상 응답 ${TOTAL}건 생성 ===\n`);

  console.log('📥 질문/그룹 로드...');
  const { data: rawQuestions, error: qErr } = await supabase
    .from('questions')
    .select('*')
    .eq('survey_id', SURVEY_ID)
    .order('order', { ascending: true });
  if (qErr) throw qErr;

  const { data: rawGroups, error: gErr } = await supabase
    .from('question_groups')
    .select('*')
    .eq('survey_id', SURVEY_ID);
  if (gErr) throw gErr;

  const groups = (rawGroups || []).map(g => mapGroup(g as Record<string, unknown>));
  const groupOrderMap = new Map(groups.map(g => [g.id, g.order]));
  const questionsRaw = (rawQuestions || []).map(q => mapQuestion(q as Record<string, unknown>));
  const questions = [...questionsRaw].sort((a, b) => {
    const ga = a.groupId ? groupOrderMap.get(a.groupId) ?? 999 : 999;
    const gb = b.groupId ? groupOrderMap.get(b.groupId) ?? 999 : 999;
    if (ga !== gb) return ga - gb;
    return a.order - b.order;
  });
  console.log(`✔ 질문 ${questions.length}개, 그룹 ${groups.length}개\n`);

  // 기존 응답 전체 삭제 (깨끗한 상태에서 50건 시드)
  console.log('🧹 기존 응답 전체 삭제...');
  const { error: delErr } = await supabase
    .from('survey_responses')
    .delete()
    .eq('survey_id', SURVEY_ID);
  if (delErr) {
    console.error('삭제 실패:', delErr.message);
    throw delErr;
  }
  console.log('✔ 삭제 완료\n');

  const meta = questions.map(q => ({ id: q.id, type: q.type }));

  // 타임스탬프: 지난 30일 내 분산
  const nowMs = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // 분포 집계
  const stats = {
    export_yes: 0, export_no: 0,
    invest_yes: 0, invest_no: 0,
    guide_yes: 0, guide_no: 0,
    train_yes: 0, train_no: 0,
    std_yes: 0, std_no: 0,
    npu: { '옵션1': 0, '옵션2': 0, '옵션3': 0, '옵션4': 0 } as Record<string, number>,
    infra: { '옵션1': 0, '옵션2': 0, '옵션3': 0 } as Record<string, number>,
    q20_shown: 0,
    exposed_total: 0,
  };

  const responsePayloads: Record<string, unknown>[] = [];
  const answerPayloads: Record<string, unknown>[] = [];

  // snapshot position map (progress_pct 계산용, 1-based)
  const positionMap = new Map(questions.map((q, idx) => [q.id, idx + 1]));

  // 상태 시퀀스(셔플) + 응답시간 이상치 대상 선정
  const statusSeq = buildStatusSequence();
  const completedIdx = statusSeq
    .map((s, i) => (s === 'completed' ? i : -1))
    .filter((i) => i >= 0);
  // 이상치 3건: 매우 김(150분=9000s), 김(75분=4500s), 매우 짧음(40초)
  const outlierMap = new Map<number, number>();
  if (completedIdx[0] !== undefined) outlierMap.set(completedIdx[0], 9000);
  if (completedIdx[1] !== undefined) outlierMap.set(completedIdx[1], 4500);
  if (completedIdx[2] !== undefined) outlierMap.set(completedIdx[2], 40);

  const statusCount: Record<ResponseStatus, number> = { completed: 0, in_progress: 0, drop: 0 };

  console.log(
    `🔁 ${TOTAL}건 시뮬레이션 (완료 ${STATUS_DIST.completed}/진행중 ${STATUS_DIST.in_progress}/일탈 ${STATUS_DIST.drop})...`,
  );
  for (let i = 0; i < TOTAL; i++) {
    P = generateProfile(i);
    const status = statusSeq[i];
    statusCount[status]++;

    const full = runSurvey(questions, groups);
    let exposedIds = full.exposedIds;
    let responses: Record<string, unknown> = full.responses;

    // 부분 응답: 진행중 20~60%, 일탈 10~90% 지점까지만 남김 → 이탈/진행 위치 다양화
    let cutRatio = 1;
    if (status === 'in_progress') cutRatio = 0.2 + Math.random() * 0.4;
    else if (status === 'drop') cutRatio = 0.1 + Math.random() * 0.8;
    if (cutRatio < 1 && exposedIds.length > 0) {
      const keep = Math.max(1, Math.round(exposedIds.length * cutRatio));
      exposedIds = exposedIds.slice(0, keep);
      const keepSet = new Set(exposedIds);
      responses = Object.fromEntries(
        Object.entries(full.responses).filter(([k]) => keepSet.has(k)),
      );
    }

    // 타임스탬프: 최근 30일 내 랜덤, 업무시간대(9~19시) 편향
    const daysAgo = Math.floor(Math.random() * 30);
    const hour = 9 + Math.floor(Math.random() * 10);
    const minute = Math.floor(Math.random() * 60);
    const anchorMs = nowMs - daysAgo * DAY;
    const anchorAt = new Date(anchorMs);
    anchorAt.setHours(hour, minute, Math.floor(Math.random() * 60), 0);
    // 완료 총 소요(22~50분). 부분 응답은 cutRatio 만큼만 소요.
    const fullElapsedMin = 22 + Math.floor(Math.random() * 28);
    const elapsedMin =
      status === 'completed' ? fullElapsedMin : Math.max(1, Math.round(fullElapsedMin * cutRatio));
    const startedAt = new Date(anchorAt.getTime() - elapsedMin * 60 * 1000);

    const responseId = crypto.randomUUID();
    const sessionId = `session-ai-${String(i + 1).padStart(3, '0')}-${anchorAt.getTime()}`;
    const userAgent = USER_AGENTS[i % USER_AGENTS.length];
    const platform = derivePlatform(userAgent);

    // 상태별 종결 필드
    const isCompleted = status === 'completed';
    const completedAt = isCompleted ? anchorAt : null;
    const lastActivityAt = anchorAt; // 완료=완료시각, 부분=마지막 활동시각
    let totalSeconds: number | null = isCompleted
      ? Math.round((anchorAt.getTime() - startedAt.getTime()) / 1000)
      : null; // 진행중/일탈은 응답시간 미집계(현황 통계 정책과 일치)
    if (isCompleted && outlierMap.has(i)) {
      totalSeconds = outlierMap.get(i)!; // 절사평균 검증용 이상치
    }

    // page_visits: 노출 구간만 — 부분 응답은 마지막 stepId 가 이탈 위치
    const pageVisits = buildPageVisits(
      exposedIds, questions, groups, startedAt, lastActivityAt, i * 211 + 17,
    );
    const currentStepId = pageVisits.length > 0 ? pageVisits[pageVisits.length - 1].stepId : null;
    const progressPct = isCompleted
      ? 100
      : calcProgressPct(exposedIds, positionMap, questions.length);

    // 기타/주관식 입력 사이드카(__optTexts__). responses 에 기타 옵션도 in-place 반영됨.
    const optTexts = applyOtherInputs(responses, questions);
    const qResponses =
      Object.keys(optTexts).length > 0 ? { ...responses, __optTexts__: optTexts } : responses;

    responsePayloads.push({
      id: responseId,
      survey_id: SURVEY_ID,
      question_responses: qResponses,
      is_completed: isCompleted,
      status, // 운영 콘솔 상태 분류 (completed/in_progress/drop)
      started_at: startedAt.toISOString(),
      completed_at: completedAt ? completedAt.toISOString() : null,
      last_activity_at: lastActivityAt.toISOString(),
      session_id: sessionId,
      version_id: VERSION_ID,
      metadata: { exposedQuestionIds: exposedIds },
      user_agent: userAgent,
      platform,
      current_step_id: currentStepId,
      progress_pct: progressPct,
      total_seconds: totalSeconds,
      page_visits: pageVisits,
    });

    const normalized = normalizeToAnswers(responseId, responses, meta);
    for (const a of normalized) {
      answerPayloads.push({
        response_id: a.responseId,
        question_id: a.questionId,
        text_value: a.textValue,
        array_value: a.arrayValue,
        object_value: a.objectValue,
        question_type: a.questionType,
      });
    }

    // 통계 누적 (프로필 기준 — 부분 응답 포함 전체 분포 확인용)
    stats.exposed_total += exposedIds.length;
    if (P.hasExport) stats.export_yes++; else stats.export_no++;
    if (P.hasInvestment) stats.invest_yes++; else stats.invest_no++;
    if (P.hasGuideline) stats.guide_yes++; else stats.guide_no++;
    if (P.hasTraining) stats.train_yes++; else stats.train_no++;
    if (P.hasIntlStandard) stats.std_yes++; else stats.std_no++;
    stats.npu[P.npuChoice]++;
    stats.infra[P.infraChoice]++;
    if (exposedIds.includes(QID.Q20)) stats.q20_shown++;

    if ((i + 1) % 20 === 0) {
      console.log(`  ${i + 1}/${TOTAL} 생성됨`);
    }
  }

  console.log('\n💾 survey_responses 배치 INSERT...');
  // 25건씩 청크로 (안전)
  const CHUNK = 25;
  const insertedIds: string[] = [];
  for (let k = 0; k < responsePayloads.length; k += CHUNK) {
    const chunk = responsePayloads.slice(k, k + CHUNK);
    const { data, error: insErr } = await supabase.from('survey_responses').insert(chunk).select('id');
    if (insErr) {
      console.error(`❌ chunk ${k}-${k + chunk.length} 실패:`, insErr.message);
      if (insertedIds.length > 0) {
        console.log('🔙 롤백 시도...');
        await supabase.from('survey_responses').delete().in('id', insertedIds);
      }
      throw insErr;
    }
    for (const r of (data || [])) insertedIds.push(r.id as string);
  }
  console.log(`✔ survey_responses ${insertedIds.length}건 저장`);

  console.log('💾 response_answers 배치 INSERT...');
  const ANS_CHUNK = 500;
  for (let k = 0; k < answerPayloads.length; k += ANS_CHUNK) {
    const chunk = answerPayloads.slice(k, k + ANS_CHUNK);
    const { error: ansErr } = await supabase.from('response_answers').insert(chunk);
    if (ansErr) {
      console.error(`❌ answers chunk ${k}-${k + chunk.length} 실패:`, ansErr.message);
      console.log('🔙 survey_responses 롤백...');
      await supabase.from('survey_responses').delete().in('id', insertedIds);
      throw ansErr;
    }
  }
  console.log(`✔ response_answers ${answerPayloads.length}건 저장\n`);

  console.log('📊 분포 통계');
  console.log(`  상태    : 완료 ${statusCount.completed} / 진행중 ${statusCount.in_progress} / 일탈 ${statusCount.drop}`);
  console.log(`  수출    : O ${stats.export_yes} / X ${stats.export_no}`);
  console.log(`  투자유치: O ${stats.invest_yes} / X ${stats.invest_no}`);
  console.log(`  가이드라인: O ${stats.guide_yes} / X ${stats.guide_no}`);
  console.log(`  교육    : O ${stats.train_yes} / X ${stats.train_no}`);
  console.log(`  국제표준: O ${stats.std_yes} / X ${stats.std_no}`);
  console.log(`  NPU     : 이미도입 ${stats.npu['옵션1']} / 계획 ${stats.npu['옵션2']} / 의향 ${stats.npu['옵션3']} / 없음 ${stats.npu['옵션4']}`);
  console.log(`  인프라  : 자사 ${stats.infra['옵션1']} / 혼합 ${stats.infra['옵션2']} / 클라우드 ${stats.infra['옵션3']}`);
  console.log(`  Q20 노출: ${stats.q20_shown}건 (수출없음+계획없음)`);
  console.log(`  평균 노출 질문: ${Math.round(stats.exposed_total / TOTAL)}건/응답`);
  console.log('\n✅ 완료!');
}

main().catch(e => {
  console.error('\n💥 스크립트 실패:', e);
  process.exit(1);
});
