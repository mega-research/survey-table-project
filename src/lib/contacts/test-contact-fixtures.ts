export interface TestContactFixture {
  name: string;
  company: string;
  phone: string;
}

/** 운영 데이터와 혼동할 수 없도록 이름·회사·전화가 모두 합성임을 드러낸다. */
export const TEST_CONTACT_FIXTURES: readonly TestContactFixture[] = Array.from(
  { length: 20 },
  (_, index) => {
    const no = String(index + 1).padStart(2, '0');
    return {
      name: `테스트 담당자 ${no}`,
      company: `테스트기업 ${no}`,
      phone: `000-0000-${String(index + 1).padStart(4, '0')}`,
    };
  },
);
