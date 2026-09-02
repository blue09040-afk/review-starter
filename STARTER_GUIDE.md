# review-starter 사용 안내

이 저장소는 다른 직원의 실제 `review` 운영 구조와 문서 처리 자동화를 출발점으로 제공하는 **독립 복제용 시작본**입니다.

## 운영 원칙

- 원본 사용자의 업무규칙을 팀 공통 표준으로 강제하지 않습니다.
- 자신의 업무에 맞지 않는 문서·Actions·폴더는 자유롭게 수정하거나 삭제할 수 있습니다.
- 자신의 `m1` 저장소와 함께 사용하는 것을 권장합니다.
- 복제 이후 원본 `review`와 자동 동기화하지 않습니다.

## 공유 전 소유자 점검

직원에게 배포할 때는 GitHub 저장소 설정에서 **Template Repository**로 활성화한 뒤 `Use this template`로 각자의 새 저장소를 만들게 하는 방식을 권장합니다. 템플릿으로 만든 저장소는 starter와 별도의 프로젝트·이력으로 시작하므로 실제 사건 작업공간을 독립 운영하기에 적합합니다.

Template Repository를 사용하지 않는 경우에도 공유받은 starter 자체에 실제 사건자료를 올리거나 계속 수정하지 말고, 먼저 자신의 새 Private 저장소를 만든 뒤 기본 브랜치의 파일을 옮겨 독립 작업공간으로 사용합니다. 조직 정책상 허용되지 않은 Git 인증·전송 방식을 새로 만들지는 않습니다.

## 복제 방법

1. 이 저장소가 GitHub Template Repository로 설정되어 있으면 `Use this template`로 자신의 **Private** 저장소를 만듭니다.
2. 일반적으로 기본 브랜치만 복제하면 충분합니다. 검증용·임시 브랜치를 함께 가져올 필요는 없습니다.
3. 새 저장소에서 아래 `권장 첫 점검`을 수행한 뒤 실제 사건 폴더를 추가합니다.

## 포함된 자동화

- `Extract Documents to Markdown`: HWP/HWPX/ODT/PDF/이미지 → Markdown 자동 추출
- `OneOCR Cross Check`: 중요 문서의 선택적 OneOCR 교차검증
- `Purge Case History`: 특정 사건 경로를 Git 과거 이력까지 제거하는 수동 history rewrite 도구
- Dependabot: npm 의존성 월간 확인

현재 문서추출 기준 Kordoc 버전은 `4.12.0`입니다.

## 새 저장소에서 다시 만들어지는 것

다음 항목은 원본 저장소에서 복사되지 않습니다.

- Actions cache
- 과거 workflow run과 artifact
- Repository/Environment Secrets 및 Variables
- Ruleset / branch protection
- Collaborator 권한
- GitHub App 연결 상태

따라서 일반 문서추출은 바로 사용할 수 있지만, OneOCR cache는 첫 실행에서 새로 생성됩니다.

## `PURGE_TOKEN`은 선택 설정

`Purge Case History`는 복구 곤란한 Git history rewrite 도구입니다. 평상시에는 설정하지 않아도 됩니다.

실제로 사용할 경우에만 해당 저장소에 한정된 fine-grained token을 만들고 Actions secret `PURGE_TOKEN`으로 등록합니다. 필요한 최소 권한은 현재 workflow 기준 `Contents: Read and write`, `Workflows: Read and write`입니다.

## 처음 ChatGPT에 요청할 문구

```text
내 m1, review 저장소는 다른 직원의 실사용 구조를 출발점으로 복사한 거야.
기존 직원의 규칙을 팀 공통표준으로 강제하지 말고,
현재 파일과 Actions를 먼저 확인한 다음 내가 하는 업무와 환경에 맞게
필요한 부분만 수정해서 독립적으로 운영할 수 있도록 도와줘.
```

## 권장 첫 점검

1. GitHub Actions 사용이 허용되어 있는지 확인
2. `Extract Documents to Markdown` PR 검증 통과 여부 확인
3. OneOCR를 사용할 경우 OneOCR PR 설정 검증 및 첫 cache 생성 확인
4. 필요 없는 업무 어댑터나 Actions 삭제
5. 자신의 `m1` 저장소 경로를 참조하는 템플릿·호출문을 자신의 저장소명에 맞게 조정
