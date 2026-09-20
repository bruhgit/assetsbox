# Security policy

Do not commit API tokens, passwords, encrypted-vault files, private keys, installer output, or local application profiles.

Assetsbox uses AES-256-GCM for secret encryption and a random 256-bit key stored in the operating system's credential store. Report a suspected exposure by rotating the affected provider token immediately, then remove the credential from the local Tauri settings.
