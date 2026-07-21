// Helper sisi browser: ambil token dari /api/session, cache di memory,
// dan otomatis refresh kalau sudah/mau expired. Dipakai sebelum tiap
// POST/DELETE ke /api/messages supaya request selalu bawa header
// x-ls-token yang valid.

let cachedToken = null
let cachedExpiresAt = 0
let inFlight = null

const REFRESH_MARGIN_MS = 15 * 1000 // minta token baru 15 detik sebelum expired

async function fetchNewToken() {
  const res = await fetch('/api/session')
  if (!res.ok) {
    throw new Error('Gagal mengambil token sesi')
  }
  const data = await res.json()
  cachedToken = data.token
  cachedExpiresAt = Date.now() + (data.expiresInMs || 0)
  return cachedToken
}

export async function getSessionToken() {
  const stillValid = cachedToken && Date.now() < cachedExpiresAt - REFRESH_MARGIN_MS
  if (stillValid) return cachedToken

  // Hindari beberapa pemanggil sekaligus memicu banyak request /api/session
  // bersamaan (mis. kirim teks + upload beberapa file dalam waktu berdekatan).
  if (!inFlight) {
    inFlight = fetchNewToken().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

// Dipanggil kalau server balas 401 (token ditolak) — buang cache supaya
// panggilan berikutnya paksa ambil token baru, lalu request pemanggil
// biasanya di-retry sekali oleh caller.
export function invalidateSessionToken() {
  cachedToken = null
  cachedExpiresAt = 0
}
