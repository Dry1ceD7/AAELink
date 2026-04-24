'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { Camera, ImageOff } from 'lucide-react'

import { Avatar } from '@/components/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { ApiError, authApi, mediaApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

const LOCALE_OPTIONS = ['en', 'th', 'de'] as const

export default function ProfilePage() {
  const t = useTranslations()
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)

  const [displayName, setDisplayName] = useState('')
  const [locale, setLocale] = useState('en')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileFlash, setProfileFlash] = useState<{
    kind: 'ok' | 'err'
    text: string
  } | null>(null)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwFlash, setPwFlash] = useState<{
    kind: 'ok' | 'err'
    text: string
  } | null>(null)

  const [avatarBust, setAvatarBust] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarFlash, setAvatarFlash] = useState<{
    kind: 'ok' | 'err'
    text: string
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    setDisplayName(user.display_name)
    setLocale(user.preferred_locale || 'en')
  }, [user])

  function flash(
    set: (v: { kind: 'ok' | 'err'; text: string } | null) => void,
    kind: 'ok' | 'err',
    text: string,
  ) {
    set({ kind, text })
    setTimeout(() => set(null), 3500)
  }

  async function onSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSavingProfile(true)
    try {
      const updated = await authApi.updateMe({
        display_name: displayName.trim(),
        preferred_locale: locale,
      })
      setUser(updated)
      flash(setProfileFlash, 'ok', t('profile.updated'))
    } catch (err) {
      flash(
        setProfileFlash,
        'err',
        err instanceof ApiError ? err.message : t('common.error'),
      )
    } finally {
      setSavingProfile(false)
    }
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) {
      flash(setPwFlash, 'err', t('profile.passwordMismatch'))
      return
    }
    setSavingPw(true)
    try {
      await authApi.changePassword(currentPw, newPw)
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      flash(setPwFlash, 'ok', t('profile.passwordUpdated'))
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 401
          ? t('profile.currentPasswordWrong')
          : err instanceof ApiError
            ? err.message
            : t('common.error')
      flash(setPwFlash, 'err', msg)
    } finally {
      setSavingPw(false)
    }
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setUploadingAvatar(true)
    try {
      const res = await mediaApi.uploadAvatar(file)
      // Persist a stable, cache-buster-prefixed URL on the user record so other
      // pages immediately reflect the new avatar.
      const url = res.url
      const updated = await authApi.updateMe({ avatar_url: url })
      setUser(updated)
      setAvatarBust(String(Date.now()))
      flash(setAvatarFlash, 'ok', t('profile.avatarUpdated'))
    } catch (err) {
      flash(
        setAvatarFlash,
        'err',
        err instanceof ApiError ? err.message : t('common.error'),
      )
    } finally {
      setUploadingAvatar(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onRemoveAvatar() {
    if (!user) return
    setUploadingAvatar(true)
    try {
      const updated = await authApi.updateMe({ avatar_url: null })
      setUser(updated)
      setAvatarBust(String(Date.now()))
      flash(setAvatarFlash, 'ok', t('profile.avatarRemoved'))
    } catch (err) {
      flash(
        setAvatarFlash,
        'err',
        err instanceof ApiError ? err.message : t('common.error'),
      )
    } finally {
      setUploadingAvatar(false)
    }
  }

  if (!user) return null
  const avatarSrc = user.avatar_url
    ? `${user.avatar_url}${avatarBust ? `&b=${avatarBust}` : ''}`
    : undefined

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[color:var(--fg)]">
          {t('profile.title')}
        </h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          {t('profile.subtitle')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('profile.pictureTitle')}</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <Avatar
            src={avatarSrc}
            name={user.display_name}
            email={user.email}
            size={88}
          />
          <div className="flex-1 space-y-2">
            <p className="text-sm text-[color:var(--muted)]">
              {t('profile.pictureHint')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onPickAvatar}
              />
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={uploadingAvatar}
                onClick={() => fileRef.current?.click()}
              >
                <Camera className="h-4 w-4" />
                {t('profile.uploadPicture')}
              </Button>
              {user.avatar_url && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRemoveAvatar}
                  disabled={uploadingAvatar}
                >
                  <ImageOff className="h-4 w-4" />
                  {t('profile.removePicture')}
                </Button>
              )}
            </div>
            {avatarFlash && (
              <p
                className={
                  avatarFlash.kind === 'ok'
                    ? 'text-xs text-green-600'
                    : 'text-xs text-red-600'
                }
              >
                {avatarFlash.text}
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('profile.detailsTitle')}</CardTitle>
        </CardHeader>
        <form onSubmit={onSaveProfile}>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('admin.email')}</Label>
              <Input id="email" value={user.email} disabled readOnly />
              <p className="text-xs text-[color:var(--muted)]">
                {t('profile.emailReadOnly')}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">{t('admin.displayName')}</Label>
              <Input
                id="displayName"
                value={displayName}
                required
                minLength={1}
                maxLength={255}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="locale">{t('admin.locale')}</Label>
              <Select
                id="locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                {LOCALE_OPTIONS.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </Select>
            </div>
          </CardBody>
          <CardFooter className="justify-between">
            <span className="text-xs">
              {profileFlash && (
                <span
                  className={
                    profileFlash.kind === 'ok'
                      ? 'text-green-600'
                      : 'text-red-600'
                  }
                >
                  {profileFlash.text}
                </span>
              )}
            </span>
            <Button type="submit" loading={savingProfile}>
              {t('admin.save')}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('profile.passwordTitle')}</CardTitle>
        </CardHeader>
        <form onSubmit={onChangePassword}>
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="currentPw">{t('profile.currentPassword')}</Label>
              <Input
                id="currentPw"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPw">{t('profile.newPassword')}</Label>
              <Input
                id="newPw"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPw">{t('profile.confirmPassword')}</Label>
              <Input
                id="confirmPw"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
              />
            </div>
          </CardBody>
          <CardFooter className="justify-between">
            <span className="text-xs">
              {pwFlash && (
                <span
                  className={
                    pwFlash.kind === 'ok' ? 'text-green-600' : 'text-red-600'
                  }
                >
                  {pwFlash.text}
                </span>
              )}
            </span>
            <Button type="submit" loading={savingPw}>
              {t('profile.changePassword')}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
