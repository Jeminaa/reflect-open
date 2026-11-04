import { definePlugin } from '@prosekit/core'
import { Decoration, DecorationSet } from '@prosekit/pm/view'
import { BulletRangeSelection } from './bullet-range-selection.ts'
import { useExtension, useKeymap } from '@meowdown/react'
import { NodeSelection, Plugin, type EditorState, type Transaction } from '@prosekit/pm/state'

/**
 * The depth of the block to select for the caret's position: the ancestor
 * just above the caret's textblock (a flat-list bullet with its children, a
 * blockquote), or the textblock itself when its parent is the doc (plain
 * paragraph, heading, code block). Null when neither is selectable.
 */
function blockDepthFor(state: EditorState): number | null {
  const { $from } = state.selection
  const above = $from.depth - 1
  if (above >= 1 && NodeSelection.isSelectable($from.node(above))) {
    return above
  }
  if ($from.depth >= 1 && NodeSelection.isSelectable($from.parent)) {
    return $from.depth
  }
  return null
}

/**
 * Select the block under the caret as a node — the same selection the
 * drag-handle grip produces, so the block can be moved (Alt-↑/↓), deleted,
 * or replaced whole. Falls through — returns false without dispatching — when
 * a node is already selected or the selection spans blocks, so the next
 * Escape handler (meowdown's low-priority collapse) still runs and the key
 * toggles between "block selected" and "caret".
 */
export function selectCurrentBlock(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { selection } = state
  if (selection instanceof NodeSelection) {
    return false
  }
  const { $from, $to } = selection
  if (!$from.parent.isTextblock || !$from.sameParent($to)) {
    return false
  }
  const depth = blockDepthFor(state)
  if (depth === null) {
    return false
  }
  dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, $from.before(depth))))
  return true
}

/** Expand or shrink a selected bullet range by one sibling, without splitting subtrees. */
export function extendBulletSelection(direction: -1 | 1) {
  return (state: EditorState, dispatch?: (transaction: Transaction) => void): boolean => {
    const { selection, doc } = state
    const range = selection instanceof BulletRangeSelection ? selection : null
    if (
      range === null &&
      !(selection instanceof NodeSelection && selection.node.type.name === 'list')
    ) {
      return false
    }
    const anchor = range?.anchorBullet ?? selection.from
    const head = range?.headBullet ?? selection.from
    const resolved = doc.resolve(head)
    const current = resolved.nodeAfter
    const neighbor =
      direction < 0 ? resolved.nodeBefore : doc.resolve(head + (current?.nodeSize ?? 0)).nodeAfter
    // Consume the key at the sibling-list boundary so native text selection cannot take over.
    if (!current || neighbor?.type.name !== 'list') return true
    const next = direction < 0 ? head - neighbor.nodeSize : head + current.nodeSize
    dispatch?.(
      state.tr
        .setSelection(
          next === anchor
            ? NodeSelection.create(doc, anchor)
            : new BulletRangeSelection(doc, anchor, next),
        )
        .scrollIntoView(),
    )
    return true
  }
}

const SELECT_BLOCK_KEYMAP = {
  Escape: selectCurrentBlock,
  'Shift-ArrowUp': extendBulletSelection(-1),
  'Shift-ArrowDown': extendBulletSelection(1),
}

const bulletSelectionExtension = definePlugin(
  new Plugin({
    props: {
      createSelectionBetween(view, anchor, head) {
        const selection = view.state.selection
        return selection instanceof BulletRangeSelection &&
          anchor.pos === selection.anchor &&
          head.pos === selection.head
          ? selection
          : null
      },
      decorations(state) {
        if (!(state.selection instanceof BulletRangeSelection)) return null
        const decorations: Decoration[] = []
        for (let position = state.selection.from; position < state.selection.to;) {
          const node = state.doc.nodeAt(position)
          if (!node) break
          decorations.push(
            Decoration.node(position, position + node.nodeSize, {
              class: 'reflect-bullet-selected',
            }),
          )
          position += node.nodeSize
        }
        return DecorationSet.create(state.doc, decorations)
      },
    },
  }),
)

/**
 * Binds Escape inside the editor's ProseKit context to {@link selectCurrentBlock}.
 * Default priority: below the task editor's exit-edit Escape (Priority.high)
 * and meowdown's pending-replacement discard, above meowdown's low-priority
 * selection collapse.
 */
export function SelectBlockKeymap(): null {
  useExtension(bulletSelectionExtension)
  useKeymap(SELECT_BLOCK_KEYMAP)
  return null
}
