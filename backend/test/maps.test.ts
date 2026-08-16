import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BBOX_GRID_DEG, quantizeBbox } from '../src/maps.ts'

describe('quantizeBbox', () => {
  it('expands outward onto the grid', () => {
    assert.equal(quantizeBbox('54.370410,10.470927,54.395485,10.522751'), '54.3700,10.4700,54.4000,10.5300')
  })

  it('normalizes inverted corners', () => {
    assert.equal(quantizeBbox('54.40,10.53,54.37,10.47'), '54.3700,10.4700,54.4000,10.5300')
  })

  it('gives tiny routes a non-zero grid cell', () => {
    const q = quantizeBbox('54.3712,10.4811,54.3712,10.4811')
    const [minLat, minLng, maxLat, maxLng] = q.split(',').map(Number)
    assert.ok(maxLat - minLat >= BBOX_GRID_DEG - 1e-9)
    assert.ok(maxLng - minLng >= BBOX_GRID_DEG - 1e-9)
  })

  it('makes nearby floating bboxes share one key', () => {
    const a = quantizeBbox('54.370410,10.470927,54.395485,10.522751')
    const b = quantizeBbox('54.370500,10.471000,54.395400,10.522700')
    assert.equal(a, b)
  })
})
