# 데이터 구조

[문서 목록](README.md) · [거래 상태와 복구 규칙](transaction-lifecycle.md)

기준 파일은 [data/catalog.json](../data/catalog.json)입니다. 최상위에는 `site`, `artists`, `artworks`가 있습니다. 브라우저의 관리자 화면이 이 파일을 읽고 수정합니다.

## 사이트·작가

| 구분 | 주요 필드 |
|---|---|
| `site` | 이름 `name`, 소개 `tagline`, 공개 주소 `siteUrl`, 문의 주소·문구 `inquiryUrl`·`inquiryLabel`, 인스타그램 `instagramUrl`, 안내 `notice` |
| `artists[]` | 식별자 `id`, 이름 `name`·`nameEn`, 소속 `affiliation`, 사진 `photo`, 소개 `bio`, 인스타그램 `instagram`, 활동 이력 `history` |

`siteUrl`은 NFC·QR 주소 생성에 사용됩니다. `artworks[].artistId`는 작가의 `id`를 참조합니다.

## 작품 정보

| 필드 | 용도 |
|---|---|
| `id` | 주소에 쓰이는 작품번호. NFC 배포 후 유지 |
| `published`, `sample` | 공개 표시 여부, 예시 데이터 안내 여부 |
| `title`, `titleEn`, `artistId` | 작품명과 작가 연결 |
| `year`, `medium`, `size`, `edition` | 제작연도·재료·크기·원작 구분 |
| `images[]` | 이미지 경로 `src`와 설명 `caption` |
| `quote`, `story`, `origin`, `process`, `video` | 작품 이야기·제작 과정·영상 |
| `status`, `price`, `framed` | 거래 상태·가격·액자 포함 여부 |
| `delivery`, `viewingPlace` | 전달 방법 안내·실물 관람 장소 |
| `verification` | 작가 승인 `artistApproved`, 승인일 `approvedAt` |
| `exhibitions[]` | 전시 장소 `place`, 기간 `from`·`to` |
| `care` | 작품 보관·관리 안내 |

## 소장·전달·처리 기록

| 필드 | 형식·역할 |
|---|---|
| `soldAt` | `YYYY-MM` 또는 빈 문자열. 화면의 최초 소장 시점 |
| `showSoldPrice` | 판매 후 가격 공개 여부 |
| `provenance[]` | 소장자 공개 표기 `label`, 소장 기간 `from`·`to` |
| `deliveredAt` | `YYYY-MM-DD` 또는 빈 문자열. 전달 완료일 |
| `saleSnapshot` | 판매 전 `provenance`, `soldAt`, `showSoldPrice`의 복구용 사본. 취소 후 `null` |
| `operations[]` | 예약·판매·취소·전달 처리 기록 |

`delivery`는 전달 방법에 대한 안내 문구이며, `deliveredAt`은 실제 완료 처리 날짜입니다. 서로 대체하지 않습니다.

처리 기록은 `type`, `at`, `from`, `to`를 기본으로 갖습니다. `at`은 ISO 시각이며 관리자 화면에서는 브라우저의 현지 시각으로 표시합니다. 전달 변경에는 `date`, `previousDate`, 판매 취소에는 취소 전 `deliveredAt`이 추가될 수 있습니다.

예전 데이터에는 새 필드가 없을 수 있습니다. 거래 변경 시 필요한 필드를 생성하며, 기능 도입 전 사건의 처리 이력을 임의로 채우지 않습니다. 상태만 JSON에서 직접 바꾸면 복구 사본과 처리 이력이 생성되지 않으므로 거래 처리는 관리자에서 진행합니다.

## 공개 범위

카탈로그 전체와 저장소 커밋은 공개됩니다. 관리자에서만 표시하는 처리 기록도 데이터 자체가 비공개인 것은 아닙니다. `published: false` 역시 목록·상세 화면 표시를 제어할 뿐 파일 접근을 제한하지 않습니다.

구매자 이름·연락처·주소·입금 내역은 저장하지 않습니다. 소유 이력의 `label`은 동의받은 공개 표기나 `소장자 · 비공개`처럼 개인을 식별하지 않는 표현을 사용합니다.
