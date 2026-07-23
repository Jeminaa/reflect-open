import { describe, expect, it } from 'vitest'
import { Schema, type Node } from '@prosekit/pm/model'
import { parsePageRatio, pdfEmbedTargets } from './pdf-embed'

// Mirrors the meowdown shapes that matter here: PDF references live as
// `mdImage`/`mdFile` marks on inline text, never as their own nodes.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: {
    mdImage: { attrs: { src: {} } },
    mdFile: { attrs: { href: {} } },
  },
})

function docWith(...paragraphChildren: Node[][]): Node {
  return schema.nodes.doc.create(
    null,
    paragraphChildren.map((children) => schema.nodes.paragraph.create(null, children)),
  )
}

describe('pdfEmbedTargets', () => {
  it('finds a graph-local PDF image embed and anchors after its node', () => {
    const doc = docWith([
      schema.text('침대 '),
      schema.text('명세서', [schema.marks.mdImage.create({ src: 'assets/스캔.pdf' })]),
    ])
    // positions: doc(0) p(1) "침대 "(1..4) "명세서"(4..7) → widget at 7.
    expect(pdfEmbedTargets(doc)).toEqual([{ source: 'assets/스캔.pdf', pos: 7 }])
  })

  it('finds a PDF file pill through its mdFile href', () => {
    const doc = docWith([
      schema.text('계약서.pdf', [schema.marks.mdFile.create({ href: 'assets/계약서.PDF' })]),
    ])
    expect(pdfEmbedTargets(doc)).toEqual([{ source: 'assets/계약서.PDF', pos: 8 }])
  })

  it('ignores non-PDF assets and remote PDFs', () => {
    const doc = docWith([
      schema.text('사진', [schema.marks.mdImage.create({ src: 'assets/사진.png' })]),
      schema.text('원격', [schema.marks.mdFile.create({ href: 'https://example.com/a.pdf' })]),
      schema.text('탈출', [schema.marks.mdFile.create({ href: 'notes/../assets/x.pdf' })]),
    ])
    expect(pdfEmbedTargets(doc)).toEqual([])
  })

  it('reports every occurrence of a repeated reference', () => {
    const pill = (): Node =>
      schema.text('영수증', [schema.marks.mdFile.create({ href: 'assets/영수증.pdf' })])
    const doc = docWith([pill()], [pill()])
    expect(pdfEmbedTargets(doc)).toHaveLength(2)
  })
})

describe('parsePageRatio', () => {
  it('reads an A4 MediaBox', () => {
    expect(parsePageRatio('<< /Type /Page /MediaBox [0 0 595.28 841.89] >>')).toBeCloseTo(
      841.89 / 595.28,
    )
  })

  it('inverts the ratio for a rotated page', () => {
    expect(parsePageRatio('/MediaBox [0 0 595 842] /Rotate 90')).toBeCloseTo(595 / 842)
  })

  it('returns null without a page box or with a degenerate one', () => {
    expect(parsePageRatio('%PDF-1.7 no boxes here')).toBeNull()
    expect(parsePageRatio('/MediaBox [0 0 0 842]')).toBeNull()
  })
})
