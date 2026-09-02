import test from "node:test"
import assert from "node:assert/strict"
import { detectSuspiciousOdtText } from "./extract-documents.mjs"

test("ODT quality guard rejects severe Hangul glyph collapse", () => {
  const collapsed = `${"저".repeat(160)} ${"화".repeat(40)}`
  assert.match(detectSuspiciousOdtText(collapsed), /텍스트 손상/)
})

test("ODT quality guard accepts ordinary Korean administrative text", () => {
  const normal = "고충민원 관련 설명 및 자료 제출을 검토하고 처리 결과를 안내합니다. ".repeat(12)
  assert.equal(detectSuspiciousOdtText(normal), null)
})

test("ODT quality guard does not reject short labels", () => {
  assert.equal(detectSuspiciousOdtText("저저 화화"), null)
})
