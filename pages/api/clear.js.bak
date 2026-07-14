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

  if (fileMessages && fileMessages.length > 0) {
    const filePaths = fileMessages
      .map(m => {
        const url = m.content
        const match = url.match(/uploads\/(.+)$/)
        return match ? `uploads/${match[1]}` : null
      })
      .filter(Boolean)

    if (filePaths.length > 0) {
      await supabase.storage.from('localshare').remove(filePaths)
    }
  }

  const { error } = await supabase.from('messages').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ success: true })
}
