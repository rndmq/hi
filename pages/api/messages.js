import { createClient } from '@supabase/supabase-js'
import { messagesLimiter, getClientIp } from '../../lib/rateLimit'
import { verifyToken } from '../../lib/sessionToken'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Cek token sesi (header x-ls-token) + rate limit per-IP. Dipakai untuk
// method yang mengubah data (POST, DELETE) supaya request random dari
// curl/Termux/shell tanpa token valid langsung ditolak, dan walau ada
// yang berhasil dapat token, jumlah requestnya tetap dibatasi.
async function guardMutatingRequest(req, res) {
  const ip = getClientIp(req)
  const { success, remaining } = await messagesLimiter.limit(ip)
  res.setHeader('X-RateLimit-Remaining', String(remaining ?? 0))
  if (!success) {
    res.status(429).json({ error: 'Terlalu banyak request. Coba lagi sebentar.' })
    return false
  }

  const token = req.headers['x-ls-token']
  const { valid, reason } = verifyToken(token)
  if (!valid) {
    res.status(401).json({ error: `Token sesi tidak valid (${reason}). Muat ulang halaman.` })
    return false
  }

  return true
}

// Public URL Supabase Storage bentuknya:
//   https://{project}.supabase.co/storage/v1/object/public/localshare/uploads/{filename}
// jadi path storage-nya = semua setelah "uploads/" (termasuk "uploads/" itu
// sendiri, karena begitu juga cara filePath dibuat waktu upload).
function extractStoragePath(url) {
  const match = url?.match(/uploads\/(.+)$/)
  return match ? `uploads/${match[1]}` : null
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'POST') {
  if (!(await guardMutatingRequest(req, res))) return

  const { content, type, device_label, file_name, file_size, file_type } = req.body
  if (!content) return res.status(400).json({ error: 'Content required' })

  const { data, error } = await supabase
    .from('messages')
    .insert([{
      content,
      type: type || 'text',
      device_label: device_label || 'Unknown',
      file_name: file_name || null,
      file_size: file_size || null,
      file_type: file_type || null,
    }])
    .select()
    .single()

  // tambahin ini
  if (error) {
    console.error('SUPABASE ERROR:', JSON.stringify(error))
    return res.status(500).json({ error: error.message })
  }
  return res.status(200).json(data)
}

  if (req.method === 'DELETE') {
    if (!(await guardMutatingRequest(req, res))) return

    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'ID required' })

    // Ambil dulu row-nya SEBELUM dihapus dari DB, supaya kalau ini pesan
    // tipe 'file' kita tau path storage-nya dan bisa ikut dihapus dari
    // bucket. INI YANG SEBELUMNYA HILANG — dulu endpoint ini cuma menghapus
    // row-nya dari tabel messages, file aslinya tidak pernah kesentuh sama
    // sekali di Storage. Makanya di UI keliatan udah kehapus (row-nya emang
    // beneran hilang, realtime langsung update feed), tapi di bucket
    // Supabase Storage file-nya numpuk terus selamanya.
    const { data: msg, error: fetchError } = await supabase
      .from('messages')
      .select('type, content')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message })
    }

    // Hapus file dari Storage DULU (sebelum row DB-nya). Kalau ini gagal,
    // row-nya sengaja dibiarkan tetap ada supaya user bisa coba hapus lagi
    // nanti — daripada urutan sebaliknya (row kehapus, file gagal kehapus)
    // yang cuma mengulang bug yang lagi dibenerin ini.
    let storageWarning = null
    if (msg?.type === 'file') {
      const storagePath = extractStoragePath(msg.content)
      if (storagePath) {
        const { error: storageError } = await supabase.storage
          .from('localshare')
          .remove([storagePath])
        if (storageError) {
          console.error('Gagal hapus file dari storage:', storagePath, storageError.message)
          return res.status(500).json({
            error: `Gagal menghapus file dari storage: ${storageError.message}`,
          })
        }
      } else {
        // URL tidak cocok pola yang diharapkan (kemungkinan data lama dari
        // skema penyimpanan sebelumnya) — tetap lanjut hapus row-nya, tapi
        // beri tau lewat warning supaya tidak diam-diam ketelan.
        storageWarning = 'Path storage tidak dikenali dari URL, file kemungkinan tidak ikut terhapus dari Storage (data lama).'
      }
    }

    const { error } = await supabase.from('messages').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json({ success: true, warning: storageWarning || undefined })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
