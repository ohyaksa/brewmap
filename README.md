# ☕ BREWMAP — 3D Coffee Brewing Dialer

**나만의 커피 추출 레시피를 만들고, 3D 브루잉으로 경험하는 스마트 커피 추출 프로그램**

원두 종류, 그라인더, 분쇄도, 추출 비율, 수온 및 추출 시간을 설정하고 다양한 바리스타의 레시피를 활용할 수 있는 웹 기반 커피 브루잉 도구입니다.

## 🌐 Live Demo

👉 https://ohyaksa.github.io/brewmap/

## ✨ 주요 기능

### 1. 커피 추출 설정
- 원두 24종 데이터베이스
- 드리퍼 3종 지원
- 7단계 원두 중량 설정
- 4가지 추출 모드
  - 진하게 (1:14)
  - 표준 (1:16)
  - 연하게 (1:18)
  - 바이패스 (1:12 추출 + 1:4 온수 추가)
- 추출 수온 및 목표 시간 설정

### 2. 스마트 분쇄 설정
- 등록된 그라인더 모델 및 실제 눈금 설정
- 일반 분쇄도 5단계 선택
  1. 매우 굵게
  2. 굵게
  3. 중간
  4. 곱게
  5. 매우 곱게
- 분쇄 설정 없이도 사용 가능

### 3. 그라인더 데이터
- Feima 600N
- Baratza Encore
- Comandante
- Timemore 등 다양한 그라인더 지원

사용하는 그라인더의 고유 눈금을 기준으로 설정하며, 서로 다른 제품의 눈금을 임의로 환산하지 않습니다.

### 4. 전문 바리스타 레시피
- James Hoffmann
- Tetsu Kasuya
- Lance Hedrick
- Scott Rao 등

공개된 전문 레시피의 원본 비율과 추출 방식을 참고할 수 있습니다.

### 5. 3D 실시간 브루잉
- 3D 커피 추출 애니메이션
- 시간 및 추출 진행 상황 표시
- 물 붓기 사운드 및 ASMR
- 단계별 추출 안내

### 6. 커피 추출 분석
- SCA 골든컵 기준 차트
- 실측 TDS 입력
- 실제 완성 음료 무게 입력
- 실측 데이터 기반 추출수율(EY) 계산

※ 실측 데이터가 없는 경우 실제 측정 결과처럼 추정 수치를 표시하지 않습니다.

### 7. 레시피 관리
- 개인별 레시피 저장
- 레시피 불러오기
- CSV 백업 및 복원
- 설정 잠금 기능
- 마스터 및 지인 초대 모드

## 🛠️ 기술 구성

| 구분 | 기술 |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Data | JavaScript Recipe Database |
| Hosting | GitHub Pages |
| Storage | Browser Local Storage |
| Backup | CSV |

## 📂 프로젝트 파일 구조

```text
brewmap/
├── index.html
├── coffee_recipes.js
├── brew_engine.js
├── help.html
└── README.md
```

## 🚀 설치 및 실행

1. GitHub 저장소를 방문합니다.
2. `Code` → `Download ZIP`을 선택합니다.
3. 압축을 해제합니다.
4. `index.html`을 브라우저에서 실행합니다.

GitHub Pages를 활성화하면 웹사이트 주소로 접속할 수 있습니다.

## 📖 사용 설명서

프로그램의 상세 사용 방법은 `help.html`에서 확인할 수 있습니다.

## 📌 버전 정보

**Current Version: v1.6**

### Version 1.6 업데이트
- 시뮬레이션 저항지수 제거
- 분쇄 설정 UI 통합
- 일반 분쇄도 5단계 지원
- 분쇄 설정 미사용 옵션 추가
- 기존 레시피 데이터 호환성 개선
- 실측 TDS/EY 계산 기능 유지

## ☕ Project

**BREWMAP — 3D Coffee Brewing Dialer**

커피 한 잔의 추출 과정을 더 쉽게 이해하고, 나만의 최적의 레시피를 찾아가는 프로젝트입니다.

© 2026 BREWMAP. All rights reserved.
