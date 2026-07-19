import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import {
  IconRadar, IconSpark, IconUpload, IconClipboard, IconLink, IconCheck,
  IconClose, IconWarning, IconEye, IconTrash, IconFolder, IconInbox,
  IconLaptop, IconPhone, IconDesktop, IconDot, FileIcon
} from '../components/Icons'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatTime(iso) {
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) {
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    return `${h}:${m}`
  }
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
}

function getFileIcon(mimeType, fileName) {
  if (!mimeType && !fileName) return 'generic'
  const ext = fileName?.split('.').pop()?.toLowerCase()
  const mime = mimeType || ''

  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.includes('pdf')) return 'pdf'
  if (mime.includes('zip') || mime.includes('rar') || ['zip','rar','7z','tar','gz'].includes(ext)) return 'archive'
  if (mime.includes('word') || ['doc','docx'].includes(ext)) return 'word'
  if (mime.includes('sheet') || ['xls','xlsx','csv'].includes(ext)) return 'sheet'
  if (mime.includes('presentation') || ['ppt','pptx'].includes(ext)) return 'slides'
  if (['js','ts','py','java','cpp','html','css','json','php','go','rs'].includes(ext)) return 'code'
  if (['apk'].includes(ext)) return 'apk'
  return 'generic'
}

function isUrl(text) {
  try { return ['http:', 'https:'].includes(new URL(text.trim()).protocol) }
  catch { return false }
}

// Harus sama persis dengan file_size_limit bucket 'localshare' di Supabase
// Storage (lihat supabase_storage_policies.sql). Kalau nanti limit di
// Supabase diubah, ubah juga angka ini supaya pesan error di UI tetap akurat.
//
// Angka ini sekarang juga jadi threshold routing: file <= ini tetap lewat
// Supabase Storage (persisten, muncul di feed bersama). File > ini otomatis
// dikirim P2P lewat WebRTC (lihat bagian "P2P Transfer" di bawah) — jadi
// TIDAK PERNAH disimpan di Storage/DB sama sekali, cuma numpang lewat
// koneksi langsung antar browser. Server (Supabase Realtime) cuma dipakai
// buat signaling (tuker SDP), bukan buat nyimpen data filenya.
const MAX_FILE_SIZE = 75 * 1024 * 1024 // 75MB

// Vercel (atau proxy di depannya) kadang membalas HTML/plain-text alih-alih JSON
// saat request gagal sebelum sempat masuk ke handler kita — misalnya saat body
// request melebihi hard limit ukuran Vercel (~4.5MB) atau saat function timeout.
// Kalau ini terjadi, res.json() akan melempar "Unexpected token '<' ... is not
// valid JSON" karena body-nya sebenarnya halaman HTML, bukan JSON.
// Helper ini mengecek content-type dulu supaya errornya jelas dan tidak crash.
async function safeParseResponse(res) {
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const text = await res.text()
    if (res.status === 413 || /entity too large/i.test(text)) {
      throw new Error('File terlalu besar untuk diupload lewat server (limit ~4.5MB per request). Coba file yang lebih kecil.')
    }
    if (!res.ok) {
      throw new Error(`Server error (${res.status}). Coba lagi atau gunakan file yang lebih kecil.`)
    }
    throw new Error('Response tidak valid dari server.')
  }
  return res.json()
}

// supabase-js SDK punya method storage.upload(), tapi method itu dibangun di
// atas fetch(), dan fetch() tidak punya API untuk membaca progress upload
// (baru ReadableStream response yang didukung luas, bukan request body).
// Supaya progress bar bisa menunjukkan persentase real per-byte, kita panggil
// REST API Storage Supabase secara langsung lewat XMLHttpRequest, yang punya
// event upload.onprogress bawaan.
//
// Endpoint & header di bawah ini mengikuti format resmi Storage REST API
// Supabase: POST {supabaseUrl}/storage/v1/object/{bucket}/{path}
// dengan header apikey + Authorization: Bearer {anonKey}.
//
// CATATAN: sengaja pakai env var NEXT_PUBLIC_SUPABASE_URL/ANON_KEY langsung
// (sama seperti yang dipakai lib/supabase.js untuk membuat client), bukan
// membaca properti internal dari instance client (mis. supabase.supabaseUrl),
// karena properti itu tidak didokumentasikan sebagai API publik yang stabil.
function uploadFileToStorageWithProgress(bucket, path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !anonKey) {
      reject(new Error('Konfigurasi Supabase (URL/anon key) tidak ditemukan di env.'))
      return
    }

    const url = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`
    const xhr = new XMLHttpRequest()

    xhr.open('POST', url, true)
    xhr.setRequestHeader('apikey', anonKey)
    xhr.setRequestHeader('Authorization', `Bearer ${anonKey}`)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('x-upsert', 'false')

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        let message = `Upload gagal (status ${xhr.status})`
        try {
          const parsed = JSON.parse(xhr.responseText)
          if (parsed.message) message = parsed.message
        } catch (_) {
          // Response bukan JSON (misal HTML error page) — pakai pesan default di atas
        }
        reject(new Error(message))
      }
    }

    xhr.onerror = () => reject(new Error('Koneksi terputus saat upload'))
    xhr.onabort = () => reject(new Error('Upload dibatalkan'))

    xhr.send(file)
  })
}

function getDeviceClass(label) {
  const l = label?.toLowerCase() || ''
  if (l.includes('laptop') || l.includes('pc') || l.includes('mac') || l.includes('windows') || l.includes('linux')) return 'laptop'
  if (l.includes('phone') || l.includes('hp') || l.includes('android') || l.includes('ios') || l.includes('iphone') || l.includes('mobile')) return 'phone'
  return 'other'
}

function detectDeviceLabel() {
  if (typeof window === 'undefined') return 'Device'
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad/i.test(ua)) return 'iPhone'
  if (/Mac/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows PC'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Hp'
}

// ─── P2P Transfer (WebRTC) ─────────────────────────────────────────────────────
//
// Dipakai khusus untuk file > MAX_FILE_SIZE. Alurnya:
//   1. Pengirim buat RTCPeerConnection + DataChannel, createOffer(), tunggu
//      ICE gathering selesai (non-trickle — semua kandidat digabung jadi satu
//      pesan, biar signaling-nya cuma 2 kali kirim: offer & answer, gak perlu
//      tuker kandidat satu-satu).
//   2. Offer (lengkap dengan SDP) di-broadcast lewat Supabase Realtime channel
//      'p2p-signal', ditujukan ke satu deviceId spesifik (bukan disiarkan ke
//      semua orang). Broadcast Realtime ini EPHEMERAL — tidak pernah nyentuh
//      Postgres, jadi tidak ada jejak yang kesimpen.
//   3. Penerima terima offer, buat PeerConnection sendiri, createAnswer(),
//      broadcast balik ke pengirim.
//   4. Begitu kedua sisi setRemoteDescription, browser saling connect
//      LANGSUNG (P2P sungguhan, byte file tidak pernah lewat server) dan
//      DataChannel kebuka. Baru dari situ file dikirim chunk-per-chunk.
//
// CATATAN: karena non-trickle ICE cuma pakai STUN publik (tidak ada TURN
// server), transfer bisa gagal connect kalau kedua device ada di belakang
// NAT yang sama-sama "ketat"/simetris (jarang terjadi untuk WiFi rumah biasa,
// tapi bisa kejadian di sebagian jaringan kantor/kampus/beberapa kartu
// operator seluler). Kalau ini sering kejadian, solusinya nambah TURN server
// (misal self-host coturn atau pakai layanan seperti Metered/Twilio) di
// konfigurasi iceServers pada createPeerConnection().
//
// PENTING soal STUN & "jarak": STUN cuma dipakai sekali di awal buat tau
// alamat publik device (paket kecil, hitungan milidetik) — bukan buat
// nglewatin data file. Begitu koneksi P2P kebentuk, STUN server sudah tidak
// terlibat sama sekali; byte file mengalir langsung device-ke-device. Kalau
// kedua device di jaringan lokal yang sama, ICE bahkan akan lebih dulu coba
// kandidat LAN langsung sebelum sempat butuh STUN. Jadi provider/lokasi STUN
// TIDAK mempengaruhi kecepatan transfer — ini beda dengan TURN (relay),
// yang kalau nanti ditambah, lokasinya baru benar-benar berpengaruh ke
// kecepatan karena TURN memang meneruskan datanya lewat server itu.
// Di bawah ini tetap dipakai 2 provider (bukan cuma satu) supaya ICE
// gathering tidak bergantung ke satu pihak saja kalau salah satunya lambat/
// down — Cloudflare sebagai yang utama, Google sebagai cadangan.
const ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
]

// 64KB — masih aman & didukung luas di browser modern (Chrome/Firefox/
// Safari/Edge terkini semua oke di atas 16KB). Batas "aman" 16KB yang sering
// dipakai di tutorial WebRTC itu peninggalan bug Chrome versi lama yang
// sudah lama diperbaiki. Naikin ke 64KB dikit ngurangin overhead per
// panggilan dc.send(), tapi TIDAK mengubah cerita besarnya: backpressure di
// bawah (bufferedAmount + event 'bufferedamountlow') yang bikin chunk
// dikirim beruntun tanpa nunggu balesan satu-satu, jadi kecepatan transfer
// tetap dibatasi bandwidth koneksi, bukan ukuran chunk-nya.
const P2P_CHUNK_SIZE = 64 * 1024 // 64KB
const P2P_BUFFERED_AMOUNT_LOW = 1 * 1024 * 1024 // 1MB — ambang buat nunggu buffer ngosong dulu
const P2P_CONNECT_TIMEOUT_MS = 20000 // batas waktu nunggu koneksi P2P kebentuk pertama kali
// Begitu koneksi sempat 'connected' lalu jadi 'disconnected' (WiFi kedip, HP
// pindah channel/layar lock sebentar, dst), ICE tetap nyoba connectivity
// check di background dan SERING pulih sendiri tanpa perlu apa-apa. Kasih
// waktu segini dulu sebelum benar-benar dianggap gagal, supaya gangguan
// sesaat nggak langsung membatalkan transfer yang lagi jalan.
const P2P_DISCONNECT_GRACE_MS = 12000
// Update progress paling sering tiap segini ms — tanpa ini, progress
// ke-update di SETIAP chunk (ribuan kali buat file besar), bikin React
// re-render kebanyakan dan malah ikut memperlambat transfer, apalagi di HP
// yang CPU-nya lebih lemah.
const P2P_PROGRESS_THROTTLE_MS = 150

function createP2PPeerConnection() {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS })
}

// Nunggu ICE gathering kelar (non-trickle). Ada fallback timeout 5 detik
// supaya tidak macet total kalau ada satu kandidat yang lambat/gantung.
function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(resolve, 5000)
  })
}

// Bikin fungsi onProgress yang di-throttle — dipanggil terus di setiap
// chunk, tapi cuma benar-benar meneruskan ke updateTransfer() paling sering
// tiap P2P_PROGRESS_THROTTLE_MS, KECUALI saat sudah 100% (biar progress bar
// selalu berakhir pas di penuh, tidak nanggung di update yang ke-skip).
function createProgressThrottle(onProgress) {
  let lastCall = 0
  return (loaded, total) => {
    const now = Date.now()
    if (loaded >= total || now - lastCall >= P2P_PROGRESS_THROTTLE_MS) {
      lastCall = now
      onProgress(loaded, total)
    }
  }
}

// Kasih feedback yang jelas kalau koneksi P2P gagal terbentuk atau putus di
// tengah jalan — tapi bedain 'disconnected' (sering cuma sementara, dikasih
// masa tenggang lewat P2P_DISCONNECT_GRACE_MS dulu sebelum dianggap gagal)
// dari 'failed'/'closed' (memang sudah pasti mati, langsung dianggap gagal).
// Sebelumnya ketiganya diperlakukan sama — itu yang bikin gangguan jaringan
// SESAAT (HP layar lock bentar, WiFi kedip) langsung membatalkan transfer
// padahal ICE-nya sendiri sering masih bisa pulih kalau dikasih waktu.
//
// Mengembalikan fungsi cleanup — pemanggil WAJIB memanggilnya begitu koneksi
// berhasil kepakai (lihat pemakaian di dc.onopen / pc.ondatachannel), supaya
// tidak salah nembak error timeout padahal transfer-nya sebenarnya sukses.
function attachP2PWatchdog(pc, transferId, updateTransfer) {
  const connectTimeoutId = setTimeout(() => {
    updateTransfer(transferId, {
      status: 'error',
      error: 'Koneksi P2P timeout. Pastikan device tujuan online & tab LocalShare-nya masih terbuka.',
    })
  }, P2P_CONNECT_TIMEOUT_MS)

  let disconnectGraceId = null

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      clearTimeout(connectTimeoutId)
      if (disconnectGraceId) {
        clearTimeout(disconnectGraceId)
        disconnectGraceId = null
        updateTransfer(transferId, { unstable: false })
      }
    } else if (pc.connectionState === 'disconnected') {
      clearTimeout(connectTimeoutId)
      if (!disconnectGraceId) {
        updateTransfer(transferId, { unstable: true })
        disconnectGraceId = setTimeout(() => {
          updateTransfer(transferId, {
            status: 'error',
            unstable: false,
            error: 'Koneksi P2P terputus (device tujuan mungkin kehilangan sinyal/pindah jaringan) dan tidak pulih.',
          })
        }, P2P_DISCONNECT_GRACE_MS)
      }
    } else if (['failed', 'closed'].includes(pc.connectionState)) {
      clearTimeout(connectTimeoutId)
      if (disconnectGraceId) clearTimeout(disconnectGraceId)
      updateTransfer(transferId, {
        status: 'error',
        unstable: false,
        error: 'Koneksi P2P terputus atau gagal dibuat (kemungkinan diblokir NAT/firewall).',
      })
    }
  }

  return () => {
    clearTimeout(connectTimeoutId)
    if (disconnectGraceId) clearTimeout(disconnectGraceId)
  }
}

// Kirim file lewat DataChannel dalam potongan kecil, dengan backpressure:
// kalau dc.bufferedAmount masih tinggi, tunggu event 'bufferedamountlow' dulu
// sebelum lanjut kirim chunk berikutnya. Tanpa ini, file besar bisa bikin
// buffer membengkak tak terkendali dan koneksi jadi tidak stabil/macet.
//
// Beda dari versi sebelumnya: chunk BERIKUTNYA mulai dibaca dari disk DI
// BELAKANG LAYAR sambil chunk SEKARANG masih dikirim/nunggu backpressure —
// bukan baca-dulu-baru-kirim-baru-baca-lagi berurutan. Waktu baca & waktu
// kirim jadi saling tumpang tindih alih-alih gantian nunggu satu-satu, yang
// tadinya nambah overhead nyata buat file besar (ribuan chunk = ribuan kali
// nunggu baca selesai sebelum sempat mulai kirim). Pakai Blob.arrayBuffer()
// (Promise asli) bukan FileReader (API berbasis event yang lebih lama),
// supaya alurnya lebih simpel di-pipeline seperti ini.
//
// Cancel ditangani dari luar lewat pc.close() (lihat cancelTransfer) — begitu
// koneksi ditutup, dc.send() berikutnya melempar error, ketangkep di catch
// di bawah, dan promise-nya reject. Kartu transfer-nya sendiri sudah lebih
// dulu hilang dari UI karena cancelTransfer langsung memfilternya dari
// state, jadi reject ini tidak perlu ditangani khusus di sini.
function sendFileOverDataChannel(dc, file, onProgress) {
  return new Promise((resolve, reject) => {
    dc.bufferedAmountLowThreshold = P2P_BUFFERED_AMOUNT_LOW

    function readChunk(start) {
      const end = Math.min(start + P2P_CHUNK_SIZE, file.size)
      return file.slice(start, end).arrayBuffer()
    }

    async function pump() {
      try {
        let offset = 0
        let nextChunkPromise = offset < file.size ? readChunk(offset) : null

        while (offset < file.size) {
          const chunk = await nextChunkPromise

          const nextOffset = offset + chunk.byteLength
          // Mulai baca chunk berikutnya SEKARANG, sebelum chunk ini dikirim
          // atau sebelum nunggu backpressure — ini inti dari overlap-nya.
          nextChunkPromise = nextOffset < file.size ? readChunk(nextOffset) : null

          dc.send(chunk)
          offset = nextOffset
          onProgress(offset, file.size)

          if (dc.bufferedAmount > P2P_BUFFERED_AMOUNT_LOW) {
            await new Promise((res) => {
              dc.onbufferedamountlow = () => {
                dc.onbufferedamountlow = null
                res()
              }
            })
          }
        }

        dc.send(JSON.stringify({ type: 'done' }))
        resolve()
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Gagal membaca/mengirim file: ' + e))
      }
    }

    // Pesan pertama: metadata (JSON teks) supaya penerima tahu nama/ukuran/
    // tipe file sebelum chunk biner pertama datang.
    dc.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size, mimeType: file.type }))
    pump()
  })
}

// Pasang handler di DataChannel milik penerima: kumpulkan chunk biner ke
// array, dan proses 2 jenis pesan kontrol (JSON teks): 'meta' di awal,
// 'done' di akhir yang memicu penggabungan semua chunk jadi satu Blob.
// onProgress otomatis di-throttle (lihat createProgressThrottle) supaya
// tidak trigger re-render React di SETIAP chunk yang masuk.
function attachP2PReceiver(dc, { onMeta, onProgress, onComplete, onError }) {
  const throttledProgress = createProgressThrottle(onProgress)
  let meta = null
  let chunks = []
  let receivedBytes = 0

  dc.onmessage = (e) => {
    if (typeof e.data === 'string') {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'meta') {
          meta = msg
          chunks = []
          receivedBytes = 0
          onMeta(msg)
        } else if (msg.type === 'done') {
          const blob = new Blob(chunks, { type: meta?.mimeType || 'application/octet-stream' })
          onComplete(blob, meta)
        }
      } catch (err) {
        onError(new Error('Pesan kontrol dari pengirim tidak valid'))
      }
      return
    }
    chunks.push(e.data)
    receivedBytes += e.data.byteLength ?? e.data.size ?? 0
    if (meta) throttledProgress(receivedBytes, meta.size)
  }
}

// Sama seperti handleDownload di MessageCard: pakai Blob + link sementara
// biar browser langsung download alih-alih buka tab baru.
function triggerBlobDownload(blob, fileName) {
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = fileName || 'download'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}

// ─── Components ───────────────────────────────────────────────────────────────

function Toast({ msg, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [onClose])

  return <div className={`toast ${type}`}>{msg}</div>
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button className={`msg-copy-btn ${copied ? 'copied' : ''}`} onClick={copy}>
      {copied ? <><IconCheck size={12} /> Copied</> : <><IconClipboard size={13} /> Copy</>}
    </button>
  )
}

function CopyLinkButton({ url }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button className={`btn-copy-link ${copied ? 'copied' : ''}`} onClick={copy}>
      {copied ? <><IconCheck size={12} /> Copied</> : <><IconLink size={13} /> Copy Link</>}
    </button>
  )
}

// Muncul waktu ada >1 device lain yang online dan user mau kirim file besar
// (P2P) — minta user pilih satu device tujuan.
function DevicePickerModal({ files, devices, onPick, onCancel }) {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  return (
    <div className="device-picker-overlay" onClick={onCancel}>
      <div className="device-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="device-picker-title"><IconRadar size={15} /> Kirim langsung ke device mana?</div>
        <div className="device-picker-desc">
          {files.length > 1 ? `${files.length} file` : files[0]?.name} ({formatBytes(totalSize)}) melebihi {formatBytes(MAX_FILE_SIZE)}, jadi dikirim P2P langsung ke satu device — bukan lewat server. Device tujuan harus online sekarang.
        </div>
        <div className="device-picker-list">
          {devices.map((d) => (
            <button key={d.id} className="device-picker-option" onClick={() => onPick(d)}>
              {getDeviceClass(d.label) === 'laptop' ? <IconLaptop size={14} /> : getDeviceClass(d.label) === 'phone' ? <IconPhone size={14} /> : <IconDesktop size={14} />} {d.label}
            </button>
          ))}
        </div>
        <button className="device-picker-cancel" onClick={onCancel}>Batal</button>
      </div>
    </div>
  )
}

// Kartu progress buat satu transfer P2P (kirim ATAU terima). Ini SENGAJA
// tidak masuk ke feed 'Shared Items' yang biasa — karena sifatnya beda:
// ephemeral (hilang begitu selesai/gagal), dan cuma relevan buat 2 device
// yang terlibat, bukan buat semua orang yang lihat feed.
function P2PTransferCard({ t, onCancel }) {
  const isDone = t.status === 'done'
  const isError = t.status === 'error'
  const isActive = !isDone && !isError
  const stateClass = isDone ? 'done' : isError ? 'error' : ''

  // Kecepatan dihitung dari total byte terkirim/terima sejak startTime —
  // rata-rata sejak awal, bukan instan per-detik, tapi cukup buat kasih
  // gambaran "ini normal atau kelamaan" tanpa nambah state/timer terpisah.
  // Baru ditampilkan begitu sudah lewat ~0.5 detik biar angkanya tidak
  // meloncat-loncat di tick pertama.
  let speedLabel = null
  if (isActive && t.startTime && t.loadedBytes > 0) {
    const elapsedSec = (Date.now() - t.startTime) / 1000
    if (elapsedSec > 0.5) {
      speedLabel = `${formatBytes(t.loadedBytes / elapsedSec)}/s`
    }
  }

  return (
    <div className={`p2p-card ${stateClass}`}>
      <div className="p2p-card-top">
        <span className="p2p-card-direction">
          {t.direction === 'send' ? `↑ Kirim ke ${t.deviceLabel}` : `↓ Terima dari ${t.deviceLabel}`}
        </span>
        <span className={`p2p-card-status ${stateClass}`}>
          {isDone ? <><IconCheck size={12} /> Selesai</> : isError ? <><IconClose size={12} /> Gagal</> : t.status === 'connecting' ? 'Connecting...' : `${t.progress}%`}
        </span>
      </div>
      <div className="p2p-card-meta">
        {t.fileName} · {formatBytes(t.fileSize)}
        {speedLabel && <> · {speedLabel}</>}
      </div>
      {t.unstable && isActive && (
        <div className="p2p-card-unstable"><IconWarning size={13} /> Koneksi tidak stabil, mencoba pulih...</div>
      )}
      {isActive && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${t.progress}%` }} />
        </div>
      )}
      {isError && <div className="p2p-card-error-text">{t.error}</div>}
      {isActive && (
        <button className="p2p-card-cancel" onClick={() => onCancel(t.id)}><IconClose size={11} /> Batal</button>
      )}
    </div>
  )
}

function MessageCard({ msg, onDelete, isNew }) {
  const isFile = msg.type === 'file'
  const isImage = msg.file_type?.startsWith('image/')
  const isVideo = msg.file_type?.startsWith('video/')
  const isAudio = msg.file_type?.startsWith('audio/')
  const isPdf = msg.file_type?.includes('pdf') || msg.file_name?.toLowerCase().endsWith('.pdf')
  const deviceClass = getDeviceClass(msg.device_label)
  const hasEagerPreview = isImage || isVideo || isAudio

  // PDF sengaja TIDAK auto-preview kayak gambar/video — file PDF bisa berat
  // dan iframe viewer-nya baru mulai ambil seluruh file begitu dirender.
  // Baru dimuat kalau user tap tombol "Preview".
  const [showPdfPreview, setShowPdfPreview] = useState(false)

  // Fetch+blob agar browser langsung download, bukan buka tab baru
  const handleDownload = async () => {
    try {
      const res = await fetch(msg.content)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = msg.file_name || 'download'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (e) {
      console.error('Download gagal:', e)
    }
  }

  return (
    <div className={`msg-card ${isNew ? 'new-item' : ''}`}>
      <div className="msg-meta">
        <span className={`msg-device ${deviceClass}`}>{msg.device_label || 'Unknown'}</span>
        <span className={`msg-type-badge ${isFile ? 'file' : 'text'}`}>{isFile ? 'FILE' : 'TXT'}</span>
        <span className="msg-time">{formatTime(msg.created_at)}</span>
      </div>

      <div className="msg-body">
        {isFile ? (
          <div>
            {isImage && (
              <img
                src={msg.content}
                alt={msg.file_name}
                className="img-preview"
                loading="lazy"
              />
            )}
            {isVideo && (
              <video
                src={msg.content}
                controls
                className="video-preview"
                preload="metadata"
              />
            )}
            {isAudio && (
              <audio
                src={msg.content}
                controls
                className="audio-preview"
                preload="metadata"
              />
            )}
            {isPdf && showPdfPreview && (
              <iframe
                src={msg.content}
                className="pdf-preview"
                title={msg.file_name}
              />
            )}
            <div className="file-card" style={{ marginTop: (hasEagerPreview || (isPdf && showPdfPreview)) ? 8 : 0 }}>
              <span className="file-icon"><FileIcon type={getFileIcon(msg.file_type, msg.file_name)} size={20} /></span>
              <div className="file-info">
                <div className="file-name">{msg.file_name}</div>
                <div className="file-size">{formatBytes(msg.file_size)}</div>
              </div>
              <div className="file-actions">
                {isPdf && (
                  <button className="btn-download" onClick={() => setShowPdfPreview(v => !v)}>
                    {showPdfPreview ? <><IconClose size={12} /> Tutup</> : <><IconEye size={13} /> Preview</>}
                  </button>
                )}
                <button className="btn-download" onClick={handleDownload}>
                  ↓ Download
                </button>
                <CopyLinkButton url={msg.content} />
              </div>
            </div>
          </div>
        ) : (
          <div>
            {isUrl(msg.content || '') ? (
              <a href={msg.content} target="_blank" rel="noopener noreferrer" className="msg-text is-link">
                {msg.content}
              </a>
            ) : (
              <div className="msg-text">{msg.content}</div>
            )}
            <CopyButton text={msg.content} />
          </div>
        )}
      </div>

      <button className="msg-delete-btn" onClick={() => onDelete(msg.id)} title="Delete"><IconClose size={12} /></button>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Home({ initialMessages }) {
  const [messages, setMessages] = useState(initialMessages || [])
  const [activeTab, setActiveTab] = useState('text')
  const morphBoxRef = useRef(null)
  const sendBtnRef = useRef(null)
  const deviceRowRef = useRef(null)
  const textareaRef = useRef(null)
  const prevBoxRectRef = useRef(null)
  const prevBtnRectRef = useRef(null)
  const prevRowRectRef = useRef(null)

  const switchTab = (next) => {
    if (next === activeTab) return
    // FLIP "First": capture where things are right now, before the DOM changes.
    if (morphBoxRef.current) prevBoxRectRef.current = morphBoxRef.current.getBoundingClientRect()
    if (sendBtnRef.current) prevBtnRectRef.current = sendBtnRef.current.getBoundingClientRect()
    if (deviceRowRef.current) prevRowRectRef.current = deviceRowRef.current.getBoundingClientRect()
    setActiveTab(next)
  }

  useEffect(() => {
    // Everything below starts at the same instant: the box begins growing/
    // shrinking (height morph) WHILE its content quickly cross-fades in —
    // there is no "empty box" phase, the new content is visible pretty much
    // from frame one, just easing in from a slight offset. The device-row
    // and the send button are separate elements below the box, so their
    // "movement" isn't automatic like it would be for real siblings in a
    // pure-CSS layout shift — they're FLIP-tweened (measure old position,
    // measure new position, animate the delta) so they visibly slide to
    // their new spot instead of snapping.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      prevBoxRectRef.current = null
      prevBtnRectRef.current = null
      prevRowRectRef.current = null
      return
    }

    const DURATION = 620
    const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)'
    const CONTENT_FADE_MS = 260

    const box = morphBoxRef.current
    const prevBox = prevBoxRectRef.current
    if (box && prevBox) {
      box.style.transition = 'none'
      box.style.height = 'auto'
      box.style.transform = 'translateX(0)'
      const next = box.getBoundingClientRect()
      const dx = prevBox.left - next.left

      box.style.height = `${prevBox.height}px`
      box.style.transform = `translateX(${dx}px)`
      box.style.overflow = 'hidden'

      // Content starts from a soft offset, not fully hidden, and fades in
      // fast (much faster than the box's own morph) starting immediately —
      // so it reads as "box changes shape, content settles in along the
      // way", not as two separate sequential steps.
      const content = box.firstElementChild
      if (content) {
        window.clearTimeout(box._contentTO)
        content.style.transition = 'none'
        content.style.opacity = '0.35'
        content.style.transform = 'translateY(4px)'
      }
      box.getBoundingClientRect() // force reflow so the jumps above aren't animated

      const onTransitionEnd = (e) => {
        if (e.target !== box || e.propertyName !== 'height') return
        box.removeEventListener('transitionend', onTransitionEnd)
        // Re-measure 'auto' right now rather than trusting the animated
        // pixel value, so any subpixel mismatch is corrected invisibly
        // before handing height back to 'auto' for live responsiveness.
        box.style.transition = 'none'
        box.style.transform = 'translateX(0)'
        const settled = box.getBoundingClientRect().height
        box.style.height = `${settled}px`
        box.style.overflow = ''
        requestAnimationFrame(() => {
          box.style.height = 'auto'
        })

        // Neon warm-up: only relevant for the Text tab (the textarea is the
        // element with the neon border). A short pause after the box has
        // physically settled into shape, then the border flickers up to
        // full brightness like a tube starting up.
        const ta = textareaRef.current
        if (ta && activeTab === 'text') {
          ta.classList.remove('neon-startup')
          void ta.offsetWidth // restart the animation if it's already mid-flight
          window.clearTimeout(box._neonTO)
          box._neonTO = window.setTimeout(() => {
            ta.classList.add('neon-startup')
            const onNeonEnd = (ev) => {
              if (ev.target !== ta) return
              ta.classList.remove('neon-startup')
              ta.removeEventListener('animationend', onNeonEnd)
            }
            ta.addEventListener('animationend', onNeonEnd)
          }, 160)
        }
      }
      box.addEventListener('transitionend', onTransitionEnd)
      window.clearTimeout(box._morphFallbackTO)
      box._morphFallbackTO = window.setTimeout(() => {
        box.removeEventListener('transitionend', onTransitionEnd)
        box.style.transition = 'none'
        box.style.overflow = ''
        box.style.height = 'auto'
      }, DURATION + 200)

      requestAnimationFrame(() => {
        box.style.transition = `height ${DURATION}ms ${EASE}, transform ${DURATION}ms ${EASE}`
        box.style.height = `${next.height}px`
        box.style.transform = 'translateX(0)'

        if (content) {
          content.style.transition = `opacity ${CONTENT_FADE_MS}ms var(--ease), transform ${CONTENT_FADE_MS}ms var(--ease)`
          content.style.opacity = '1'
          content.style.transform = 'translateY(0)'
        }
      })
      prevBoxRectRef.current = null
    }

    // Device-row: slides from its old position to its new one via translateY.
    const row = deviceRowRef.current
    const prevRow = prevRowRectRef.current
    if (row && prevRow) {
      const next = row.getBoundingClientRect()
      const dy = prevRow.top - next.top
      if (Math.abs(dy) > 0.5) {
        row.style.transition = 'none'
        row.style.transform = `translateY(${dy}px)`
        row.getBoundingClientRect()
        requestAnimationFrame(() => {
          row.style.transition = `transform ${DURATION}ms ${EASE}`
          row.style.transform = 'translateY(0)'
        })
      }
      prevRowRectRef.current = null
    }

    // Send button: slides to its new position; its label only swaps once
    // the move is mostly done, via a quick fade on the label itself so the
    // text change doesn't pop mid-flight.
    const btn = sendBtnRef.current
    const prevBtn = prevBtnRectRef.current
    if (btn && prevBtn) {
      const next = btn.getBoundingClientRect()
      const dx = prevBtn.left - next.left
      const dy = prevBtn.top - next.top
      btn.style.transformOrigin = 'left center'
      btn.style.transition = 'none'
      btn.style.transform = `translate(${dx}px, ${dy}px)`
      btn.getBoundingClientRect()

      const label = btn.firstElementChild
      if (label) {
        window.clearTimeout(btn._labelTO)
        label.style.transition = 'none'
        label.style.opacity = '0'
      }

      requestAnimationFrame(() => {
        btn.style.transition = `transform ${DURATION}ms ${EASE}`
        btn.style.transform = 'translate(0, 0)'

        if (label) {
          btn._labelTO = window.setTimeout(() => {
            label.style.transition = `opacity ${CONTENT_FADE_MS}ms var(--ease)`
            label.style.opacity = '1'
          }, Math.round(DURATION * 0.45))
        }
      })
      prevBtnRectRef.current = null
    }
  }, [activeTab])

  const [textInput, setTextInput] = useState('')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [deviceLabel, setDeviceLabel] = useState('')
  const [sending, setSending] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [connected, setConnected] = useState(false)
  const [newIds, setNewIds] = useState(new Set())
  const [toast, setToast] = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef(null)
  const channelRef = useRef(null)

  // ── P2P state ──
  // Device lain yang lagi online (dari Presence channel 'p2p-signal').
  const [onlineDevices, setOnlineDevices] = useState([])
  // Transfer P2P yang lagi berjalan/baru selesai — TIDAK disimpan ke DB,
  // cuma state lokal di browser masing-masing (pengirim & penerima).
  const [p2pTransfers, setP2pTransfers] = useState([])
  // File(s) > MAX_FILE_SIZE yang lagi nunggu user pilih device tujuan
  // (dipakai kalau onlineDevices.length > 1, jadi tidak bisa auto-pilih).
  const [pendingP2PFiles, setPendingP2PFiles] = useState(null)
  const myIdRef = useRef(null) // id unik per-tab, dipakai buat alamat signaling
  const p2pChannelRef = useRef(null) // channel Supabase buat Presence + Broadcast
  const p2pConnectionsRef = useRef({}) // transferId -> { pc, dc? } yang lagi aktif

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
  }, [])

  // updateTransfer dipakai di banyak tempat (progress, sukses, error) — kalau
  // status berubah jadi 'done'/'error', otomatis dijadwalkan buat dibuang
  // dari layar 4 detik kemudian (mirip Toast), tidak perlu dibersihkan manual.
  const updateTransfer = useCallback((id, patch) => {
    setP2pTransfers(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
    if (patch.status === 'done' || patch.status === 'error') {
      setTimeout(() => {
        setP2pTransfers(prev => prev.filter(t => t.id !== id))
      }, 4000)
    }
  }, [])

  const addTransfer = useCallback((t) => {
    setP2pTransfers(prev => [...prev, t])
  }, [])

  const cancelTransfer = useCallback((transferId) => {
    const entry = p2pConnectionsRef.current[transferId]
    if (entry?.pc) entry.pc.close()
    delete p2pConnectionsRef.current[transferId]
    setP2pTransfers(prev => prev.filter(t => t.id !== transferId))
  }, [])

  // Id unik per-tab untuk alamat signaling (fromId/toId). Dibuat sekali di
  // efek terpisah (bukan digabung ke efek Presence di bawah) supaya sudah
  // pasti terisi sebelum device lain sempat mengirim offer ke kita.
  useEffect(() => {
    myIdRef.current = crypto.randomUUID()
  }, [])

  // Auto-detect device
  useEffect(() => {
    const saved = localStorage.getItem('ls_device_label')
    setDeviceLabel(saved || detectDeviceLabel())
  }, [])

  // Save device label
  useEffect(() => {
    if (deviceLabel) localStorage.setItem('ls_device_label', deviceLabel)
  }, [deviceLabel])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('public:messages')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const newMsg = payload.new
          setMessages(prev => [newMsg, ...prev])
          setNewIds(prev => {
            const next = new Set(prev)
            next.add(newMsg.id)
            setTimeout(() => setNewIds(s => { const n = new Set(s); n.delete(newMsg.id); return n }), 2000)
            return next
          })
        }
        if (payload.eventType === 'DELETE') {
          setMessages(prev => prev.filter(m => m.id !== payload.old.id))
        }
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // Dipanggil di sisi PENGIRIM setelah dapat balasan 'p2p-answer' yang
  // ditujukan buat kita. Ini langkah terakhir sebelum browser saling connect.
  const handleIncomingAnswer = useCallback(async (payload) => {
    const entry = p2pConnectionsRef.current[payload.transferId]
    if (!entry?.pc) return
    try {
      await entry.pc.setRemoteDescription(payload.sdp)
    } catch (e) {
      updateTransfer(payload.transferId, { status: 'error', error: 'Gagal menerima jawaban dari device tujuan.' })
    }
  }, [updateTransfer])

  // Dipanggil di sisi PENERIMA setiap kali ada broadcast 'p2p-offer' yang
  // toId-nya cocok sama id kita. Auto-accept (tanpa dialog konfirmasi) —
  // wajar untuk app antar device sendiri, sama seperti file biasa yang juga
  // langsung muncul di feed semua orang tanpa perlu approve.
  const handleIncomingOffer = useCallback(async (payload) => {
    const { transferId, fromId, fromLabel, fileName, fileSize, sdp } = payload
    const pc = createP2PPeerConnection()
    p2pConnectionsRef.current[transferId] = { pc }

    addTransfer({
      id: transferId, direction: 'receive', deviceLabel: fromLabel,
      fileName, fileSize, progress: 0, loadedBytes: 0, status: 'connecting',
    })

    const clearWatchdog = attachP2PWatchdog(pc, transferId, updateTransfer)

    pc.ondatachannel = (e) => {
      const dc = e.channel
      dc.binaryType = 'arraybuffer'
      attachP2PReceiver(dc, {
        onMeta: () => {
          clearWatchdog()
          updateTransfer(transferId, { status: 'receiving', startTime: Date.now() })
        },
        onProgress: (loaded, total) => {
          updateTransfer(transferId, {
            progress: total > 0 ? Math.round((loaded / total) * 100) : 0,
            loadedBytes: loaded,
          })
        },
        onComplete: (blob, meta) => {
          updateTransfer(transferId, { status: 'done', progress: 100 })
          triggerBlobDownload(blob, meta?.name || fileName)
          showToast(`File "${meta?.name || fileName}" diterima dari ${fromLabel}!`)
          setTimeout(() => pc.close(), 2000)
        },
        onError: (err) => {
          updateTransfer(transferId, { status: 'error', error: err.message })
        },
      })
    }

    try {
      await pc.setRemoteDescription(sdp)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await waitForIceGatheringComplete(pc)

      p2pChannelRef.current?.send({
        type: 'broadcast',
        event: 'p2p-answer',
        payload: { transferId, toId: fromId, sdp: pc.localDescription },
      })
    } catch (e) {
      clearWatchdog()
      updateTransfer(transferId, { status: 'error', error: 'Gagal membuat jawaban P2P: ' + e.message })
    }
  }, [addTransfer, updateTransfer, showToast])

  // Presence + Broadcast channel khusus buat signaling P2P. TIDAK ada
  // 'postgres_changes' di sini — channel ini murni ephemeral, tidak pernah
  // menyentuh Postgres. Presence dipakai buat tahu device lain yang online
  // (dengan label-nya), Broadcast dipakai buat tuker SDP offer/answer.
  useEffect(() => {
    if (!deviceLabel) return
    if (!myIdRef.current) myIdRef.current = crypto.randomUUID()
    const myId = myIdRef.current

    const channel = supabase.channel('p2p-signal', {
      config: { presence: { key: myId } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const devices = Object.entries(state)
          .filter(([id]) => id !== myId)
          .map(([id, metas]) => ({ id, label: metas?.[0]?.label || 'Unknown' }))
        setOnlineDevices(devices)
      })
      .on('broadcast', { event: 'p2p-offer' }, ({ payload }) => {
        if (payload?.toId === myId) handleIncomingOffer(payload)
      })
      .on('broadcast', { event: 'p2p-answer' }, ({ payload }) => {
        if (payload?.toId === myId) handleIncomingAnswer(payload)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ label: deviceLabel })
        }
      })

    p2pChannelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      Object.values(p2pConnectionsRef.current).forEach(({ pc }) => pc?.close())
      p2pConnectionsRef.current = {}
    }
  }, [deviceLabel, handleIncomingOffer, handleIncomingAnswer])

  // Dipanggil di sisi PENGIRIM untuk mulai kirim satu file besar ke satu
  // device tujuan yang sudah dipilih (baik auto-pilih karena cuma ada 1
  // device online, atau hasil pilihan dari DevicePickerModal).
  const initiateP2PTransfer = useCallback(async (file, targetDevice) => {
    const transferId = crypto.randomUUID()
    const myId = myIdRef.current
    const pc = createP2PPeerConnection()
    const dc = pc.createDataChannel('file')
    dc.binaryType = 'arraybuffer'
    p2pConnectionsRef.current[transferId] = { pc, dc }

    addTransfer({
      id: transferId, direction: 'send', deviceLabel: targetDevice.label,
      fileName: file.name, fileSize: file.size, progress: 0, loadedBytes: 0, status: 'connecting',
    })

    const clearWatchdog = attachP2PWatchdog(pc, transferId, updateTransfer)

    dc.onopen = async () => {
      clearWatchdog()
      updateTransfer(transferId, { status: 'sending', startTime: Date.now() })
      try {
        const throttledProgress = createProgressThrottle((loaded, total) => {
          updateTransfer(transferId, { progress: Math.round((loaded / total) * 100), loadedBytes: loaded })
        })
        await sendFileOverDataChannel(dc, file, throttledProgress)
        updateTransfer(transferId, { status: 'done', progress: 100 })
        showToast(`File terkirim langsung ke ${targetDevice.label}!`)
      } catch (e) {
        updateTransfer(transferId, { status: 'error', error: e.message })
        showToast('Gagal mengirim P2P: ' + e.message, 'error')
      } finally {
        setTimeout(() => pc.close(), 2000)
      }
    }

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await waitForIceGatheringComplete(pc)

      p2pChannelRef.current?.send({
        type: 'broadcast',
        event: 'p2p-offer',
        payload: {
          transferId,
          fromId: myId,
          fromLabel: deviceLabel,
          toId: targetDevice.id,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          sdp: pc.localDescription,
        },
      })
    } catch (e) {
      clearWatchdog()
      updateTransfer(transferId, { status: 'error', error: 'Gagal membuat tawaran P2P: ' + e.message })
    }
  }, [addTransfer, updateTransfer, showToast, deviceLabel])

  // Titik masuk dari addFiles(): route file besar ke device yang dipilih,
  // atau auto-pilih kalau cuma ada 1 device lain yang online.
  const routeBigFilesToP2P = useCallback((files) => {
    if (onlineDevices.length === 0) {
      const names = files.map(f => f.name).join(', ')
      showToast(`Tidak ada device lain yang online untuk P2P: ${names}. Buka LocalShare di device tujuan dulu.`, 'error')
      return
    }
    if (onlineDevices.length === 1) {
      files.forEach(f => initiateP2PTransfer(f, onlineDevices[0]))
      return
    }
    // Lebih dari 1 device online — minta user pilih lewat modal.
    setPendingP2PFiles(files)
  }, [onlineDevices, showToast, initiateP2PTransfer])

  const handleSendText = async () => {
    if (!textInput.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: textInput.trim(), type: 'text', device_label: deviceLabel }),
      })
      if (!res.ok) throw new Error('Failed to send')
      setTextInput('')
      showToast('Sent!')
    } catch (e) {
      showToast('Failed to send: ' + e.message, 'error')
    } finally {
      setSending(false)
    }
  }

  const handleSendFile = async () => {
    if (selectedFiles.length === 0) return
    setSending(true)
    setUploadProgress(0)

    // PENTING: File diupload LANGSUNG ke Supabase Storage dari browser
    // (bukan lewat /api/upload di Vercel), supaya tidak kena hard limit body
    // request Vercel (~4.5MB). Setelah file berhasil naik ke Storage, kita
    // baru simpan metadata-nya (URL, nama file, dll — semuanya teks kecil)
    // lewat /api/messages, yang amannya jauh di bawah limit tersebut.
    const total = selectedFiles.length
    const totalBytes = selectedFiles.reduce((sum, f) => sum + f.size, 0)
    // Bytes yang sudah ke-upload per file (index-based), dipakai untuk
    // menghitung progress gabungan real-time saat beberapa file diupload
    // berurutan — supaya progress bar bergerak mulus dari 0% ke 100% untuk
    // keseluruhan batch, bukan reset tiap pindah file.
    const uploadedBytesPerFile = new Array(selectedFiles.length).fill(0)

    const recomputeProgress = () => {
      const uploaded = uploadedBytesPerFile.reduce((sum, b) => sum + b, 0)
      setUploadProgress(totalBytes > 0 ? Math.round((uploaded / totalBytes) * 100) : 0)
    }

    const failed = [] // { index, file_name, error }

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]
      try {
        // Nama file dibuat unik supaya tidak bentrok antar-upload
        const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.name}`
        const filePath = `uploads/${uniqueName}`

        await uploadFileToStorageWithProgress(
          'localshare',
          filePath,
          file,
          (loaded) => {
            uploadedBytesPerFile[i] = loaded
            recomputeProgress()
          }
        )
        // Pastikan file ini tercatat 100% (byte terakhir kadang tidak
        // memicu event progress tambahan)
        uploadedBytesPerFile[i] = file.size
        recomputeProgress()

        const { data: urlData } = supabase.storage
          .from('localshare')
          .getPublicUrl(filePath)

        // Simpan metadata ke tabel messages lewat endpoint server yang sudah
        // ada. Payload ini murni teks (URL + info file), jauh di bawah limit
        // body Vercel, jadi tidak akan pernah kena masalah "Request Entity
        // Too Large" walau file aslinya berukuran ratusan MB.
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: urlData.publicUrl,
            type: 'file',
            file_name: file.name,
            file_size: file.size,
            file_type: file.type,
            device_label: deviceLabel,
          }),
        })

        const body = await safeParseResponse(res)
        if (!res.ok) throw new Error(body.error || 'Gagal menyimpan metadata file')
      } catch (e) {
        failed.push({ index: i, file_name: file.name, error: e.message })
      }
    }

    if (failed.length === 0) {
      showToast(total > 1 ? `${total} file berhasil diupload!` : 'File uploaded!')
      setSelectedFiles([])
    } else if (failed.length < total) {
      const names = failed.map(f => f.file_name).join(', ')
      showToast(`Sebagian gagal diupload: ${names}`, 'error')
      // Sisakan hanya file yang gagal (dicocokkan lewat index asli, bukan
      // nama, supaya tetap benar walau ada 2 file dengan nama sama)
      const failedIndexes = new Set(failed.map(f => f.index))
      setSelectedFiles(prev => prev.filter((_, idx) => failedIndexes.has(idx)))
    } else {
      showToast(failed[0]?.error || 'Semua file gagal diupload', 'error')
    }

    setSending(false)
    setTimeout(() => setUploadProgress(0), 500)
  }

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`/api/messages?id=${id}`, { method: 'DELETE' })
      const body = await safeParseResponse(res)
      if (!res.ok) throw new Error(body.error || 'Delete failed')
      if (body.warning) showToast(body.warning, 'error')
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleClearAll = async () => {
    if (!confirm('Clear semua pesan?')) return
    try {
      const res = await fetch('/api/clear', { method: 'DELETE' })
      const body = await safeParseResponse(res)
      if (!res.ok) throw new Error(body.error || 'Clear failed')
      setMessages([])
      showToast(body.warning || 'Semua pesan dihapus', body.warning ? 'error' : 'success')
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  // Helper bersama untuk menambahkan file (dari input klik, drag-drop, paste
  // clipboard, atau tombol "tambah file lagi"). File dipecah jadi 2 rute
  // berdasarkan ukuran:
  //   - <= MAX_FILE_SIZE: masuk ke selectedFiles seperti biasa (nanti upload
  //     ke Supabase Storage lewat handleSendFile, muncul di feed bersama).
  //   - > MAX_FILE_SIZE: TIDAK pernah masuk selectedFiles / Storage sama
  //     sekali. Langsung dialihkan ke routeBigFilesToP2P buat dikirim
  //     peer-to-peer ke satu device tujuan.
  // Dibungkus useCallback (referensinya stabil) supaya bisa dipakai aman di
  // dependency array useEffect paste handler di bawah.
  const addFiles = useCallback((newFiles) => {
    const tooBig = newFiles.filter(f => f.size > MAX_FILE_SIZE)
    const ok = newFiles.filter(f => f.size <= MAX_FILE_SIZE)

    if (ok.length > 0) {
      setSelectedFiles(prev => [...prev, ...ok])
    }
    if (tooBig.length > 0) {
      routeBigFilesToP2P(tooBig)
    }
  }, [routeBigFilesToP2P])

  const handleFileDrop = (e) => {
    e.preventDefault()
    setDragging(false)

    let droppedFiles = []

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      droppedFiles = Array.from(e.dataTransfer.items)
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter(Boolean)
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      droppedFiles = Array.from(e.dataTransfer.files)
    }

    const validFiles = droppedFiles.filter(f => f && f.size > 0)

    if (validFiles.length > 0) {
      addFiles(validFiles)
      switchTab('file')
    } else {
      console.warn('File kosong atau gagal dibaca')
    }
  }

  // Paste dari clipboard (Ctrl+V / Cmd+V) — kalau isinya gambar/file (bukan
  // teks biasa, misal abis screenshot terus langsung paste tanpa save dulu),
  // otomatis kedetect sebagai file dan dialihkan lewat jalur yang sama kayak
  // drag-drop, alih-alih ke-paste sebagai teks biasa di textarea. Listener
  // global (document-level) supaya paste-nya kedeteksi di mana pun fokusnya
  // lagi berada, bukan cuma pas lagi klik di textarea.
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items
      if (!items) return

      const pastedFiles = Array.from(items)
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter(Boolean)

      if (pastedFiles.length === 0) return // teks biasa — biarkan paste default jalan

      e.preventDefault()
      addFiles(pastedFiles)
      switchTab('file')
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [addFiles])

  // Tempel manual lewat Clipboard API (dipicu tombol, bukan event paste
  // otomatis). Ini user-gesture asli, jadi bisa akses clipboard system
  // langsung — gak kena blokir popup clipboard bawaan Android yang kadang
  // nolak nempelin gambar ke textarea biasa (lihat komentar di handlePaste
  // effect di atas). Kalau isinya gambar, otomatis dialihkan ke tab file
  // sama kayak handlePaste; kalau teks, disisipkan ke textInput.
  const handleClipboardButton = useCallback(async () => {
    if (!navigator.clipboard?.read) {
      showToast('Browser ini tidak mendukung akses clipboard langsung', 'error')
      return
    }
    try {
      const clipboardItems = await navigator.clipboard.read()
      const imageFiles = []
      let pastedText = ''

      for (const item of clipboardItems) {
        const imageType = item.types.find(t => t.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          const ext = imageType.split('/')[1] || 'png'
          imageFiles.push(new File([blob], `clipboard-${Date.now()}.${ext}`, { type: imageType }))
          continue
        }
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain')
          pastedText = await blob.text()
        }
      }

      if (imageFiles.length > 0) {
        addFiles(imageFiles)
        setActiveTab('file')
        showToast('Gambar ditempel dari clipboard', 'success')
      } else if (pastedText) {
        setTextInput(prev => prev + pastedText)
        showToast('Teks ditempel dari clipboard', 'success')
      } else {
        showToast('Clipboard kosong atau formatnya tidak didukung', 'error')
      }
    } catch (err) {
      console.warn('Clipboard read gagal:', err)
      showToast('Gak bisa akses clipboard — coba tekan lama lalu pilih Tempel', 'error')
    }
  }, [addFiles, showToast])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSendText()
    }
  }

  return (
    <>
      <Head>
        <title>LocalShare</title>
        <meta name="description" content="Share files and text between your devices" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%235eead4'/%3E%3Ccircle cx='12' cy='12' r='7.2' fill='none' stroke='%2306201c' stroke-width='1.8' opacity='0.35'/%3E%3Ccircle cx='12' cy='12' r='4.3' fill='none' stroke='%2306201c' stroke-width='1.8' opacity='0.6'/%3E%3Ccircle cx='12' cy='12' r='1.3' fill='%2306201c'/%3E%3Cpath d='M12 12 L16.7 7.8' stroke='%2306201c' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E" />
      </Head>

      <div
        className="app"
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleFileDrop}
      >
        {/* Header */}
        <header className="header">
          <div className="header-left">
            <div className="logo">
              <div className="logo-icon"><IconRadar size={20} /></div>
              <span className="logo-text">Local<span>Share</span></span>
            </div>
            <div className="header-status">
              <div className={`status-dot ${connected ? 'connected' : ''}`} />
              {connected ? 'live' : 'connecting...'}
            </div>
          </div>

          <div className="header-right">
            {onlineDevices.length > 0 && (
              <div
                className="device-badge"
                title={onlineDevices.map(d => d.label).join(', ')}
              >
                <IconDot size={8} color="var(--signal)" /> {onlineDevices.length} device online
              </div>
            )}
            <div className="device-badge"><IconPhone size={12} /> {deviceLabel || '...'}</div>
            <button className="btn-clear" onClick={handleClearAll}>
              <IconTrash size={12} /> Clear All
            </button>
          </div>
        </header>

        <main className="main">
          {/* Send Panel */}
          <div className="send-panel">
            <div className="tabs">
              <div className={`tab-indicator ${activeTab === 'file' ? 'tab-indicator-file' : ''}`} />
              <button className={`tab ${activeTab === 'text' ? 'active' : ''}`} onClick={() => switchTab('text')}>
                <IconSpark size={13} /> Text / Link
              </button>
              <button className={`tab ${activeTab === 'file' ? 'active' : ''}`} onClick={() => switchTab('file')}>
                <IconUpload size={13} /> Upload File
              </button>
            </div>

            <div className="morph-panel">
              {/* Morphing container: same DOM node across both tabs, so its
                  box (size/shape) is what gets measured and FLIP-animated —
                  the textarea area visually grows/reshapes into the drop
                  zone / file list instead of one pane fading and another
                  fading in. */}
              <div className="morph-box" ref={morphBoxRef}>
                {activeTab === 'text' ? (
                  <div className="text-area-wrapper">
                    <textarea
                      ref={textareaRef}
                      placeholder="Ketik teks, paste link, atau apa saja... (Ctrl+Enter untuk kirim)"
                      value={textInput}
                      onChange={e => setTextInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={4}
                    />
                    <button
                      type="button"
                      className="btn-paste-clipboard"
                      onClick={handleClipboardButton}
                      title="Tempel dari clipboard"
                    >
                      <IconClipboard size={15} />
                    </button>
                    <span className="char-count">{textInput.length}</span>
                  </div>
                ) : selectedFiles.length === 0 ? (
                  <div
                    className={`drop-zone ${dragging ? 'dragging' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={e => {
                        const picked = Array.from(e.target.files || [])
                        if (picked.length > 0) addFiles(picked)
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="drop-icon"><IconFolder size={32} /></div>
                    <div className="drop-text">
                      <strong>Klik atau drag & drop</strong> file di sini (bisa lebih dari 1)
                    </div>
                    <div className="drop-limit">
                      Max {formatBytes(MAX_FILE_SIZE)} per file lewat server — lebih dari itu otomatis dikirim P2P langsung ke device lain
                    </div>
                  </div>
                ) : (
                  <div className="selected-files-list">
                    {selectedFiles.map((f, i) => (
                      <div className="selected-file" key={`${f.name}-${f.size}-${i}`}>
                        <span className="selected-file-icon"><FileIcon type={getFileIcon(f.type, f.name)} size={20} /></span>
                        <div className="selected-file-info">
                          <div className="selected-file-name">{f.name}</div>
                          <div className="selected-file-size">{formatBytes(f.size)}</div>
                        </div>
                        <button
                          className="btn-remove-file"
                          onClick={() => setSelectedFiles(prev => prev.filter((_, idx) => idx !== i))}
                        >
                          <IconClose size={11} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn-add-more-files"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      + Tambah file lagi
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={e => {
                        const picked = Array.from(e.target.files || [])
                        if (picked.length > 0) addFiles(picked)
                        e.target.value = ''
                      }}
                    />
                  </div>
                )}
              </div>

              {activeTab === 'file' && uploadProgress > 0 && (
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}

              <div className="device-row" ref={deviceRowRef}>
                <label>Dari:</label>
                <input
                  type="text"
                  placeholder={activeTab === 'text' ? 'Nama device (mis: Laptop, HP)' : 'Nama device'}
                  value={deviceLabel}
                  onChange={e => setDeviceLabel(e.target.value)}
                />
              </div>

              {/* Same button node across tabs — it tweens to its new position
                  via FLIP, and the label span inside fades/swaps text once
                  the move is mostly done (see the effect above). */}
              <button
                className="btn-send"
                ref={sendBtnRef}
                onClick={activeTab === 'text' ? handleSendText : handleSendFile}
                disabled={activeTab === 'text' ? (!textInput.trim() || sending) : (selectedFiles.length === 0 || sending)}
              >
                <span>
                  {activeTab === 'text'
                    ? (sending ? '...' : '↑ Kirim')
                    : (sending
                        ? `Uploading ${uploadProgress}%...`
                        : selectedFiles.length > 1
                          ? `↑ Upload ${selectedFiles.length} File`
                          : '↑ Upload File')}
                </span>
              </button>
            </div>
          </div>

          {/* P2P Transfers — hanya tampil kalau ada transfer aktif/baru selesai.
              Ini terpisah dari feed 'Shared Items' karena isinya ephemeral
              (tidak kesimpen di DB) dan cuma relevan buat 2 device yang
              terlibat, bukan disiarkan ke semua orang. */}
          {p2pTransfers.length > 0 && (
            <div>
              <div className="feed-header">
                <span className="feed-title">— P2P Transfer</span>
              </div>
              {p2pTransfers.map(t => (
                <P2PTransferCard key={t.id} t={t} onCancel={cancelTransfer} />
              ))}
            </div>
          )}

          {/* Feed */}
          <div>
            <div className="feed-header">
              <span className="feed-title">— Shared Items</span>
              <span className="feed-count">{messages.length} items</span>
            </div>

            <div className="feed">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><IconInbox size={32} /></div>
                  <div className="empty-text">Belum ada yang dibagikan.<br />Mulai kirim sesuatu!</div>
                </div>
              ) : (
                messages.map(msg => (
                  <MessageCard
                    key={msg.id}
                    msg={msg}
                    onDelete={handleDelete}
                    isNew={newIds.has(msg.id)}
                  />
                ))
              )}
            </div>
          </div>
        </main>
      </div>

      {toast && (
        <Toast
          msg={toast.msg}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {pendingP2PFiles && (
        <DevicePickerModal
          files={pendingP2PFiles}
          devices={onlineDevices}
          onPick={(device) => {
            pendingP2PFiles.forEach(f => initiateP2PTransfer(f, device))
            setPendingP2PFiles(null)
          }}
          onCancel={() => setPendingP2PFiles(null)}
        />
      )}
    </>
  )
}

export async function getServerSideProps() {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { data } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    return { props: { initialMessages: data || [] } }
  } catch (e) {
    return { props: { initialMessages: [] } }
  }
}
