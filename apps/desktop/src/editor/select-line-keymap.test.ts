import { describe, expect, it } from 'vitest'
import { Schema, type Node } from '@prosekit/pm/model'
import { EditorState, TextSelection, type Transaction } from '@prosekit/pm/state'
import { selectCurrentLine } from './select-line-keymap'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    codeBlock: { group: 'block', content: 'text*', code: true, marks: '' },
    text: { group: 'inline' },
  },
})

function paragraph(text: string): Node {
  return schema.nodes.paragraph.create(null, text === '' ? [] : [schema.text(text)])
}

function codeBlock(text: string): Node {
  return schema.nodes.codeBlock.create(null, [schema.text(text)])
}

function stateWith(doc: Node, anchor: number, head: number = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, anchor, head),
  })
}

/** Runs the command; returns the selection range it dispatched, or null. */
function runSelectLine(state: EditorState): { from: number; to: number } | null {
  const dispatched: Transaction[] = []
  const consumed = selectCurrentLine(state, (transaction) => {
    dispatched.push(transaction)
  })
  if (!consumed) {
    expect(dispatched).toHaveLength(0)
    return null
  }
  const transaction = dispatched[0]
  if (transaction === undefined) {
    throw new Error('the command consumed the key without dispatching')
  }
  return { from: transaction.selection.from, to: transaction.selection.to }
}

describe('selectCurrentLine', () => {
  it('expands a caret to the whole paragraph text', () => {
    // doc: <p>hello</p> — content spans positions 1..6.
    const doc = schema.nodes.doc.create(null, [paragraph('hello')])
    expect(runSelectLine(stateWith(doc, 3))).toEqual({ from: 1, to: 6 })
  })

  it('selects only the caret paragraph among several', () => {
    // <p>one</p><p>two</p> — second paragraph content spans 6..9.
    const doc = schema.nodes.doc.create(null, [paragraph('one'), paragraph('two')])
    expect(runSelectLine(stateWith(doc, 7))).toEqual({ from: 6, to: 9 })
  })

  it('expands a partial in-line selection to the full line', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('hello')])
    expect(runSelectLine(stateWith(doc, 2, 4))).toEqual({ from: 1, to: 6 })
  })

  it('falls through when the line is already fully selected', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('hello')])
    expect(runSelectLine(stateWith(doc, 1, 6))).toBeNull()
  })

  it('falls through on a cross-block selection', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('one'), paragraph('two')])
    expect(runSelectLine(stateWith(doc, 2, 8))).toBeNull()
  })

  it('falls through on an empty paragraph', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('')])
    expect(runSelectLine(stateWith(doc, 1))).toBeNull()
  })

  describe('code blocks', () => {
    // <code>one\ntwo\nthree</code> — content starts at position 1;
    // "one" spans 1..4, "two" 5..8, "three" 9..14.
    const doc = schema.nodes.doc.create(null, [codeBlock('one\ntwo\nthree')])

    it('selects the newline-delimited line at the caret', () => {
      expect(runSelectLine(stateWith(doc, 6))).toEqual({ from: 5, to: 8 })
    })

    it('selects the first line from its start', () => {
      expect(runSelectLine(stateWith(doc, 1))).toEqual({ from: 1, to: 4 })
    })

    it('selects the last line to the block end', () => {
      expect(runSelectLine(stateWith(doc, 14))).toEqual({ from: 9, to: 14 })
    })

    it('treats a caret at a line end as on that line', () => {
      expect(runSelectLine(stateWith(doc, 4))).toEqual({ from: 1, to: 4 })
    })
  })
})
