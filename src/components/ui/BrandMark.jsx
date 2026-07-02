import { useState } from 'react'
import miraVaultSymbol from '@/assets/MiraVault_symbol.png'

function FallbackMark({ className = '' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" aria-hidden="true">
      <rect x="8" y="8" width="48" height="48" rx="14" fill="currentColor" opacity="0.14" />
      <path d="M32 10 16 17v12c0 12.4 6.4 21.7 16 26 9.6-4.3 16-13.6 16-26V17L32 10Z" fill="currentColor" opacity="0.28" />
      <path d="M22 23h7l3 12 3-12h7l-6.2 20h-7.6L22 23Z" fill="currentColor" />
    </svg>
  )
}

export default function BrandMark({ className = 'h-5 w-5', alt = 'MiraVault' }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <FallbackMark className={className} />
  }

  return (
    <img
      src={miraVaultSymbol}
      alt={alt}
      className={className}
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}
