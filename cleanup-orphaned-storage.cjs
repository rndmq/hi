#!/usr/bin/env node
//
// cleanup-orphaned-storage.cjs
//
// Nyari & (opsional) menghapus file di Supabase Storage bucket 'localshare'
// yang sudah tidak ada referensinya di tabel 'messages' — ini adalah file-
// file yang kadung nyangkut dari sebelum bug di DELETE /api/messages
// dibenerin (dulu endpoint itu cuma menghapus row DB-nya, tidak ikut
// menghapus file aslinya di Storage).
//
// DEFAULT: dry-run. Script ini HANYA menampilkan daftar file yang akan
// dihapus beserta total ukurannya — TIDAK ada yang benar-benar dihapus
// sampai kamu jalankan ulang dengan flag --delete.
//
// CARA PAKAI (jalankan dari root folder project Next.js kamu, supaya
// @supabase/supabase-js ketemu lewat node_modules yang sudah ada):
//
//   1) Kalau sudah punya .env.local (isinya sama kayak yang dipakai
//      pages/api/*.js) dan Node kamu versi 20.6+ :
//
//        node --env-file=.env.local cleanup-orphaned-storage.cjs
//        node --env-file=.env.local cleanup-orphaned-storage.cjs --delete
//
//   2) Atau isi manual tiap kali jalanin (Node versi berapa pun):
//
//        SUPABASE_SERVICE_ROLE_KEY=xxxx \
//        NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co \
//        node cleanup-orphaned-storage.cjs
//
// Butuh SERVICE ROLE key (bukan anon key) karena harus bisa list & delete
// langsung di Storage tanpa terikat RLS.

const { createClient } = require('@supabase/supabase-js')

const BUCKET = 'localshare'
const FOLDER = 'uploads'
const DELETE_MODE = process.argv.includes('--delete')
const BATCH_SIZE = 100 // batas aman jumlah path per panggilan storage.remove()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Butuh env var NEXT_PUBLIC_SUPABASE_URL (atau SUPABASE_URL) dan SUPABASE_SERVICE_ROLE_KEY.')
  console.error('Lihat komentar di atas file ini buat contoh cara jalaninnya.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// storage.list() cuma nge-return maks 100 item per panggilan secara default,
// jadi perlu di-paginate manual buat bucket yang isinya banyak.
async function listAllStorageObjects() {
  const all = []
  let offset = 0
  const limit = 100
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(FOLDER, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error(`Gagal list storage: ${error.message}`)
    if (!data || data.length === 0) break
    // id === null menandakan "folder" placeholder, bukan file asli — skip.
    all.push(...data.filter(obj => obj.id !== null))
    if (data.length < limit) break
    offset += limit
  }
  return all
}

// Tabel messages juga di-paginate, jaga-jaga kalau isinya sudah banyak.
async function listAllReferencedFileNames() {
  const names = new Set()
  let from = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('messages')
      .select('content')
      .eq('type', 'file')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Gagal baca tabel messages: ${error.message}`)
    if (!data || data.length === 0) break
    for (const row of data) {
      const match = row.content?.match(/uploads\/(.+)$/)
      if (match) names.add(match[1]) // simpan tanpa prefix "uploads/" biar cocok sama .name dari list()
    }
    if (data.length < pageSize) break
    from += pageSize
  }
  return names
}

async function main() {
  console.log(`Bucket target : ${BUCKET}/${FOLDER}`)
  console.log(`Mode          : ${DELETE_MODE ? '⚠️  DELETE (beneran menghapus!)' : 'DRY-RUN (cuma nampilin daftar, aman dijalankan)'}\n`)

  console.log('Mengambil daftar file di Storage...')
  const storageObjects = await listAllStorageObjects()
  console.log(`  -> ${storageObjects.length} file ditemukan.`)

  console.log('Mengambil daftar file yang masih direferensikan di tabel messages...')
  const referencedNames = await listAllReferencedFileNames()
  console.log(`  -> ${referencedNames.size} file masih dipakai.\n`)

  const orphaned = storageObjects.filter(obj => !referencedNames.has(obj.name))

  if (orphaned.length === 0) {
    console.log('✓ Tidak ada file orphan. Bucket sudah bersih.')
    return
  }

  let totalSize = 0
  console.log(`${orphaned.length} file ORPHAN ditemukan (ada di Storage, tapi sudah tidak ada di feed):\n`)
  for (const obj of orphaned) {
    const size = obj.metadata?.size || 0
    totalSize += size
    console.log(`  - ${FOLDER}/${obj.name}  (${formatBytes(size)})`)
  }
  console.log(`\nTotal ukuran: ${formatBytes(totalSize)}`)

  if (!DELETE_MODE) {
    console.log('\nIni masih DRY-RUN, belum ada yang dihapus.')
    console.log('Kalau daftar di atas sudah benar dan mau beneran dihapus, jalankan ulang dengan tambahan --delete di akhir command.')
    return
  }

  console.log('\nMenghapus...')
  const pathsToDelete = orphaned.map(obj => `${FOLDER}/${obj.name}`)
  let deletedCount = 0
  for (let i = 0; i < pathsToDelete.length; i += BATCH_SIZE) {
    const batch = pathsToDelete.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.storage.from(BUCKET).remove(batch)
    if (error) {
      console.error(`  Gagal hapus batch ${i}-${i + batch.length}: ${error.message}`)
      continue
    }
    deletedCount += batch.length
    console.log(`  Terhapus ${deletedCount}/${pathsToDelete.length}...`)
  }
  console.log(`\n✓ Selesai. ${deletedCount} dari ${pathsToDelete.length} file orphan berhasil dihapus.`)
  if (deletedCount < pathsToDelete.length) {
    console.log('  Sebagian gagal — cek pesan error di atas, biasanya bisa dicoba lagi dengan menjalankan ulang script ini.')
  }
}

main().catch((err) => {
  console.error('\nError:', err.message)
  process.exit(1)
})
