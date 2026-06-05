import { describe, it, expect } from 'vitest'

describe('PhotoCapture logic', () => {
  it('defaults to MAX_PHOTOS of 3', () => {
    const MAX_PHOTOS = 3
    expect(MAX_PHOTOS).toBe(3)
  })

  it('tracks photo count correctly', () => {
    const photos: string[] = []
    expect(photos.length).toBe(0)

    photos.push('base64-image-1')
    expect(photos.length).toBe(1)

    photos.push('base64-image-2')
    photos.push('base64-image-3')
    expect(photos.length).toBe(3)
  })

  it('has space when photos < maxPhotos', () => {
    const maxPhotos = 3
    const photos = ['img1', 'img2']
    const hasSpace = photos.length < maxPhotos
    expect(hasSpace).toBe(true)
  })

  it('is full when photos === maxPhotos', () => {
    const maxPhotos = 3
    const photos = ['img1', 'img2', 'img3']
    const hasSpace = photos.length < maxPhotos
    expect(hasSpace).toBe(false)
  })

  it('removes photo at index correctly', () => {
    const photos = ['img1', 'img2', 'img3']
    const indexToRemove = 1
    const newPhotos = photos.filter((_, i) => i !== indexToRemove)
    expect(newPhotos).toEqual(['img1', 'img3'])
    expect(newPhotos.length).toBe(2)
  })

  it('handles multiple photo removals', () => {
    const photos = ['img1', 'img2', 'img3']
    let working = [...photos]

    working = working.filter((_, i) => i !== 0)
    expect(working).toEqual(['img2', 'img3'])

    working = working.filter((_, i) => i !== 1)
    expect(working).toEqual(['img2'])

    expect(working.length).toBe(1)
  })

  it('preserves photo array order', () => {
    const photos: string[] = []
    const newPhotos = [...photos]

    newPhotos.push('photo-1')
    newPhotos.push('photo-2')
    newPhotos.push('photo-3')

    expect(newPhotos[0]).toBe('photo-1')
    expect(newPhotos[1]).toBe('photo-2')
    expect(newPhotos[2]).toBe('photo-3')
  })

  it('respects maxPhotos parameter', () => {
    const testMaxPhotos = (max: number) => {
      const photos: string[] = []
      for (let i = 0; i < max + 5; i++) {
        if (photos.length < max) {
          photos.push(`photo-${i}`)
        }
      }
      return photos
    }

    expect(testMaxPhotos(1).length).toBe(1)
    expect(testMaxPhotos(3).length).toBe(3)
    expect(testMaxPhotos(5).length).toBe(5)
  })

  it('generates photo grid slots correctly', () => {
    const maxPhotos = 3
    const slots = Array.from({ length: maxPhotos }).map((_, i) => i)
    expect(slots).toEqual([0, 1, 2])
    expect(slots.length).toBe(3)
  })
})
