import type { BriefSourceContentType } from '../projectWorkflow'

export const BRIEF_SOURCE_ACCEPT = '.pdf,.docx,.txt,.md'

const BRIEF_EXTENSIONS: Record<string, BriefSourceContentType> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
}

export interface ParsedBriefSource {
  fileName: string
  contentType: BriefSourceContentType
  extractedText: string
  sha256: string
}

export function briefContentTypeFromFile(file: File): BriefSourceContentType | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return BRIEF_EXTENSIONS[extension] ?? null
}

export async function sha256HexFromBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function parsePdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) pages.push(text)
  }
  return pages.join('\n\n').trim()
}

async function parseDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return result.value.replace(/\s+/g, ' ').trim()
}

async function parseText(file: File): Promise<string> {
  return (await file.text()).replace(/\r\n/g, '\n').trim()
}

export async function parseBriefFile(file: File): Promise<ParsedBriefSource> {
  const contentType = briefContentTypeFromFile(file)
  if (!contentType) {
    throw new Error('Unsupported brief format. Use PDF, DOCX, TXT, or Markdown.')
  }

  let extractedText = ''
  if (contentType === 'application/pdf') {
    extractedText = await parsePdf(file)
  } else if (
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    extractedText = await parseDocx(file)
  } else {
    extractedText = await parseText(file)
  }

  if (!extractedText.trim()) {
    throw new Error('No readable text was found in this brief.')
  }

  return {
    fileName: file.name,
    contentType,
    extractedText,
    sha256: await sha256HexFromBlob(file),
  }
}
