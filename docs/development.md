# 개발·검증·배포

[문서 목록](README.md) · [문제 해결](troubleshooting.md)

명령은 `docs` 폴더가 아닌 저장소 최상위 폴더에서 실행합니다. 별도 프런트엔드 빌드 과정 없이 HTML·CSS·JavaScript를 제공하는 정적 사이트입니다.

## 로컬 실행

Python 3로 다음 명령을 실행합니다.

```powershell
python dev_server.py
```

| 화면 | 로컬 주소 |
|---|---|
| 컬렉션 | http://localhost:8000/ |
| 작품 상세 | http://localhost:8000/a/?id=0027 |
| 관리자 | http://localhost:8000/admin/ |

다른 포트는 `python dev_server.py 8080`처럼 지정합니다. 같은 네트워크에서 휴대폰으로 확인하려면 `python dev_server.py --lan`을 사용할 수 있습니다. 서버는 로컬 컴퓨터에서 들어온 요청에만 관리자 저장 기능을 허용합니다.

HTML 파일을 더블클릭하는 대신 개발 서버를 사용합니다. 데이터 로드와 관리자 저장에 HTTP 요청이 필요합니다. 로컬 관리자는 `data/`, `images/`의 실제 파일을 수정하므로 상태 전환 연습은 별도 복사본에서 진행하는 편이 좋습니다. 로컬 저장은 GitHub 업로드가 아닙니다.

## 검증

Node.js가 설치되어 있으면 별도 패키지 설치 없이 실행합니다.

```powershell
node --test tests/lifecycle.test.js
node --check assets/js/admin.js
node --check assets/js/lifecycle.js
git diff --check
```

테스트는 임시 메모리 데이터로 상태 처리를 검증하며 실제 카탈로그를 수정하지 않습니다. 예약 취소, 판매·전달·취소·재판매, 과거 이력 보존, 기존 데이터 처리, 날짜 검증, 목록·수정 화면 저장 경로, 저장 실패를 다룹니다.

실제 브라우저 레이아웃, GitHub 로그인, NFC 하드웨어 동작까지 검증하는 테스트는 아닙니다. 화면 변경 시 PC·휴대폰 폭에서 버튼·입력·처리 이력을 별도로 확인합니다.

## GitHub에 반영

수정 파일과 실제 작품 데이터 변경 여부를 먼저 확인합니다.

```powershell
git status --short
git diff
```

필요한 파일만 `git add`로 선택해 커밋한 뒤 `git push origin main`으로 업로드합니다. 코드 수정 중 관리자에서 운영 데이터가 바뀔 수 있으므로 원격 변경과 충돌하면 내용을 확인해 합칩니다. 강제 푸시로 덮어쓰지 않습니다.

이 프로젝트는 `main` 브랜치의 저장소 루트를 GitHub Pages 배포 대상으로 사용합니다. 관리자에서 GitHub 모드로 저장해도 같은 브랜치에 커밋하므로 배포가 발생합니다. 배포 소스를 `docs/`로 바꾸면 안 됩니다. `docs/`는 설명 문서 모음이며 사이트 진입 파일은 여전히 루트에 있습니다.

관리자 저장 성공과 공개 사이트 배포 완료는 별개입니다. GitHub 저장소의 Actions에서 해당 커밋의 `pages-build-deployment` 성공을 확인한 뒤 공개 사이트에서 반영 여부를 확인합니다.

## 캐시 갱신

공개 사이트는 이전 스크립트를 캐시할 수 있습니다. 스크립트나 스타일을 수정할 때 이를 불러오는 HTML의 `?v=...` 값도 새로운 값으로 변경합니다. 하나의 기능에 함께 쓰이는 파일은 같은 배포에서 함께 갱신합니다.

- 공개 컬렉션: [index.html](../index.html)
- 작품 상세: [a/index.html](../a/index.html)
- 관리자: [admin/index.html](../admin/index.html)

캐시 버전은 수동으로 관리하며 자동 생성되지 않습니다. 데이터 요청은 현재 코드에서 캐시를 피하도록 처리합니다. 사용자에게 예전 문구가 보이면 [문제 해결](troubleshooting.md)을 참고합니다.

## 문서 관리

설명용 `.md`는 모두 `docs/`에 추가하고 [문서 목록](README.md)에 연결합니다. 문서끼리의 링크는 `admin-guide.md`, 소스 파일 링크는 `../assets/js/admin.js`처럼 상대경로로 작성합니다. 화면 명칭이나 상태 처리 규칙이 바뀌면 관련 문서도 같은 변경에 포함합니다.
