import test from "node:test"
import assert from "node:assert/strict"
import { detectSuspiciousOdtText, documentParseOptions, embeddedOcrHeading, isUsefulEmbeddedOcrText, shouldIncludeEmbeddedOcrText, TABLE_LAYOUT_MODE } from "./extract-documents.mjs"

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


test("document extraction pins visual table interpretation", () => {
  assert.equal(TABLE_LAYOUT_MODE, "visual")
  assert.deepEqual(documentParseOptions(), { layoutTables: "visual" })
})

test("PDF hybrid parsing explicitly controls OCR", () => {
  assert.deepEqual(documentParseOptions({ ocr: false }), { layoutTables: "visual", ocr: false })
  assert.deepEqual(documentParseOptions({ ocr: true }), { layoutTables: "visual", ocr: true })
})


test("embedded image OCR drops symbol-only noise and text already present in the main document", () => {
  assert.equal(isUsefulEmbeddedOcrText("0 ● •"), false)
  assert.equal(shouldIncludeEmbeddedOcrText("국민권익위원회", "수신 국민권익위원회 위원장"), false)
})

test("embedded image OCR keeps short substantive administrative text", () => {
  assert.equal(isUsefulEmbeddedOcrText("공개"), true)
  assert.equal(shouldIncludeEmbeddedOcrText("처리기한 2026.10.21.", "별도 본문"), true)
  assert.equal(shouldIncludeEmbeddedOcrText("접수번호 2026-1234", "별도 본문"), true)
})

test("embedded image OCR keeps substantive text", () => {
  assert.equal(shouldIncludeEmbeddedOcrText("현장사진에 표시된 폐기물 적치 위치와 작업일자를 확인합니다.", "별도 본문"), true)
})


test("short embedded OCR is retained but clearly marked for source verification", () => {
  assert.match(embeddedOcrHeading("image_001.png", "처리기한 2026.10.21."), /짧은 판독·원본 확인 필요/)
  assert.equal(embeddedOcrHeading("image_002.png", "현장사진에 표시된 폐기물 적치 위치와 작업일자를 확인합니다."), "image_002.png")
})
