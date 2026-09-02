# review 기본 사용 매뉴얼

이 문서는 `review`를 처음 사용하는 직원이 **사건 폴더를 만들고 → 문서를 자동변환하고 → ChatGPT에서 검토하고 → 필요 시 이력을 삭제하는 방법**을 빠르게 확인하기 위한 안내입니다.

세부 자동화 동작의 정본은 `.github/workflows/`와 `scripts/`입니다. 이 문서는 일상 사용법만 설명합니다.

템플릿 복제 후 저장소 이름을 `m1`, `review`가 아닌 다른 이름으로 정했다면 아래 예시의 `@GitHub m1`, `@GitHub review`를 자신의 실제 저장소명으로 바꿔 사용하세요.

## 1. 사건 폴더 만들기

starter에서는 다음 형식을 권장합니다.

```text
cases/
  20260902_사건명/
    민원서.hwp
    기존회신.pdf
    담당부서자료.hwpx
    extracted/
      ... 자동 생성 Markdown ...
```

권장 폴더명:

```text
cases/YYYYMMDD_사건명
```

예:

```text
cases/20260902_농지성토_배수민원
cases/20260902_일상감사_용역계약
```

기존 운영방식처럼 저장소 루트에 `YYYYMMDD_사건명` 폴더를 만드는 방식도 현재 자동화와 `Purge Case History`가 지원합니다. 새로 시작한다면 사건자료와 저장소 운영파일을 구분하기 쉬운 `cases/` 아래 방식을 권장합니다.

### 원본 파일은 어디에 넣나

원본 HWP/HWPX/ODT/PDF/이미지는 사건 폴더 또는 필요한 하위 자료 폴더에 넣습니다. `extracted/`는 자동변환 결과 폴더이므로 원본 자료 보관용으로 사용하지 않습니다.

> 사건자료를 GitHub에 올릴 수 있는지, 개인정보·비공개 자료를 외부 AI와 연결할 수 있는지는 각 기관의 보안·개인정보 정책을 우선합니다.

---

## 2. 문서 자동변환

`main` 브랜치에 다음 형식의 원본 문서가 추가·변경되면 `Extract Documents to Markdown` Action이 자동 실행됩니다.

- HWP / HWPX
- ODT
- PDF
- JPG / JPEG / PNG

변환 결과는 원본과 같은 사건 폴더 아래의 `extracted/`에 Markdown으로 생성됩니다.

예:

```text
cases/20260902_사건명/민원서.hwp
→ cases/20260902_사건명/extracted/민원서.md
```

동일한 이름의 서로 다른 형식이 함께 있으면 파일 충돌을 막기 위해 확장자 식별자가 붙을 수 있습니다.

```text
신고서.pdf → extracted/신고서-pdf.md
신고서.hwp → extracted/신고서-hwp.md
신고서.odt → extracted/신고서-odt.md
```

### PR과 main의 차이

- **PR**: 문서추출 코드와 입력을 검증하지만 생성 Markdown을 저장소에 자동 커밋하지 않습니다.
- **main push**: 변환된 `extracted/*.md`가 있으면 GitHub Actions가 자동 커밋합니다.

따라서 실제 사건자료를 `review`에서 바로 읽기 위한 Markdown으로 만들려면 원본 문서가 최종적으로 `main`에 반영되어야 합니다.

### 변환 실패 시

Action이 실패하면 해당 실행 로그와 생성된 실패 Markdown이 있는지 먼저 확인합니다. 자동변환이 실패했다고 원본 문서가 빈 문서라고 단정하지 말고, 형식·OCR·추출기 한계를 별도로 확인합니다.

---

## 3. ChatGPT에서 사건 검토 요청하기

자동변환이 끝났다면 일반적으로 `extracted/`를 먼저 지정하면 됩니다.

```text
@GitHub m1의 CHATGPT_ENTRYPOINT.md를 확인하고,
@GitHub review의 cases/20260902_사건명/extracted를 현재 사건자료로 사용해서 검토해줘.
사건 사실은 이 폴더 자료에서만 가져오고 m1의 샘플은 구조 참고로만 사용해줘.
```

원본 화면·표·도면·서식이 결론에 영향을 주는 경우에는 Markdown만으로 단정하지 말고 원본 문서도 함께 확인하도록 요청합니다.

자주 쓰는 `굵은 수정안`, `반복재검토`, `결재자 검토`, `진정민원 해소계획 요청 → 답변서`, `일상감사 검토`의 요청 예시는 `m1` 저장소의 `QUICK_START.md`를 참고합니다.

---

## 4. 일상감사 사건은 어댑터 구조 사용

일상감사는 일반 사건 폴더보다 자료 종류와 결과물이 많으므로 `DAILY_AUDIT_ADAPTER.md`의 구조를 권장합니다.

```text
cases/YYYYMMDD_간단한사건명/
├─ source/
│  └─ extracted/
├─ working/
└─ result/
   └─ daily-audit/
```

- 원자료: `source/`
- 자동 추출본: `source/extracted/`
- 수동 보정·쟁점정리: `working/`
- 최종 검토결과: `result/daily-audit/`

호출 예시:

```text
@GitHub review의 DAILY_AUDIT_ADAPTER.md와
@GitHub m1의 일상감사 검토 진입점을 읽어줘.
review의 cases/20260902_일상감사_사업명/source 자료를 검토하고,
결과를 cases/20260902_일상감사_사업명/result/daily-audit/에 작성해줘.
```

일상감사 기본 산출물은 7종 Markdown과 `case_review.json`이며, 자세한 파일명·검토 순서는 `DAILY_AUDIT_ADAPTER.md`를 따릅니다.

---

## 5. OneOCR 교차검증

중요한 HWPX 또는 PDF를 자동추출 결과와 한 번 더 비교하고 싶을 때만 `OneOCR Cross Check`를 사용합니다.

GitHub의 **Actions → OneOCR Cross Check → Run workflow**에서 다음을 입력합니다.

- `document_path`: 저장소 기준 HWPX 또는 PDF 경로
- `source_markdown`: 비교할 Markdown 경로. 비워 두면 HWPX는 같은 폴더의 `extracted/<이름>.md`를 자동 탐색할 수 있음
- `dpi`: 기본값 `220`, 특별한 이유가 없으면 그대로 사용

예:

```text
document_path:
cases/20260902_사건명/담당부서자료.hwpx

source_markdown:
cases/20260902_사건명/extracted/담당부서자료.md
```

OneOCR는 모든 문서에 자동으로 돌리는 기본 단계가 아니라 **중요 문서의 선택적 교차검증 수단**으로 사용합니다. 첫 실행에서는 runtime cache가 새로 만들어질 수 있습니다.

---

## 6. 사건 폴더 삭제와 Purge 구분

### 일반 삭제

사건 처리가 끝나 단순히 현재 `main`에서 폴더를 없애려는 경우에는 일반 Git 삭제·커밋으로 충분합니다.

이 경우 과거 커밋에는 해당 파일이 남아 있습니다.

### `Purge Case History`

다음처럼 **과거 Git 이력에서도 사건자료를 제거해야 하는 특별한 경우에만** 사용합니다.

- 개인정보·민감자료를 잘못 커밋함
- 원래 Git에 남기면 안 되는 사건자료가 올라감
- 단순 현재본 삭제가 아니라 Git 과거 이력까지 제거해야 함

허용되는 입력 경로는 다음 두 형식입니다.

```text
cases/YYYYMMDD_사건명
YYYYMMDD_사건명
```

실행 시 확인값에는 정확히 다음을 입력해야 합니다.

```text
PURGE
```

또한 실제 purge를 사용하려면 저장소 Secret `PURGE_TOKEN`이 별도로 설정되어 있어야 합니다.

### 매우 중요

`Purge Case History`는 단순 삭제가 아닙니다. 지정 사건 경로를 제거하기 위해 **도달 가능한 Git 이력을 다시 작성하고 저장소의 브랜치·태그를 force-push**합니다.

따라서 다음 원칙을 지킵니다.

1. 단순 사건 종료·정리는 purge 사유가 아닙니다.
2. 실행 전 입력한 사건 경로가 정확한지 다시 확인합니다.
3. 여러 사람이 같은 저장소를 사용 중이면 purge 전에 작업 충돌 여부를 확인합니다.
4. purge 후 기존 clone·작업본에는 과거 이력이 남아 있을 수 있으므로 다시 동기화하거나 재clone하는 것을 권장합니다.
5. 오래된 clone에서 삭제 전 이력을 다시 push하면 제거한 자료가 재유입될 수 있으므로 주의합니다.

복구가 어렵기 때문에 애매하면 purge를 실행하지 말고 현재본 일반 삭제까지만 처리합니다.

---

## 7. 가장 간단한 일상 사용 순서

```text
1. cases/YYYYMMDD_사건명 폴더 생성
2. 원본 문서 업로드
3. Extract Documents to Markdown 완료 확인
4. extracted/ Markdown 생성 확인
5. ChatGPT에서 @GitHub m1 + 해당 review 사건 폴더 지정
6. 초안 작성
7. 필요 시 굵은 수정안 → 반복재검토 → 결재 전 최종검토
8. 사건자료 삭제가 필요하면 일반 삭제와 purge 필요성을 먼저 구분
```

`review`는 사건자료 작업공간이고, 업무 판단·문안 작성 기준의 정본은 자신의 `m1` 저장소에 둡니다.
