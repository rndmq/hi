import { createClient } from '@supabase/supabase-js'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'

export const config = {
  api: {
    bodyParser: false,
  },
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const form = formidable({ maxFileSize: 50 * 1024 * 1024 }) // 50MB limit

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to parse form: ' + err.message })
    }

    const file = Array.isArray(files.file) ? files.file[0] : files.file
    const deviceLabel = Array.isArray(fields.device_label) ? fields.device_label[0] : (fields.device_label || 'Unknown')

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    try {
      const fileBuffer = fs.readFileSync(file.filepath)
      const fileName = `${Date.now()}_${file.originalFilename}`
      const filePath = `uploads/${fileName}`

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('localshare')
        .upload(filePath, fileBuffer, {
          contentType: file.mimetype,
          upsert: false,
        })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('localshare')
        .getPublicUrl(filePath)

      // Save to messages table
      const { data, error: dbError } = await supabase
        .from('messages')
        .insert([{
          content: urlData.publicUrl,
          type: 'file',
          file_name: file.originalFilename,
          file_size: file.size,
          file_type: file.mimetype,
          device_label: deviceLabel,
        }])
        .select()
        .single()

      if (dbError) throw dbError

      fs.unlinkSync(file.filepath)
      return res.status(200).json(data)
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  })
}
