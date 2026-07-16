import { describe, expect, it } from 'vitest'
import { Schema, type Node } from '@prosekit/pm/model'
import { EditorState, NodeSelection, TextSelection, type Transaction } from '@prosekit/pm/state'
import { selectCurrentBlock } from './select-block-keymap'

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
