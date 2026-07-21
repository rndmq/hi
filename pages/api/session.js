import { issueToken } from '../../lib/sessionToken'
import { sessionLimiter, getClientIp } from '../../lib/rateLimit'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const ip = getClientIp(req)
  const { success } = await sessionLimiter.limit(ip)
  if (!success) {
    return res.status(429).json({ error: 'Terlalu banyak request, coba lagi sebentar.' })
  }

  const token = issueToken()
  return res.status(200).json({ token, expiresInMs: 10 * 60 * 1000 })
}
