// src/auth/dto/logout-result.dto.ts
export type LogoutResult = {
  userId: string
  sid?: string
  revokedElectronSid?: string | null
  hadActiveElectronBefore: boolean
  hasActiveElectronAfter: boolean
  webRefreshCleared: boolean
}
