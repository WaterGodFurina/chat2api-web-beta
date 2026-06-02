import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settingsStore'
import { Lock, FileText, KeyRound } from 'lucide-react'
import { webAPI } from '@/web-api'

export function SecuritySettings() {
  const { t } = useTranslation()
  const {
    credentialEncryption,
    setCredentialEncryption,
    logDesensitization,
    setLogDesensitization,
  } = useSettingsStore()

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const handleChangePassword = async () => {
    setPasswordError('')
    setPasswordSuccess('')

    if (!currentPassword) {
      setPasswordError('Please enter current password')
      return
    }
    if (!newPassword) {
      setPasswordError('Please enter new password')
      return
    }
    if (newPassword.length < 4) {
      setPasswordError('New password must be at least 4 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }

    setChangingPassword(true)
    try {
      await webAPI.auth.changePassword(currentPassword, newPassword)
      setPasswordSuccess('Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Backend Password
          </CardTitle>
          <CardDescription>Change the backend access password. Password is stored as MD5 hash in ./data/password.txt</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              placeholder="Enter current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="Enter new password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {passwordError && (
            <p className="text-sm text-red-500">{passwordError}</p>
          )}
          {passwordSuccess && (
            <p className="text-sm text-green-500">{passwordSuccess}</p>
          )}
          <Button
            onClick={handleChangePassword}
            disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
          >
            {changingPassword ? 'Changing...' : 'Change Password'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {t('settings.credentialEncryption')}
          </CardTitle>
          <CardDescription>{t('settings.credentialEncryptionHelp')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="credential-encryption">{t('settings.credentialEncryption')}</Label>
            </div>
            <Switch
              id="credential-encryption"
              checked={credentialEncryption}
              onCheckedChange={setCredentialEncryption}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t('settings.logDesensitization')}
          </CardTitle>
          <CardDescription>{t('settings.logDesensitizationHelp')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="log-desensitization">{t('settings.logDesensitization')}</Label>
            </div>
            <Switch
              id="log-desensitization"
              checked={logDesensitization}
              onCheckedChange={setLogDesensitization}
            />
          </div>
          <div className="rounded-md bg-muted p-4">
            <p className="text-sm font-medium mb-2">{t('settings.example')}</p>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Original: sk-1234567890abcdef1234567890abcdef</p>
              <p>Masked: sk-1234****cdef</p>
            </div>
          </div>
        </CardContent>
      </Card>
    
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <KeyRound className="h-5 w-5" />
            Logout / Session
          </CardTitle>
          <CardDescription>Terminate your current session and return to the login interface secure screen.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            variant="destructive" 
            onClick={async () => {
              try {
                await webAPI.auth.logout()
                window.location.reload()
              } catch (err) {
                console.error('Logout failed:', err)
              }
            }}
          >
            Log Out
          </Button>
        </CardContent>
      </Card>
</div>
  )
}
