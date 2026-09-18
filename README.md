# ONE NFC 작품 기록

서울대 미대생 작품 뒤의 NFC 태그(또는 전시 캡션 QR)를 휴대폰으로 태그하면 열리는 작품 기록 웹앱입니다.
서버 없이 GitHub Pages로 배포하고, 관리자 페이지에서 작품을 등록·수정합니다.

| 주소 | 화면 |
|---|---|
| `/` | 컬렉션 (전체 작품) |
| `/a/?id=0027&src=nfc` | 작품 페이지 — NFC 태그용 |
| `/a/?id=0027&src=qr` | 작품 페이지 — 전시 캡션 QR용 |
| `/admin/` | 관리자 페이지 |

## GitHub Pages 배포

1. 현재 저장소: https://github.com/alex311-snu/one-art (공개)
2. 저장소 → Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save
3. 사이트: https://alex311-snu.github.io/one-art/
4. 관리자 페이지 → 설정 → **사이트 주소**에 위 주소를 넣고 저장합니다. (NFC·QR 주소의 기준)

## 관리자 페이지 쓰는 법 (팀원용)

1. https://alex311-snu.github.io/one-art/admin/ 접속
2. 처음 한 번: 저장소 소유자·이름·토큰 입력 (토큰 발급 방법은 로그인 화면의 “토큰 발급 방법”을 펼치세요)
3. **작품 추가** → 정보 입력, 사진 추가 → **저장**
4. 판매 상태는 목록에서 바로 바꿀 수 있습니다. “소장됨”으로 바꾸면 소장 시점과 소유 이력이 자동으로 채워집니다.
5. 저장 후 공개 페이지에 반영되기까지 1~2분 걸립니다.

> ⚠️ 저장소가 공개되어 있으므로 구매자 이름·연락처·입금 정보는 절대 입력하지 마세요. 판매 원장에 따로 관리합니다.

## NFC 태그 쓰기

1. 관리자 → 작품 수정 → **NFC · QR** 에서 NFC 주소 복사
2. 휴대폰 **NFC Tools** 앱 → 쓰기 → 레코드 추가 → URL/URI → 붙여넣기 → 쓰기 → 태그에 휴대폰 대기
3. iPhone·Android에서 각각 태그해서 올바른 작품이 열리는지 확인
4. 주소가 확정된 뒤에만 태그를 잠급니다 (잠그면 되돌릴 수 없음)

## 폴더 구조

```
index.html            컬렉션
a/index.html          작품 페이지
admin/index.html      관리자
assets/css/           style.css(공개) · admin.css(관리자)
assets/js/            common.js · artwork.js · collection.js · store.js(저장: 로컬/GitHub) · admin.js
data/catalog.json     모든 데이터 (사이트 설정 · 작가 · 작품)
images/artworks/번호/ 작품 사진
images/artists/       작가 사진
dev_server.py         로컬 테스트 서버 (배포에는 쓰이지 않음)
```

현재 들어 있는 #0027, #0028은 **예시 데이터**입니다 (목업 이미지를 잘라 쓴 가상 작품). 실제 작품을 올린 뒤 관리자에서 삭제하세요.
