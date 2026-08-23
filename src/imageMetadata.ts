// PNG에 포함된 이미지 생성 메타데이터를 읽는다.
// NovelAI(NAI)는 tEXt 청크에 Software / Source / Description / Comment를 남기고,
// Comment에는 네거티브 프롬프트와 샘플러 등 생성 설정이 JSON으로 들어 있다.
// AUTOMATIC1111 계열은 parameters 청크 하나에 모든 정보를 텍스트로 남긴다.

export interface ImageGenerationMeta {
  negativePrompt: string
  model: string
  sampler: string
  seed: string
  steps: string
  scale: string
  noiseSchedule: string
  size: string
}

export interface ParsedImageGeneration {
  source: 'novelai' | 'automatic1111'
  prompt: string
  meta: ImageGenerationMeta
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_CHUNK_COUNT = 512

export function createEmptyImageGenerationMeta(): ImageGenerationMeta {
  return {
    negativePrompt: '',
    model: '',
    sampler: '',
    seed: '',
    steps: '',
    scale: '',
    noiseSchedule: '',
    size: '',
  }
}

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new DecompressionStream('deflate')
  const writer = stream.writable.getWriter()

  void writer.write(data).catch(() => undefined)
  void writer.close().catch(() => undefined)

  const reader = stream.readable.getReader()
  const parts: Uint8Array[] = []
  let totalLength = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    if (value) {
      parts.push(value)
      totalLength += value.length
    }
  }

  const merged = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }

  return merged
}

export async function readPngTextChunks(buffer: ArrayBuffer): Promise<Record<string, string>> {
  const bytes = new Uint8Array(buffer)

  if (bytes.length < 8 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    return {}
  }

  const view = new DataView(buffer)
  const decoder = new TextDecoder('utf-8')
  const chunks: Record<string, string> = {}
  let offset = 8
  let visited = 0

  while (offset + 8 <= bytes.length && visited < MAX_CHUNK_COUNT) {
    visited += 1

    const length = view.getUint32(offset)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    if (length < 0 || dataEnd > bytes.length || type === 'IEND') {
      break
    }

    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const data = bytes.subarray(dataStart, dataEnd)
      const keywordEnd = data.indexOf(0)

      if (keywordEnd > 0) {
        const keyword = decoder.decode(data.subarray(0, keywordEnd))

        try {
          if (type === 'tEXt') {
            chunks[keyword] = decoder.decode(data.subarray(keywordEnd + 1))
          } else if (type === 'zTXt') {
            // keyword \0 compressionMethod(1) compressedText
            chunks[keyword] = decoder.decode(await inflate(data.subarray(keywordEnd + 2)))
          } else {
            // keyword \0 compressionFlag(1) compressionMethod(1) language \0 translated \0 text
            const compressionFlag = data[keywordEnd + 1]
            const languageEnd = data.indexOf(0, keywordEnd + 3)
            const translatedEnd =
              languageEnd >= 0 ? data.indexOf(0, languageEnd + 1) : -1

            if (translatedEnd >= 0) {
              const text = data.subarray(translatedEnd + 1)
              chunks[keyword] =
                compressionFlag === 1 ? decoder.decode(await inflate(text)) : decoder.decode(text)
            }
          }
        } catch {
          // 개별 청크 해석 실패는 무시하고 나머지를 계속 읽는다.
        }
      }
    }

    offset = dataEnd + 4
  }

  return chunks
}

function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return ''
}

// NAI v4의 프롬프트는 caption.base_caption과 캐릭터별 char_caption으로 나뉜다.
function readV4Caption(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return ''
  }

  const caption = (node as { caption?: unknown }).caption

  if (!caption || typeof caption !== 'object') {
    return ''
  }

  const base = toText((caption as { base_caption?: unknown }).base_caption)
  const rawCharCaptions = (caption as { char_captions?: unknown }).char_captions
  const charCaptions = Array.isArray(rawCharCaptions)
    ? rawCharCaptions
        .map((entry) =>
          entry && typeof entry === 'object'
            ? toText((entry as { char_caption?: unknown }).char_caption)
            : '',
        )
        .filter(Boolean)
    : []

  return [base, ...charCaptions].filter(Boolean).join('\n')
}

function parseNovelAi(chunks: Record<string, string>): ParsedImageGeneration | null {
  if (!(chunks.Software ?? '').toLowerCase().includes('novelai')) {
    return null
  }

  let comment: Record<string, unknown> = {}

  try {
    const parsed = JSON.parse(chunks.Comment ?? '{}')

    if (parsed && typeof parsed === 'object') {
      comment = parsed as Record<string, unknown>
    }
  } catch {
    comment = {}
  }

  const width = toText(comment.width)
  const height = toText(comment.height)

  return {
    source: 'novelai',
    prompt: readV4Caption(comment.v4_prompt) || toText(comment.prompt) || toText(chunks.Description),
    meta: {
      negativePrompt: readV4Caption(comment.v4_negative_prompt) || toText(comment.uc),
      model: toText(chunks.Source),
      sampler: toText(comment.sampler),
      seed: toText(comment.seed),
      steps: toText(comment.steps),
      scale: toText(comment.scale),
      noiseSchedule: toText(comment.noise_schedule),
      size: width && height ? `${width}x${height}` : '',
    },
  }
}

function parseAutomatic1111(chunks: Record<string, string>): ParsedImageGeneration | null {
  const raw = chunks.parameters ?? ''

  if (!raw.trim()) {
    return null
  }

  const lines = raw.split(/\r?\n/)
  const lastLine = lines[lines.length - 1] ?? ''
  const hasSettingsLine = /(^|,\s*)Steps:\s*\d+/.test(lastLine)
  const settingsLine = hasSettingsLine ? lastLine : ''
  const bodyEnd = hasSettingsLine ? lines.length - 1 : lines.length
  const negativeIndex = lines.findIndex((line) => line.startsWith('Negative prompt:'))
  const promptEnd = negativeIndex >= 0 ? negativeIndex : bodyEnd
  const settings: Record<string, string> = {}

  for (const match of settingsLine.matchAll(/([A-Za-z][A-Za-z0-9 _-]*):\s*([^,]+)/g)) {
    settings[match[1].trim()] = match[2].trim()
  }

  return {
    source: 'automatic1111',
    prompt: lines.slice(0, promptEnd).join('\n').trim(),
    meta: {
      negativePrompt:
        negativeIndex >= 0
          ? lines
              .slice(negativeIndex, bodyEnd)
              .join('\n')
              .replace(/^Negative prompt:\s*/, '')
              .trim()
          : '',
      model: settings.Model ?? '',
      sampler: settings.Sampler ?? '',
      seed: settings.Seed ?? '',
      steps: settings.Steps ?? '',
      scale: settings['CFG scale'] ?? '',
      noiseSchedule: settings['Schedule type'] ?? '',
      size: settings.Size ?? '',
    },
  }
}

function hasAnyValue(parsed: ParsedImageGeneration) {
  return Boolean(parsed.prompt) || Object.values(parsed.meta).some(Boolean)
}

export async function readImageGenerationMetadata(
  file: File,
): Promise<ParsedImageGeneration | null> {
  const isPng =
    file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')

  if (!isPng) {
    return null
  }

  try {
    const chunks = await readPngTextChunks(await file.arrayBuffer())
    const parsed = parseNovelAi(chunks) ?? parseAutomatic1111(chunks)

    return parsed && hasAnyValue(parsed) ? parsed : null
  } catch {
    return null
  }
}
