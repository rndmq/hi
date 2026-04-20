import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

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
  if (!mimeType && !fileName) return '📎'
  const ext = fileName?.split('.').pop()?.toLowerCase()
  const mime = mimeType || ''

  if (mime.startsWith('image/')) return '🖼️'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('zip') || mime.includes('rar') || ['zip','rar','7z','tar','gz'].includes(ext)) return '🗜️'
  if (mime.includes('word') || ['doc','docx'].includes(ext)) return '📝'
  if (mime.includes('sheet') || ['xls','xlsx','csv'].includes(ext)) return '📊'
  if (mime.includes('presentation') || ['ppt','pptx'].includes(ext)) return '📑'
  if (['js','ts','py','java','cpp','html','css','json','php','go','rs'].includes(ext)) return '💾'
  if (['apk'].includes(ext)) return '📱'
  return '📎'
}

function isUrl(text) {
  try { return ['http:', 'https:'].includes(new URL(text.trim()).protocol) }
  catch { return false }
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
  return 'Device'
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
      {copied ? '✓ Copied' : '⎘ Copy'}
    </button>
  )
}

function MessageCard({ msg, onDelete, isNew }) {
  const isFile = msg.type === 'file'
  const isImage = msg.file_type?.startsWith('image/')
  const deviceClass = getDeviceClass(msg.device_label)

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
            <div className="file-card" style={{ marginTop: isImage ? 8 : 0 }}>
              <span className="file-icon">{getFileIcon(msg.file_type, msg.file_name)}</span>
              <div className="file-info">
                <div className="file-name">{msg.file_name}</div>
                <div className="file-size">{formatBytes(msg.file_size)}</div>
              </div>
              <a href={msg.content} target="_blank" rel="noopener noreferrer" download={msg.file_name} className="btn-download">
                ↓ Download
              </a>
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

      <button className="msg-delete-btn" onClick={() => onDelete(msg.id)} title="Delete">✕</button>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Home({ initialMessages }) {
  const [messages, setMessages] = useState(initialMessages || [])
  const [activeTab, setActiveTab] = useState('text')
  const [textInput, setTextInput] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [deviceLabel, setDeviceLabel] = useState('')
  const [sending, setSending] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [connected, setConnected] = useState(false)
  const [newIds, setNewIds] = useState(new Set())
  const [toast, setToast] = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef(null)
  const channelRef = useRef(null)

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
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
    if (!selectedFile) return
    setSending(true)
    setUploadProgress(0)

    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('device_label', deviceLabel)

    // Fake progress
    const progressInterval = setInterval(() => {
      setUploadProgress(p => Math.min(p + 10, 85))
    }, 200)

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      clearInterval(progressInterval)
      setUploadProgress(100)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }
      setSelectedFile(null)
      showToast('File uploaded!')
    } catch (e) {
      clearInterval(progressInterval)
      showToast(e.message, 'error')
    } finally {
      setSending(false)
      setTimeout(() => setUploadProgress(0), 500)
    }
  }

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`/api/messages?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleClearAll = async () => {
    if (!confirm('Clear semua pesan?')) return
    try {
      const res = await fetch('/api/clear', { method: 'DELETE' })
      if (!res.ok) throw new Error('Clear failed')
      setMessages([])
      showToast('Semua pesan dihapus')
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleFileDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) {
      setSelectedFile(file)
      setActiveTab('file')
    }
  }

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
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📡</text></svg>" />
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
              <div className="logo-icon">📡</div>
              <span className="logo-text">Local<span>Share</span></span>
            </div>
            <div className="header-status">
              <div className={`status-dot ${connected ? 'connected' : ''}`} />
              {connected ? 'live' : 'connecting...'}
            </div>
          </div>

          <div className="header-right">
            <div className="device-badge">📱 {deviceLabel || '...'}</div>
            <button className="btn-clear" onClick={handleClearAll}>
              🗑 Clear All
            </button>
          </div>
        </header>

        <main className="main">
          {/* Send Panel */}
          <div className="send-panel">
            <div className="tabs">
              <button className={`tab ${activeTab === 'text' ? 'active' : ''}`} onClick={() => setActiveTab('text')}>
                ✦ Text / Link
              </button>
              <button className={`tab ${activeTab === 'file' ? 'active' : ''}`} onClick={() => setActiveTab('file')}>
                ⬆ Upload File
              </button>
            </div>

            {/* Text Tab */}
            <div className={`tab-content ${activeTab === 'text' ? 'active' : ''}`}>
              <div className="text-area-wrapper">
                <textarea
                  placeholder="Ketik teks, paste link, atau apa saja... (Ctrl+Enter untuk kirim)"
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={4}
                />
                <span className="char-count">{textInput.length}</span>
              </div>

              <div className="device-row">
                <label>Dari:</label>
                <input
                  type="text"
                  placeholder="Nama device (mis: Laptop, HP)"
                  value={deviceLabel}
                  onChange={e => setDeviceLabel(e.target.value)}
                />
              </div>

              <button
                className="btn-send"
                onClick={handleSendText}
                disabled={!textInput.trim() || sending}
              >
                {sending ? '...' : '↑ Kirim'}
              </button>
            </div>

            {/* File Tab */}
            <div className={`tab-content ${activeTab === 'file' ? 'active' : ''}`}>
              {!selectedFile ? (
                <div
                  className={`drop-zone ${dragging ? 'dragging' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                    onClick={e => e.stopPropagation()}
                  />
                  <div className="drop-icon">📂</div>
                  <div className="drop-text">
                    <strong>Klik atau drag & drop</strong> file di sini
                  </div>
                  <div className="drop-limit">Max 50MB</div>
                </div>
              ) : (
                <div className="selected-file">
                  <span className="selected-file-icon">{getFileIcon(selectedFile.type, selectedFile.name)}</span>
                  <div className="selected-file-info">
                    <div className="selected-file-name">{selectedFile.name}</div>
                    <div className="selected-file-size">{formatBytes(selectedFile.size)}</div>
                  </div>
                  <button className="btn-remove-file" onClick={() => setSelectedFile(null)}>✕</button>
                </div>
              )}

              {uploadProgress > 0 && (
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}

              <div className="device-row">
                <label>Dari:</label>
                <input
                  type="text"
                  placeholder="Nama device"
                  value={deviceLabel}
                  onChange={e => setDeviceLabel(e.target.value)}
                />
              </div>

              <button
                className="btn-send"
                onClick={handleSendFile}
                disabled={!selectedFile || sending}
              >
                {sending ? `Uploading ${uploadProgress}%...` : '↑ Upload File'}
              </button>
            </div>
          </div>

          {/* Feed */}
          <div>
            <div className="feed-header">
              <span className="feed-title">— Shared Items</span>
              <span className="feed-count">{messages.length} items</span>
            </div>

            <div className="feed">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📭</div>
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
