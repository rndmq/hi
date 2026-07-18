// sw.js — service worker minimal buat PWA. Fokusnya cuma 2 hal:
// 1) bikin app ini "installable" (syarat teknis PWA butuh SW terdaftar)
// 2) app shell (HTML/JS/CSS/icon) tetep bisa kebuka pas offline
//
// SENGAJA TIDAK di-cache: response dari /api/* atau domain lain (Supabase
// Storage/Realtime, Google Fonts) — itu semua data live (feed real-time,
// file), nge-cache itu malah bikin user lihat data basi. Strategi
// network-first: kalau online, selalu ambil versi terbaru; baru kalau gagal
// (offline) balik ke cache.

const CACHE_NAME = 'localshare-shell-v1'
const SHELL_URLS = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Jangan sentuh apa pun selain GET, dan jangan sentuh API atau domain lain
  // sama sekali — itu harus selalu live, tidak boleh ke-cache lewat sini.
  if (event.request.method !== 'GET') return
  if (url.pathname.startsWith('/api/')) return
  if (url.origin !== self.location.origin) return

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone))
        return res
      })
      .catch(() => caches.match(event.request))
  )
})
