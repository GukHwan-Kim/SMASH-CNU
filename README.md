# SMASH 충남대 (선물용)

충남대 캠퍼스를 3D로 부수는 시험기간 스트레스 해소 게임입니다. (충남대학교와 무관한 비공식 팬 게임, Hong-Iron 님의 SMASH 대학교를 사용함. 감사합니다.)

## 올리는 법 (GitHub Pages)
1. GitHub에서 새 저장소(예: `SMASH-CNU`)를 만들고 이 폴더의 파일을 그대로 올립니다.
   - 필요한 것: `index.html`, `src/`, `vendor/` (선택: `campus.json`)
2. 저장소 **Settings → Pages → Branch: main / (root)** 로 켭니다.
3. `https://<내아이디>.github.io/SMASH-CNU/` 링크를 선물하면 끝!

## 받는 사람 이름·메시지 넣기
링크 뒤에 붙이면 인트로 화면에 표시됩니다.
`https://<내아이디>.github.io/SMASH-CNU/?to=민지&msg=시험기간%20화이팅`

## 지도 데이터
- 기본: 열릴 때 OpenStreetMap에서 충남대 건물·도로를 자동으로 불러옵니다(한 번 받으면 브라우저에 저장).
- 불러오지 못하면 내장 근사 캠퍼스로 자동 전환됩니다.
- 더 안정적으로: 인터넷 되는 PC에서 `python3 tools/fetch_campus.py` → 생성된 `campus.json`을 `index.html` 옆에 두면 그 파일을 먼저 읽습니다.

## 조작
탭 = 공격 · 드래그 = 회전 · 두 손가락 = 확대/이동 (PC: 휠 확대, 오른쪽 드래그 이동)

## 출처
건물·도로 © OpenStreetMap contributors (ODbL) · 3D: three.js (MIT)
