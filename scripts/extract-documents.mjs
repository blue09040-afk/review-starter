import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parse } from "kordoc"

const ROOT = process.cwd()
export const KORDOC_VERSION = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
).dependencies.kordoc
const AUTO_MARKER = "<!-- AUTO-GENERATED: review document extraction. DO NOT EDIT DIRECTLY. -->"
const SOURCE_EXTS = new Set([".hwp", ".hwpx", ".odt", ".pdf", ".jpg", ".jpeg", ".png"])
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png"])
const SKIP_DIRS = new Set([".git", "node_modules", "extracted"])
const NAME_RESOLVER = path.join(ROOT, ".github", "scripts", "resolve_extracted_name.py")

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/")
}

function sourceOutputPath(source) {
  const output = execFileSync("python3", [NAME_RESOLVER, source], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim()
  if (!output) throw new Error(`Output resolver returned an empty path for ${rel(source)}`)
  return path.resolve(ROOT, output)
}

async function collectSources(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await collectSources(full, out)
      continue
    }
    if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(full)
  }
  return out
}

async function collectExtractedMarkdown(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue
      await collectExtractedMarkdown(full, out)
      continue
    }
    if (entry.isFile() && path.basename(path.dirname(full)) === "extracted" && entry.name.toLowerCase().endsWith(".md")) {
      out.push(full)
    }
  }
  return out
}

async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`)
  try {
    await writeFile(tmp, text, "utf8")
    await rename(tmp, file)
  } finally {
    await unlink(tmp).catch(() => {})
  }
}

function sanitizeImageLinks(markdown, images = []) {
  let result = markdown
  for (const image of images) {
    if (!image?.filename) continue
    const escaped = image.filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const re = new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`, "g")
    result = result.replace(re, `[원본 내 이미지: ${image.filename}]`)
  }
  return result
}

function normalizeForDuplicateCheck(text) {
  return text
    .replace(/`{1,3}/g, "")
    .replace(/[|>#*_\-]/g, "")
    .replace(/\s+/g, "")
    .trim()
}

export function detectSuspiciousOdtText(markdown) {
  const hangul = String(markdown ?? "").match(/[가-힣]/gu) ?? []
  if (hangul.length < 80) return null

  const counts = new Map()
  for (const syllable of hangul) counts.set(syllable, (counts.get(syllable) ?? 0) + 1)
  const dominant = [...counts.values()].sort((a, b) => b - a).slice(0, 2)
  const dominantRatio = dominant.reduce((sum, count) => sum + count, 0) / hangul.length

  if (counts.size <= 8 && dominantRatio >= 0.85) {
    return `ODT 변환 결과의 한글 ${hangul.length}자가 ${counts.size}개 음절에 비정상적으로 집중되어 텍스트 손상이 의심됩니다.`
  }
  return null
}

async function ocrEmbeddedImages(parsed, mainMarkdown) {
  const images = parsed.images ?? []
  if (!images.length) return { sections: [], attempted: 0, included: 0, failed: 0 }

  const mainNormalized = normalizeForDuplicateCheck(mainMarkdown)
  const sections = []
  let attempted = 0
  let included = 0
  let failed = 0

  for (const image of images) {
    attempted += 1
    try {
      const imageResult = await parse(Buffer.from(image.data))
      if (!imageResult.success) {
        failed += 1
        continue
      }

      const text = imageResult.markdown.trim()
      const normalized = normalizeForDuplicateCheck(text)
      if (normalized.length < 2) continue

      const sample = normalized.slice(0, Math.min(120, normalized.length))
      if (sample.length >= 24 && mainNormalized.includes(sample)) continue

      sections.push(`### ${image.filename || `image-${attempted}`}\n\n${text}`)
      included += 1
    } catch {
      failed += 1
    }
  }

  return { sections, attempted, included, failed }
}

function warningLines(parsed) {
  if (!parsed.warnings?.length) return []
  return parsed.warnings.map((warning) => {
    const page = warning.page ? `p.${warning.page} ` : ""
    return `- ${page}${warning.code}: ${warning.message}`
  })
}

function extractionHeader(source, parsed, imageOcr, pdfOcrUsed) {
  const ext = path.extname(source).toLowerCase()
  const tool = ext === ".odt" ? `LibreOffice headless → kordoc ${KORDOC_VERSION}` : `kordoc ${KORDOC_VERSION}`
  const lines = [
    AUTO_MARKER,
    "# 자동 추출 정보",
    "",
    `- 원본 파일: \`${path.basename(source)}\``,
    `- 변환 도구: \`${tool}\``,
    `- 원본 형식: \`${ext.slice(1).toUpperCase()}\``,
  ]

  if (ext === ".pdf") {
    lines.push(`- PDF 처리: 텍스트 레이어 우선${pdfOcrUsed ? " + OCR 필요 페이지만 PP-OCRv5 보강" : " (OCR 필요 신호 없음)"}`)
    lines.push(`- PDF 내부 이미지 OCR: ${imageOcr.attempted}개 시도 / ${imageOcr.included}개 결과 포함 / ${imageOcr.failed}개 실패`)
    if (parsed.qualitySummary) {
      const q = parsed.qualitySummary
      lines.push(`- PDF 품질 신호: ${q.needsOcr ? "OCR 필요 페이지 있음" : "문서 단위 OCR 필요 신호 없음"}`)
      if (q.ocrCandidatePages?.length) lines.push(`- OCR 후보 페이지: ${q.ocrCandidatePages.join(", ")}`)
    }
  } else if (ext === ".odt") {
    lines.push("- ODT 처리: LibreOffice headless로 임시 DOCX 변환 후 Kordoc DOCX 직접 파싱")
    lines.push(`- ODT 변환 DOCX 내부 이미지 OCR: ${imageOcr.attempted}개 시도 / ${imageOcr.included}개 결과 포함 / ${imageOcr.failed}개 실패`)
  } else if (ext === ".hwp") {
    lines.push("- HWP 처리: kordoc HWP3/HWP5 직접 파싱")
  } else if (ext === ".hwpx") {
    lines.push("- HWPX 처리: kordoc HWPX 직접 파싱")
  } else if (IMAGE_EXTS.has(ext)) {
    lines.push("- 이미지 처리: kordoc PP-OCRv5 직접 OCR")
  }

  lines.push("", "## 주의사항", "")
  lines.push("- 이 파일은 AI 검토 편의를 위한 자동 파생자료이며 원본·공식기록을 대체하지 않습니다.")
  lines.push("- 표 병합, 글상자, 도형, 배치, 페이지 경계 또는 중요 수치가 판단에 영향을 주면 원본을 다시 확인합니다.")
  if (ext === ".pdf" || ext === ".odt") lines.push("- 문서 내부 이미지에서 판독된 문자는 아래 OCR 보강 섹션에 포함될 수 있습니다.")

  const warnings = warningLines(parsed)
  if (warnings.length) lines.push("", "## 파서 경고", "", ...warnings)

  return `${lines.join("\n")}\n\n---\n\n`
}

function failureMarkdown(source, failure) {
  const ext = path.extname(source).toLowerCase()
  const tool = ext === ".odt" ? `LibreOffice headless → kordoc ${KORDOC_VERSION}` : `kordoc ${KORDOC_VERSION}`
  return [
    AUTO_MARKER,
    "# 자동 추출 실패",
    "",
    `- 원본 파일: \`${path.basename(source)}\``,
    `- 변환 도구: \`${tool}\``,
    `- 원본 형식: \`${ext.slice(1).toUpperCase()}\``,
    `- 오류 코드: \`${failure.code ?? "PARSE_ERROR"}\``,
    `- 오류: ${failure.error ?? "알 수 없는 파싱 오류"}`,
    "",
    "이 추출본만으로 원문 내용을 판단하지 말고 원본을 직접 확인하거나 m1의 해당 문서 판독 절차를 사용하십시오.",
    "",
  ].join("\n")
}

async function parsePdfHybrid(source) {
  const initial = await parse(source)
  if (!initial.success) return { parsed: initial, pdfOcrUsed: false }

  if (!initial.qualitySummary?.needsOcr) {
    return { parsed: initial, pdfOcrUsed: false }
  }

  const retried = await parse(source, { ocr: true })
  if (!retried.success) {
    return {
      parsed: {
        ...initial,
        warnings: [
          ...(initial.warnings ?? []),
          { code: "OCR_RETRY_FAILED", message: retried.error ?? "OCR retry failed" },
        ],
      },
      pdfOcrUsed: false,
    }
  }

  return { parsed: retried, pdfOcrUsed: true }
}

async function parseOdtViaDocx(source) {
  const tempDir = await mkdtemp(path.join(ROOT, ".odt-convert-"))
  try {
    execFileSync(
      "libreoffice",
      ["--headless", "--convert-to", "docx:Office Open XML Text", "--outdir", tempDir, source],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )

    const convertedDocx = (await readdir(tempDir)).filter((name) => path.extname(name).toLowerCase() === ".docx")
    if (convertedDocx.length !== 1) {
      throw new Error(`LibreOffice produced ${convertedDocx.length} DOCX files for ${rel(source)}; expected exactly 1`)
    }

    const parsed = await parse(path.join(tempDir, convertedDocx[0]))
    return { parsed, pdfOcrUsed: false }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function removeAlternateGeneratedNames(source, selectedOutput) {
  const extOriginal = path.extname(source)
  const ext = extOriginal.toLowerCase()
  const base = path.basename(source, extOriginal)
  const outDir = path.join(path.dirname(source), "extracted")
  const candidates = [
    path.join(outDir, `${base}.md`),
    path.join(outDir, `${base}-${ext.slice(1)}.md`),
  ]

  for (const candidate of candidates) {
    if (path.resolve(candidate).toLowerCase() === path.resolve(selectedOutput).toLowerCase()) continue
    try {
      const content = await readFile(candidate, "utf8")
      if (content.startsWith(AUTO_MARKER) || ext === ".hwpx") await unlink(candidate)
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
}

async function convertOne(source) {
  const ext = path.extname(source).toLowerCase()
  const output = sourceOutputPath(source)
  await removeAlternateGeneratedNames(source, output)

  let parsed
  let pdfOcrUsed = false

  try {
    if (ext === ".pdf") {
      const hybrid = await parsePdfHybrid(source)
      parsed = hybrid.parsed
      pdfOcrUsed = hybrid.pdfOcrUsed
    } else if (ext === ".odt") {
      const hybrid = await parseOdtViaDocx(source)
      parsed = hybrid.parsed
      pdfOcrUsed = hybrid.pdfOcrUsed
    } else {
      parsed = await parse(source)
    }
  } catch (error) {
    parsed = { success: false, code: "PARSE_ERROR", error: error instanceof Error ? error.message : String(error) }
  }

  if (parsed.success && ext === ".odt") {
    const qualityFailure = detectSuspiciousOdtText(parsed.markdown)
    if (qualityFailure) {
      parsed = { success: false, code: "ODT_TEXT_CORRUPTION", error: qualityFailure }
    }
  }

  if (!parsed.success) {
    await atomicWrite(output, failureMarkdown(source, parsed))
    return { ok: false, imageOcr: { attempted: 0, included: 0, failed: 0 }, pdfOcrUsed }
  }

  const markdown = sanitizeImageLinks(parsed.markdown, parsed.images)
  let imageOcr = { sections: [], attempted: 0, included: 0, failed: 0 }

  if (ext === ".pdf" || ext === ".odt") imageOcr = await ocrEmbeddedImages(parsed, markdown)

  const appendixTitle = ext === ".odt" ? "ODT 변환 DOCX 내부 이미지 OCR 보강" : "PDF 내부 이미지 OCR 보강"
  const ocrAppendix = imageOcr.sections.length
    ? `\n\n---\n\n## ${appendixTitle}\n\n${imageOcr.sections.join("\n\n")}\n`
    : ""

  const finalText = `${extractionHeader(source, parsed, imageOcr, pdfOcrUsed)}${markdown.trim()}${ocrAppendix}\n`
  await atomicWrite(output, finalText)
  return { ok: true, imageOcr, pdfOcrUsed }
}

async function removeStaleGeneratedOutputs(expectedOutputs) {
  const markdownFiles = await collectExtractedMarkdown(ROOT)
  let removed = 0

  for (const md of markdownFiles) {
    if (expectedOutputs.has(path.resolve(md).toLowerCase())) continue
    try {
      const content = await readFile(md, "utf8")
      if (!content.startsWith(AUTO_MARKER)) continue
      await unlink(md)
      removed += 1
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }

  return removed
}

async function main() {
  const sources = (await collectSources(ROOT)).sort((a, b) => rel(a).localeCompare(rel(b), "ko"))
  const outputMap = new Map()
  for (const source of sources) {
    const output = sourceOutputPath(source)
    const key = path.resolve(output).toLowerCase()
    if (outputMap.has(key)) {
      throw new Error(`Output collision: ${rel(source)} and ${rel(outputMap.get(key))} -> ${rel(output)}`)
    }
    outputMap.set(key, source)
  }

  let converted = 0
  let failed = 0
  let pdfOcrDocuments = 0
  let imageAttempts = 0
  let imageIncluded = 0
  let imageFailed = 0

  for (const source of sources) {
    const result = await convertOne(source)
    if (result.ok) converted += 1
    else failed += 1
    if (result.pdfOcrUsed) pdfOcrDocuments += 1
    imageAttempts += result.imageOcr.attempted
    imageIncluded += result.imageOcr.included
    imageFailed += result.imageOcr.failed
  }

  const staleRemoved = await removeStaleGeneratedOutputs(new Set(outputMap.keys()))

  console.log(`Documents: ${sources.length}; converted: ${converted}; failed: ${failed}; stale removed: ${staleRemoved}`)
  console.log(`PDF-based documents using selective OCR: ${pdfOcrDocuments}`)
  console.log(`Embedded-image OCR: attempted ${imageAttempts}; included ${imageIncluded}; failed ${imageFailed}`)

  if (failed > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}