import crypto from 'crypto'

// Secret HANYA ada di server (env var), tidak pernah dikirim ke client.
// Generate sekali dan simpan di Vercel env vars, misal:
//   openssl rand -hex 32
const SECRET = process.env.SESSION_TOKEN_SECRET

const TOKEN_TTL_MS = 10 * 60 * 1000 // 10 menit

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}

// Token berbentuk: "<expiresAt>.<random>.<signature>"
// - expiresAt: timestamp ms kapan token kadaluarsa
// - random: nonce supaya token tidak bisa ditebak/diulang polanya
// - signature: HMAC-SHA256(expiresAt.random, SECRET) — tanpa SECRET,
//   signature ini mustahil dipalsukan walau attacker tau format tokennya
//   persis (karena baca source code JS di browser).
export function issueToken() {
  if (!SECRET) throw new Error('SESSION_TOKEN_SECRET belum di-set di env')
  const expiresAt = Date.now() + TOKEN_TTL_MS
  const nonce = crypto.randomBytes(12).toString('base64url')
  const payload = `${expiresAt}.${nonce}`
  const sig = sign(payload)
  return `${payload}.${sig}`
}

export function verifyToken(token) {
  if (!SECRET) throw new Error('SESSION_TOKEN_SECRET belum di-set di env')
  if (!token || typeof token !== 'string') return { valid: false, reason: 'missing' }

  const parts = token.split('.')
  if (parts.length !== 3) return { valid: false, reason: 'malformed' }

  const [expiresAtStr, nonce, sig] = parts
  const payload = `${expiresAtStr}.${nonce}`
  const expected = sign(payload)

  // timingSafeEqual butuh panjang buffer sama, dan mencegah timing attack
  // saat membandingkan signature.
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'bad_signature' }
  }

  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return { valid: false, reason: 'expired' }
  }

  return { valid: true }
}
