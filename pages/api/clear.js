import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Delete all file entries from storage first
  const { data: fileMessages } = await supabase
    .from('messages')
    .select('content')
    .eq('type', 'file')

  let storageWarning = null

  if (fileMessages && fileMessages.length > 0) {
    const filePaths = fileMessages
      .map(m => {
        const url = m.content
        const match = url.match(/uploads\/(.+)$/)
        return match ? `uploads/${match[1]}` : null
      })
      .filter(Boolean)

    if (filePaths.length > 0) {
      // Sebelumnya hasil remove() ini tidak pernah dicek — kalau gagal,
      // errornya ketelan diam-diam dan row DB tetap dihapus di bawah,
      // seolah-olah semuanya berhasil padahal file-nya masih nyangkut di
      // Storage. Sekarang errornya di-log & dilaporkan balik ke frontend
      // sebagai warning, tapi tetap lanjut hapus row-row-nya di bawah —
      // supaya "Clear All" tidak jadi gagal total cuma gara-gara satu file
      // bermasalah.
      const { error: storageError } = await supabase.storage.from('localshare').remove(filePaths)
      if (storageError) {
        console.error('Sebagian/semua file gagal dihapus dari storage:', storageError.message)
        storageWarning = `Semua pesan dihapus, tapi sebagian file gagal dihapus dari storage: ${storageError.message}`
      }
    }
  }

  const { error } = await supabase.from('messages').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ success: true, warning: storageWarning || undefined })
}
