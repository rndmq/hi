import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="id">
      <Head>
        <meta name="theme-color" content="#0c0c0f" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* iOS Safari tidak baca display:"standalone" dari manifest.json —
            butuh meta tag Apple sendiri biar "Add to Home Screen" hasilnya
            full-screen tanpa address bar, bukan cuma shortcut biasa. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="LocalShare" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
