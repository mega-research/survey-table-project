export interface RegionData {
  id: string;
  name: string;
  parentId?: string;
  level: number;
}

export const REGION_DATA: RegionData[] = [
  // 시/도 (level 1)
  { id: 'seoul', name: '서울특별시', level: 1 },
  { id: 'busan', name: '부산광역시', level: 1 },
  { id: 'daegu', name: '대구광역시', level: 1 },
  { id: 'incheon', name: '인천광역시', level: 1 },
  { id: 'gwangju', name: '광주광역시', level: 1 },
  { id: 'daejeon', name: '대전광역시', level: 1 },
  { id: 'ulsan', name: '울산광역시', level: 1 },
  { id: 'sejong', name: '세종특별자치시', level: 1 },
  { id: 'gyeonggi', name: '경기도', level: 1 },
  { id: 'gangwon', name: '강원특별자치도', level: 1 },
  { id: 'chungbuk', name: '충청북도', level: 1 },
  { id: 'chungnam', name: '충청남도', level: 1 },
  { id: 'jeonbuk', name: '전북특별자치도', level: 1 },
  { id: 'jeonnam', name: '전라남도', level: 1 },
  { id: 'gyeongbuk', name: '경상북도', level: 1 },
  { id: 'gyeongnam', name: '경상남도', level: 1 },
  { id: 'jeju', name: '제주특별자치도', level: 1 },

  // 서울특별시 구 (level 2)
  { id: 'seoul-gangnam', name: '강남구', parentId: 'seoul', level: 2 },
  { id: 'seoul-gangdong', name: '강동구', parentId: 'seoul', level: 2 },
  { id: 'seoul-gangbuk', name: '강북구', parentId: 'seoul', level: 2 },
  { id: 'seoul-gangseo', name: '강서구', parentId: 'seoul', level: 2 },
  { id: 'seoul-gwanak', name: '관악구', parentId: 'seoul', level: 2 },
  { id: 'seoul-gwangjin', name: '광진구', parentId: 'seoul', level: 2 },
  { id: 'seoul-guro', name: '구로구', parentId: 'seoul', level: 2 },
  { id: 'seoul-geumcheon', name: '금천구', parentId: 'seoul', level: 2 },
  { id: 'seoul-nowon', name: '노원구', parentId: 'seoul', level: 2 },
  { id: 'seoul-dobong', name: '도봉구', parentId: 'seoul', level: 2 },
  { id: 'seoul-dongdaemun', name: '동대문구', parentId: 'seoul', level: 2 },
  { id: 'seoul-dongjak', name: '동작구', parentId: 'seoul', level: 2 },
  { id: 'seoul-mapo', name: '마포구', parentId: 'seoul', level: 2 },
  { id: 'seoul-seodaemun', name: '서대문구', parentId: 'seoul', level: 2 },
  { id: 'seoul-seocho', name: '서초구', parentId: 'seoul', level: 2 },
  { id: 'seoul-seongdong', name: '성동구', parentId: 'seoul', level: 2 },
  { id: 'seoul-seongbuk', name: '성북구', parentId: 'seoul', level: 2 },
  { id: 'seoul-songpa', name: '송파구', parentId: 'seoul', level: 2 },
  { id: 'seoul-yangcheon', name: '양천구', parentId: 'seoul', level: 2 },
  { id: 'seoul-yeongdeungpo', name: '영등포구', parentId: 'seoul', level: 2 },
  { id: 'seoul-yongsan', name: '용산구', parentId: 'seoul', level: 2 },
  { id: 'seoul-eunpyeong', name: '은평구', parentId: 'seoul', level: 2 },
  { id: 'seoul-jongno', name: '종로구', parentId: 'seoul', level: 2 },
  { id: 'seoul-jung', name: '중구', parentId: 'seoul', level: 2 },
  { id: 'seoul-jungnang', name: '중랑구', parentId: 'seoul', level: 2 },

  // 부산광역시 구/군 (level 2)
  { id: 'busan-haeundae', name: '해운대구', parentId: 'busan', level: 2 },
  { id: 'busan-suyeong', name: '수영구', parentId: 'busan', level: 2 },
  { id: 'busan-nam', name: '남구', parentId: 'busan', level: 2 },
  { id: 'busan-dong', name: '동구', parentId: 'busan', level: 2 },
  { id: 'busan-jung', name: '중구', parentId: 'busan', level: 2 },
  { id: 'busan-seo', name: '서구', parentId: 'busan', level: 2 },
  { id: 'busan-busanjin', name: '부산진구', parentId: 'busan', level: 2 },
  { id: 'busan-dongnae', name: '동래구', parentId: 'busan', level: 2 },
  { id: 'busan-yeonje', name: '연제구', parentId: 'busan', level: 2 },
  { id: 'busan-saha', name: '사하구', parentId: 'busan', level: 2 },
  { id: 'busan-geumjeong', name: '금정구', parentId: 'busan', level: 2 },
  { id: 'busan-gangseo', name: '강서구', parentId: 'busan', level: 2 },
  { id: 'busan-sasang', name: '사상구', parentId: 'busan', level: 2 },
  { id: 'busan-buk', name: '북구', parentId: 'busan', level: 2 },
  { id: 'busan-gijang', name: '기장군', parentId: 'busan', level: 2 },

  // 경기도 시/군 (level 2) - 주요 도시들
  { id: 'gyeonggi-suwon', name: '수원시', parentId: 'gyeonggi', level: 2 },
  { id: 'gyeonggi-seongnam', name: '성남시', parentId: 'gyeonggi', level: 2 },
  { id: 'gyeonggi-goyang', name: '고양시', parentId: 'gyeonggi', level: 2 },
  { id: 'gyeonggi-yongin', name: '용인시', parentId: 'gyeonggi', level: 2 },
  { id: 'gyeonggi-bucheon', name: '부천시', parentId: 'gyeonggi', level: 2 },
  { id: 'gyeonggi-ansan', name: '안산시', parentId: 'gyeonggi', level: 2 },
  { id: 'gyeonggi-anyang', name: '안양시', parentId: 'gyeonggi', level: 2 },
  { id: 'gyeonggi-namyangju', name: '남양주시', parentId: 'gyeonggi', level: 2 },
  { id: 'gyeonggi-hwaseong', name: '화성시', parentId: 'gyeonggi', level: 2 },
  { id: 'gyeonggi-pyeongtaek', name: '평택시', parentId: 'gyeonggi', level: 2 },

  // 강남구 동 (level 3) - 예시
  { id: 'seoul-gangnam-apgujeong', name: '압구정동', parentId: 'seoul-gangnam', level: 3 },
  { id: 'seoul-gangnam-cheongdam', name: '청담동', parentId: 'seoul-gangnam', level: 3 },
  { id: 'seoul-gangnam-daechi', name: '대치동', parentId: 'seoul-gangnam', level: 3 },
  { id: 'seoul-gangnam-dogok', name: '도곡동', parentId: 'seoul-gangnam', level: 3 },
  { id: 'seoul-gangnam-nonhyeon', name: '논현동', parentId: 'seoul-gangnam', level: 3 },
  { id: 'seoul-gangnam-samseong', name: '삼성동', parentId: 'seoul-gangnam', level: 3 },
  { id: 'seoul-gangnam-sinsa', name: '신사동', parentId: 'seoul-gangnam', level: 3 },
  { id: 'seoul-gangnam-yeoksam', name: '역삼동', parentId: 'seoul-gangnam', level: 3 },

  // 서초구 동 (level 3) - 예시
  { id: 'seoul-seocho-banpo', name: '반포동', parentId: 'seoul-seocho', level: 3 },
  { id: 'seoul-seocho-jamwon', name: '잠원동', parentId: 'seoul-seocho', level: 3 },
  { id: 'seoul-seocho-seocho', name: '서초동', parentId: 'seoul-seocho', level: 3 },
  { id: 'seoul-seocho-yangjae', name: '양재동', parentId: 'seoul-seocho', level: 3 },
  { id: 'seoul-seocho-naegok', name: '내곡동', parentId: 'seoul-seocho', level: 3 },
];

export function getRegionsByParent(parentId?: string): RegionData[] {
  if (!parentId) {
    return REGION_DATA.filter((region) => region.level === 1);
  }
  return REGION_DATA.filter((region) => region.parentId === parentId);
}
