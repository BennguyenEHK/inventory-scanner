let sessionCounter = 0

export function resetCounter(): void {
  sessionCounter = 0
}

export function generateItemId(): string {
  sessionCounter++
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const seq = String(sessionCounter).padStart(4, '0')
  return `INV-${date}-${seq}`
}
