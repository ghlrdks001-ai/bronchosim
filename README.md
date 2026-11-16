# BronchoSim v1 — 마취과 전공의용 기관지경 시뮬레이터

전부 절차적으로 생성한 그래픽이라 저작권 있는 이미지는 들어 있지 않습니다. Three.js(r170, MIT)를 내장했습니다.

## 실행
- **파일 하나로 실행:** `dist/index.html` 하나에 모든 것이 들어 있습니다(약 0.7 MB, 오프라인 동작). PC 브라우저에서는 더블클릭으로 바로 열립니다.
- **개발 버전(소스 그대로):** `cd bronchosim && python3 -m http.server 8000` 실행 후 http://localhost:8000/ 접속. ES 모듈을 쓰기 때문에 서버가 필요합니다.
- **iPad:** dist/index.html을 정적 호스팅(GitHub Pages, Netlify, Cloudflare Pages 등)에 올린 뒤 Safari로 여세요. 홈 화면에 추가하면 전체 화면으로 쓸 수 있습니다.

## 조작
| | iPad | PC |
|---|---|---|
| 전진/후퇴 | ▲/▼ 길게 누르기 | ↑/↓ (Shift는 빠르게), 마우스 휠 |
| 팁 굴곡 | ⤒/⤓, 화면 위아래 드래그 | W/S, 마우스 드래그 |
| 회전(비틀기) | ⟲/⟳, 화면 좌우 드래그 | ←/→ 또는 A/D |
| 라벨/미니맵 | 상단 버튼 | L / M |

## 구조
- `src/airway.js`: 기관·기관지 트리 정의(mm 단위), 부드러운 합집합 SDF, surface-nets 메싱, 연골륜 변위(후벽 막성부 제외), carina 위치 계산
- `src/main.js`: 렌더링(내시경 광원 셰이더), 내시경 운동학과 충돌 처리, 라벨, 미니맵, DLT 증례·채점
- `tools/build.mjs`: 단일 파일 dist 빌드 (`cd tools && npm i && node build.mjs`)
- `tools/shot.mjs`, `tools/ui_test.mjs`, `tools/nav_test.mjs`: 헤드리스 Chrome 스크린샷과 조작 테스트
