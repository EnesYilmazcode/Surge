import assert from 'node:assert/strict'
import test from 'node:test'
import { BOARD_HOLES, nearestHole } from '../src/data/breadboard.ts'

test('breadboard has unique socket IDs and separated terminal strips', () => {
  assert.equal(BOARD_HOLES.length, 420)
  assert.equal(new Set(BOARD_HOLES.map((hole) => hole.id)).size, 420)
  const find = (id) => BOARD_HOLES.find((hole) => hole.id === id)
  assert.equal(find('a:1').node, find('e:1').node)
  assert.notEqual(find('e:1').node, find('f:1').node)
  assert.notEqual(find('a:1').node, find('a:2').node)
  assert.equal(find('top-plus:1').node, find('top-plus:30').node)
  assert.notEqual(find('top-plus:1').node, find('bottom-plus:1').node)
})

test('placement snaps to sockets and rejects the channel and out-of-bounds clicks', () => {
  const hole = BOARD_HOLES.find((item) => item.id === 'd:12')
  assert.equal(nearestHole(hole.x + 0.05, hole.z - 0.04)?.id, hole.id)
  assert.equal(nearestHole(0, 0), null)
  assert.equal(nearestHole(100, 100), null)
  assert.equal(nearestHole(NaN, 0), null)
})
