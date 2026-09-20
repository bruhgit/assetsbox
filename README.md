# Assetsbox

Assetsbox is a Tauri 2 desktop marketplace and project-asset manager for Godot, Unity, Unreal Engine, and GameMaker projects.

## Security

- API tokens are never written to source control, `localStorage`, build output, or logs.
- The current Sketchfab token is stored only in the local AES-256-GCM vault.
- The 256-bit vault key is generated locally and stored in the current Windows user's Credential Manager entry named `com.omerdev.assetsbox`.
- The encrypted vault is stored under the app-local data directory as `secrets.aes.json`; it is ignored by Git and cannot be decrypted without the Credential Manager key.
- The token is used by the Rust backend for Sketchfab download resolution and is never returned to the webview.

If a token was previously saved by the Electron build, remove it from that retired build before uninstalling it and add it again in the Tauri app's Settings screen.

## Development

Requirements: Rust and Node.js.

```powershell
npm install
npm run dev
```

Create a Windows installer:

```powershell
npm run build
```

## Public repository checklist

Before publishing, run the secret scan below. It checks tracked files only and must return no matches containing a credential value.

```powershell
git grep -nEi "(sketchfab[_-]?token|api[_-]?key|authorization:|secret)" -- . ':!README.md' ':!SECURITY.md'
```
