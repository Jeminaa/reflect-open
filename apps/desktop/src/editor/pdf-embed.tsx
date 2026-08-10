import { useMemo } from 'react'
import { definePlugin, type PlainExtension } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey, type EditorState } from '@prosekit/pm/state'
import { Decoration, DecorationSet } from '@prosekit/pm/view'

/**
 * Resolve a graph-relative asset source to a displayable URL, or nothing when
 * the source is unsafe or the graph is gone (the same contract as the editor's
 * `resolveImageUrl` prop, whose implementation this reuses).
 */
export type PdfUrlResolver = (source: string) => string | null | undefined

/** One inline PDF reference: its raw source and the position after its node. */
export interface PdfEmbedTarget {
  readonly source: string
  readonly pos: number
}

/** A4 portrait, the fallback when the PDF's own page box can't be read. */
const DEFAULT_PAGE_RATIO = Math.SQRT2

/**
 * Per-PDF view preferences, keyed by source. Module-level so a collapsed or
 * hand-resized preview survives decoration rebuilds and note switches within
 * the session; deliberately not persisted (a fresh launch starts tidy).
 */
interface EmbedPrefs {
  collapsed: boolean
  width?: number
  height?: number
}
const prefsBySource = new Map<string, EmbedPrefs>()

/** First-page height/width ratios already read from PDF bytes, by source. */
const ratioBySource = new Map<string, number>()

/**
 * A graph-local PDF reference worth embedding. Remote PDFs stay pills: the
 * CSP only frames `reflect-asset:` content, and framing arbitrary remote
 * documents inside notes would be a tracking surface.
 */
function isEmbeddablePdf(source: string): boolean {
  return source.startsWith('assets/') && source.toLowerCase().endsWith('.pdf')
}

/**
 * Every inline PDF reference in `doc`: text carrying meowdown's `mdImage`
 * mark (an `![](assets/….pdf)` embed) or `mdFile` mark (a claimed file-pill
 * link). The widget anchors after the node so the pill/label stays intact.
 */
export function pdfEmbedTargets(doc: ProseMirrorNode): PdfEmbedTarget[] {
  const targets: PdfEmbedTarget[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) {
      return true
    }
    for (const mark of node.marks) {
      const source: unknown =
        mark.type.name === 'mdImage'
          ? mark.attrs['src']
          : mark.type.name === 'mdFile'
            ? mark.attrs['href']
            : null
      if (typeof source === 'string' && isEmbeddablePdf(source)) {
        targets.push({ source, pos: pos + node.nodeSize })
        break
      }
    }
    return true
  })
  return targets
}

/**
 * First page height/width ratio from raw PDF text, or null. Reads the first
 * `/MediaBox [x0 y0 x1 y1]`, honouring a neighbouring `/Rotate 90|270`.
 * Best-effort by design: object-stream-compressed PDFs hide their page
 * dictionaries, and those fall back to A4.
 */
export function parsePageRatio(pdfText: string): number | null {
  const box = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(
    pdfText,
  )
  if (box === null) {
    return null
  }
  const width = Math.abs(Number(box[3]) - Number(box[1]))
  const height = Math.abs(Number(box[4]) - Number(box[2]))
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  const rotated = /\/Rotate\s+(?:90|270)/.test(pdfText.slice(box.index, box.index + 400))
  return rotated ? width / height : height / width
}

/** Fetch the PDF once and cache its first-page ratio; apply it via `apply`. */
function ensurePageRatio(url: string, source: string, apply: (ratio: number) => void): void {
  const known = ratioBySource.get(source)
  if (known !== undefined) {
    apply(known)
    return
  }
  fetch(url)
    .then(async (response) => {
      const bytes = new Uint8Array(await response.arrayBuffer())
      // Page dictionaries sit early in scanner/office PDFs; 256 KiB is plenty
      // and keeps huge scans from being decoded wholesale.
      const head = bytes.subarray(0, 256 * 1024)
      let text = ''
      const chunk = 0x8000
      for (let offset = 0; offset < head.length; offset += chunk) {
        text += String.fromCharCode(...head.subarray(offset, offset + chunk))
      }
      const ratio = parsePageRatio(text) ?? DEFAULT_PAGE_RATIO
      ratioBySource.set(source, ratio)
      apply(ratio)
    })
    .catch(() => {
      ratioBySource.set(source, DEFAULT_PAGE_RATIO)
    })
}

function prefsFor(source: string): EmbedPrefs {
  let prefs = prefsBySource.get(source)
  if (prefs === undefined) {
    prefs = { collapsed: false }
    prefsBySource.set(source, prefs)
  }
  return prefs
}

const COLLAPSED_LABEL = 'PDF 미리보기 펼치기'
const EXPANDED_LABEL = 'PDF 미리보기 접기'

function pdfWidget(url: string, source: string): HTMLElement {
  const prefs = prefsFor(source)

  const container = document.createElement('div')
  container.className = 'reflect-pdf-embed'
  container.contentEditable = 'false'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'reflect-pdf-embed-toggle'

  const box = document.createElement('div')
  box.className = 'reflect-pdf-embed-box'

  const frame = document.createElement('iframe')
  frame.src = url
  frame.title = source
  box.appendChild(frame)

  // One page tall by default: the box keeps the page's aspect ratio until the
  // user drags their own size, which then wins for the session.
  const applyRatio = (ratio: number): void => {
    if (prefs.width === undefined && prefs.height === undefined) {
      box.style.aspectRatio = `1 / ${ratio}`
    }
  }
  if (prefs.width !== undefined && prefs.height !== undefined) {
    box.style.width = `${prefs.width}px`
    box.style.height = `${prefs.height}px`
  } else {
    applyRatio(ratioBySource.get(source) ?? DEFAULT_PAGE_RATIO)
    ensurePageRatio(url, source, applyRatio)
  }

  // The native bottom-right resizer writes inline width/height; remember them
  // so rebuilds (and revisits) keep the hand-picked size.
  const observer = new ResizeObserver(() => {
    if (box.style.width !== '' && box.style.height !== '') {
      prefs.width = box.offsetWidth
      prefs.height = box.offsetHeight
    }
  })
  observer.observe(box)

  const render = (): void => {
    container.dataset['collapsed'] = prefs.collapsed ? 'true' : 'false'
    toggle.textContent = prefs.collapsed ? '▸' : '▾'
    toggle.setAttribute('aria-label', prefs.collapsed ? COLLAPSED_LABEL : EXPANDED_LABEL)
    toggle.title = prefs.collapsed ? COLLAPSED_LABEL : EXPANDED_LABEL
  }
  toggle.addEventListener('click', (event) => {
    event.preventDefault()
    prefs.collapsed = !prefs.collapsed
    render()
  })
  render()

  container.appendChild(toggle)
  container.appendChild(box)
  return container
}

interface PdfEmbedState {
  readonly decorations: DecorationSet
  readonly fingerprint: string
}

const pdfEmbedKey = new PluginKey<PdfEmbedState>('reflectPdfEmbed')

/**
 * The identity of a scan result. While it is unchanged, doc changes only
 * remap existing decorations, so the widgets' iframes never reload on
 * ordinary typing around them.
 */
function fingerprint(targets: PdfEmbedTarget[]): string {
  return targets.map((target) => target.source).join(' ')
}

function buildState(doc: ProseMirrorNode, resolveUrl: PdfUrlResolver): PdfEmbedState {
  const targets = pdfEmbedTargets(doc)
  const occurrenceBySource = new Map<string, number>()
  const decorations: Decoration[] = []
  for (const target of targets) {
    const url = resolveUrl(target.source)
    if (typeof url !== 'string') {
      continue
    }
    // Keyed by source + occurrence, not position: a stable key preserves the
    // widget's DOM across rebuilds, so the PDF doesn't flicker or re-fetch
    // when an edit elsewhere shifts its position.
    const occurrence = occurrenceBySource.get(target.source) ?? 0
    occurrenceBySource.set(target.source, occurrence + 1)
    decorations.push(
      Decoration.widget(target.pos, () => pdfWidget(url, target.source), {
        key: `pdf ${target.source} ${occurrence}`,
        side: 1,
      }),
    )
  }
  return {
    decorations: DecorationSet.create(doc, decorations),
    fingerprint: fingerprint(targets),
  }
}

/**
 * Renders every graph-local PDF reference as an inline preview under its
 * pill/label: a widget decoration hosting WKWebView's native PDF viewer in an
 * iframe on the `reflect-asset:` protocol, sized to the document's first
 * page, hand-resizable from its corner, and collapsible from the gutter
 * toggle. Meowdown's pill stays the editing surface; the widget is read-only
 * chrome the serializer never sees, so the markdown round-trip is untouched.
 */
function definePdfEmbed(resolveUrl: PdfUrlResolver): PlainExtension {
  return definePlugin(
    new Plugin<PdfEmbedState>({
      key: pdfEmbedKey,
      state: {
        init: (_config, state) => buildState(state.doc, resolveUrl),
        apply: (tr, previous) => {
          if (!tr.docChanged) {
            return previous
          }
          const fresh = pdfEmbedTargets(tr.doc)
          if (fingerprint(fresh) === previous.fingerprint) {
            return {
              decorations: previous.decorations.map(tr.mapping, tr.doc),
              fingerprint: previous.fingerprint,
            }
          }
          return buildState(tr.doc, resolveUrl)
        },
      },
      props: {
        decorations: (state: EditorState) => pdfEmbedKey.getState(state)?.decorations ?? null,
      },
    }),
  )
}

/** Mounts the PDF embed plugin inside the editor's ProseKit context. */
export function PdfEmbeds({ resolveUrl }: { resolveUrl: PdfUrlResolver }): null {
  const extension = useMemo(() => definePdfEmbed(resolveUrl), [resolveUrl])
  useExtension(extension)
  return null
}
