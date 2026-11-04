import { describe, expect, it } from 'vitest'
import { Schema, type Node } from '@prosekit/pm/model'
import { EditorState, NodeSelection, TextSelection, type Transaction } from '@prosekit/pm/state'
import { BulletRangeSelection } from './bullet-range-selection.ts'
import { extendBulletSelection, selectCurrentBlock } from './select-block-keymap.tsx'

// Mirrors the meowdown shapes that matter here: flat-list bullets are `list`
// nodes holding a paragraph plus nested lists, everything else sits directly
// under the doc.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    list: { group: 'block', content: 'block+' },
    codeBlock: { group: 'block', content: 'text*', code: true, marks: '' },
    text: { group: 'inline' },
  },
})

function paragraph(text: string): Node {
  return schema.nodes.paragraph.create(null, text === '' ? [] : [schema.text(text)])
}

function doc(...children: Node[]): Node {
  return schema.nodes.doc.create(null, children)
}

function stateWith(docNode: Node, anchor: number, head: number = anchor): EditorState {
  return EditorState.create({
    doc: docNode,
    selection: TextSelection.create(docNode, anchor, head),
  })
}

/** Runs the command; returns the dispatched node selection, or null. */
function runSelectBlock(state: EditorState): NodeSelection | null {
  const dispatched: Transaction[] = []
  const consumed = selectCurrentBlock(state, (transaction) => {
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
  expect(transaction.selection).toBeInstanceOf(NodeSelection)
  return transaction.selection instanceof NodeSelection ? transaction.selection : null
}

describe('selectCurrentBlock', () => {
  it('selects the whole paragraph node from a caret', () => {
    const state = stateWith(doc(paragraph('hello')), 3)
    const selection = runSelectBlock(state)
    expect(selection?.node.type.name).toBe('paragraph')
    expect(selection?.node.textContent).toBe('hello')
  })

  it('selects a bullet with its children, like the drag handle', () => {
    // doc > list( p("item"), list( p("sub") ) ) — caret in "item" selects the
    // outer bullet so a move/delete takes the subtree along.
    const docNode = doc(
      schema.nodes.list.create(null, [
        paragraph('item'),
        schema.nodes.list.create(null, [paragraph('sub')]),
      ]),
    )
    const selection = runSelectBlock(stateWith(docNode, 3))
    expect(selection?.node.type.name).toBe('list')
    expect(selection?.node.textContent).toBe('itemsub')
  })

  it('selects only the nested bullet from its own text', () => {
    const docNode = doc(
      schema.nodes.list.create(null, [
        paragraph('item'),
        schema.nodes.list.create(null, [paragraph('sub')]),
      ]),
    )
    let caret = -1
    docNode.descendants((node, pos) => {
      if (node.isText && node.text === 'sub') {
        caret = pos + 1
      }
      return true
    })
    expect(caret).toBeGreaterThan(0)
    const selection = runSelectBlock(stateWith(docNode, caret))
    expect(selection?.node.type.name).toBe('list')
    expect(selection?.node.textContent).toBe('sub')
  })

  it('selects the whole code block from inside it', () => {
    const docNode = doc(schema.nodes.codeBlock.create(null, [schema.text('one\ntwo')]))
    const selection = runSelectBlock(stateWith(docNode, 3))
    expect(selection?.node.type.name).toBe('codeBlock')
  })

  it('selects an empty paragraph', () => {
    const selection = runSelectBlock(stateWith(doc(paragraph('')), 1))
    expect(selection?.node.type.name).toBe('paragraph')
  })

  it('expands a selection inside one block to that block', () => {
    const selection = runSelectBlock(stateWith(doc(paragraph('hello')), 2, 4))
    expect(selection?.node.textContent).toBe('hello')
  })

  it('falls through when a node is already selected', () => {
    const docNode = doc(paragraph('hello'))
    const state = EditorState.create({
      doc: docNode,
      selection: NodeSelection.create(docNode, 0),
    })
    expect(runSelectBlock(state)).toBeNull()
  })

  it('falls through on a cross-block selection', () => {
    expect(runSelectBlock(stateWith(doc(paragraph('one'), paragraph('two')), 2, 8))).toBeNull()
  })
})

function bullet(text: string, ...children: Node[]): Node {
  return schema.nodes.list.create(null, [paragraph(text), ...children])
}

function extend(state: EditorState, direction: -1 | 1): EditorState {
  let next = state
  expect(
    extendBulletSelection(direction)(state, (transaction) => {
      next = state.apply(transaction)
    }),
  ).toBe(true)
  return next
}

describe('extendBulletSelection', () => {
  it('expands in both directions, shrinks to the anchor, and consumes boundaries', () => {
    const first = bullet('first')
    const middle = bullet('middle', bullet('child'))
    const last = bullet('last')
    const document = doc(first, middle, last)
    const initial = EditorState.create({
      doc: document,
      selection: NodeSelection.create(document, first.nodeSize),
    })
    const down = extend(initial, 1)
    expect(down.selection).toBeInstanceOf(BulletRangeSelection)
    expect(
      down.selection.content().content.textBetween(0, down.selection.content().content.size, '|'),
    ).toContain('child')
    expect([down.selection.from, down.selection.to]).toEqual([
      first.nodeSize,
      document.content.size,
    ])
    expect(extend(down, 1)).toBe(down)
    const contracted = extend(down, -1)
    expect(contracted.selection.eq(initial.selection)).toBe(true)
    const up = extend(contracted, -1)
    expect([up.selection.from, up.selection.to]).toEqual([0, first.nodeSize + middle.nodeSize])
    expect(extend(up, -1)).toBe(up)
    expect(extend(up, 1).selection.eq(initial.selection)).toBe(true)
  })

  it('deletes complete selected subtrees and leaves the next bullet intact', () => {
    const document = doc(bullet('first', bullet('child')), bullet('second'), bullet('keep'))
    const state = extend(
      EditorState.create({ doc: document, selection: NodeSelection.create(document, 0) }),
      1,
    )
    const next = state.apply(state.tr.deleteSelection())
    expect(next.doc.eq(doc(bullet('keep')))).toBe(true)
  })

  it('selects only siblings within a nested list', () => {
    const first = bullet('nested one')
    const second = bullet('nested two')
    const parentText = paragraph('parent')
    const document = doc(
      schema.nodes.list.create(null, [parentText, first, second]),
      bullet('outside'),
    )
    const start = 1 + parentText.nodeSize
    const state = extend(
      EditorState.create({ doc: document, selection: NodeSelection.create(document, start) }),
      1,
    )
    expect([state.selection.from, state.selection.to]).toEqual([
      start,
      start + first.nodeSize + second.nodeSize,
    ])
    expect(extend(state, 1)).toBe(state)
  })

  it('does not intercept ordinary text selections or cross a non-bullet block', () => {
    const document = doc(bullet('first'), paragraph('gap'), bullet('last'))
    expect(extendBulletSelection(1)(stateWith(document, 2))).toBe(false)
    const state = EditorState.create({
      doc: document,
      selection: NodeSelection.create(document, 0),
    })
    expect(extend(state, 1)).toBe(state)
  })

  it('round-trips JSON and maps bookmarks when content is inserted or deleted', () => {
    const first = bullet('first')
    const document = doc(first, bullet('second'), bullet('keep'))
    const selection = new BulletRangeSelection(document, 0, first.nodeSize)
    expect(BulletRangeSelection.fromJSON(document, selection.toJSON()).eq(selection)).toBe(true)
    const state = EditorState.create({ doc: document, selection })
    const transaction = state.tr.insert(0, paragraph('before'))
    expect(selection.map(transaction.doc, transaction.mapping).from).toBe(
      paragraph('before').nodeSize,
    )
    const deletion = state.tr.delete(0, first.nodeSize + document.child(1).nodeSize)
    expect(() => selection.getBookmark().map(deletion.mapping).resolve(deletion.doc)).not.toThrow()
  })
})
