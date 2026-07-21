import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Butuh 2 env var (didapat gratis dari upstash.com, format Redis REST):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

// Sliding window: max 15 request per 60 detik per IP.
// Ganti angkanya sesuai kebutuhan (mis. lebih ketat kalau device kamu
// dikit, atau lebih longgar kalau upload beruntun banyak file).
export const messagesLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(15, '60 s'),
  prefix: 'ratelimit:messages',
  analytics: false,
})

// Limit terpisah & lebih longgar untuk endpoint /api/session, karena ini
// dipanggil sekali tiap buka halaman (bukan tiap kirim pesan).
export const sessionLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '60 s'),
  prefix: 'ratelimit:session',
  analytics: false,
})

// Ambil IP asli client di belakang proxy Vercel.
export function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (fwd) return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}
