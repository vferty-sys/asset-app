# asset-app

주식·ETF 포트폴리오와 공제회·예적금·연금을 한곳에서 관리하는 개인 자산관리 웹 앱입니다.
서버 없이 동작하며, 모든 데이터는 사용하는 사람의 브라우저(LocalStorage)에만 저장됩니다.

> 이 앱은 투자 권유가 아닌 참고용 도구입니다.

## 로컬에서 실행하기

빌드 과정이 없습니다. 저장소 폴더에서 정적 서버를 띄운 뒤 브라우저로 엽니다.

```bash
python3 -m http.server 8000
```

브라우저에서 <http://localhost:8000> 을 엽니다. (ES Modules를 쓰기 때문에 `index.html`을 파일로 바로 열면 동작하지 않습니다.)

## 테스트

계산·저장 로직은 Node 내장 테스트 러너로 검사합니다. (Node 18 이상)

```bash
npm test
```

## 폴더 구조

```
index.html          앱 화면 (탭 7개)
css/                스타일 (라이트/다크 테마)
js/app.js           진입점, 탭 이동
js/state.js         앱 데이터 메모리 사본 + 변경 알림
js/storage.js       LocalStorage 저장, 스키마 버전 관리, 백업/복원
js/validate.js      입력값 검증
js/format.js        금액·비율·날짜 표시
js/constants.js     기본 설정값과 기준값
js/ui/              탭별 화면
tests/              단위 테스트
```
