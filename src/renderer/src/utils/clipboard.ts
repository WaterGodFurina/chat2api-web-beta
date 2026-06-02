/**
 * Copy text to clipboard with fallback for non-HTTPS environments
 * In HTTP web mode, navigator.clipboard API is not available
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
  } else {
    // Fallback for non-HTTPS environments (HTTP web mode)
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '-9999px'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textArea)
    if (!success) {
      throw new Error('Failed to copy text to clipboard')
    }
  }
}

/**
 * Read text from clipboard with fallback for non-HTTPS environments
 */
export async function readFromClipboard(): Promise<string> {
  if (navigator.clipboard && window.isSecureContext) {
    return await navigator.clipboard.readText()
  } else {
    // Fallback: create a textarea and try to paste
    // Note: reading clipboard without HTTPS is generally not supported
    // This is a best-effort approach
    throw new Error('Clipboard read is not available in non-HTTPS environment')
  }
}
