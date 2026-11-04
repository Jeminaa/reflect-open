import type { Node } from '@prosekit/pm/model'
import {
  NodeSelection,
  Selection,
  SelectionRange,
  TextSelection,
  type SelectionBookmark,
} from '@prosekit/pm/state'
import type { Mappable } from '@prosekit/pm/transform'
import { z } from 'zod'

const selectionSchema = z.object({ anchorBullet: z.number().int(), headBullet: z.number().int() })

function isBulletAt(doc: Node, position: number): boolean {
  return position >= 0 && position < doc.content.size && doc.nodeAt(position)?.type.name === 'list'
}

/** A whole-node selection of adjacent sibling bullets, including their children. */
export class BulletRangeSelection extends Selection {
  readonly anchorBullet: number
  readonly headBullet: number
  override visible = false

  constructor(doc: Node, anchorBullet: number, headBullet: number) {
    const anchorNode = doc.nodeAt(anchorBullet)
    const headNode = doc.nodeAt(headBullet)
    if (
      !isBulletAt(doc, anchorBullet) ||
      !isBulletAt(doc, headBullet) ||
      !doc.resolve(anchorBullet).sameParent(doc.resolve(headBullet)) ||
      !anchorNode ||
      !headNode
    ) {
      throw new RangeError('Bullet selection endpoints must be sibling bullets')
    }
    const forward = headBullet >= anchorBullet
    const boundaryAnchor = doc.resolve(forward ? anchorBullet : anchorBullet + anchorNode.nodeSize)
    const boundaryHead = doc.resolve(forward ? headBullet + headNode.nodeSize : headBullet)
    const text = TextSelection.between(boundaryAnchor, boundaryHead)
    super(text.$anchor, text.$head, [
      new SelectionRange(
        doc.resolve(Math.min(boundaryAnchor.pos, boundaryHead.pos)),
        doc.resolve(Math.max(boundaryAnchor.pos, boundaryHead.pos)),
      ),
    ])
    this.anchorBullet = anchorBullet
    this.headBullet = headBullet
  }

  override eq(other: Selection): boolean {
    return (
      other instanceof BulletRangeSelection &&
      other.anchorBullet === this.anchorBullet &&
      other.headBullet === this.headBullet
    )
  }

  override map(doc: Node, mapping: Mappable): Selection {
    return this.getBookmark().map(mapping).resolve(doc)
  }

  override toJSON(): { type: string; anchorBullet: number; headBullet: number } {
    return {
      type: 'reflect-bullet-range',
      anchorBullet: this.anchorBullet,
      headBullet: this.headBullet,
    }
  }

  /** Restore a validated selection from persisted editor state. */
  static override fromJSON(doc: Node, value: unknown): BulletRangeSelection {
    const { anchorBullet, headBullet } = selectionSchema.parse(value)
    return new BulletRangeSelection(doc, anchorBullet, headBullet)
  }

  override getBookmark(): SelectionBookmark {
    return bulletBookmark(this.anchorBullet, this.headBullet)
  }
}

function bulletBookmark(anchor: number, head: number): SelectionBookmark {
  return {
    map(mapping) {
      return bulletBookmark(mapping.map(anchor, 1), mapping.map(head, 1))
    },
    resolve(doc) {
      if (
        isBulletAt(doc, anchor) &&
        isBulletAt(doc, head) &&
        doc.resolve(anchor).sameParent(doc.resolve(head))
      ) {
        return anchor === head
          ? NodeSelection.create(doc, anchor)
          : new BulletRangeSelection(doc, anchor, head)
      }
      return Selection.near(doc.resolve(Math.max(0, Math.min(head, doc.content.size))))
    },
  }
}

Selection.jsonID('reflect-bullet-range', BulletRangeSelection)
