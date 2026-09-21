use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const CREDENTIAL_SERVICE: &str = "com.omerdev.assetsbox";
const CREDENTIAL_ACCOUNT: &str = "aes-256-gcm-vault-key";
const VAULT_FILE: &str = "secrets.aes.json";
const VAULT_AUTHENTICATION_ERROR: &str =
    "The encrypted vault could not be authenticated. Your secret was not read.";

#[derive(Debug, Default, Serialize, Deserialize)]
struct SecretValues {
    #[serde(default)]
    values: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
struct EncryptedVault {
    version: u8,
    nonce: String,
    ciphertext: String,
}

fn vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join(VAULT_FILE))
        .map_err(|error| format!("Could not resolve the encrypted vault path: {error}"))
}

fn vault_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .map_err(|error| format!("Could not access Windows Credential Manager: {error}"))?;

    let encoded_key = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => {
            let mut key = [0_u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut key);
            let encoded = BASE64.encode(key);
            entry.set_password(&encoded).map_err(|error| {
                format!("Could not save the vault key to Windows Credential Manager: {error}")
            })?;
            return Ok(key);
        }
        Err(error) => {
            return Err(format!(
                "Could not read the vault key from Windows Credential Manager: {error}"
            ))
        }
    };

    let key_bytes = BASE64
        .decode(encoded_key)
        .map_err(|_| "The stored vault key is invalid. Delete the Assetsbox credential and add the token again.".to_string())?;
    key_bytes
        .try_into()
        .map_err(|_| "The stored vault key has an invalid length. Delete the Assetsbox credential and add the token again.".to_string())
}

fn reset_vault_key() -> Result<(), String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .map_err(|error| format!("Could not access Windows Credential Manager: {error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Could not reset the vault key in Windows Credential Manager: {error}"
        )),
    }
}

fn backup_unreadable_vault(app: &AppHandle) -> Result<(), String> {
    let path = vault_path(app)?;
    if !path.exists() {
        return Ok(());
    }

    let backup_path = path.with_file_name(format!(
        "secrets.unreadable-{}-{:016x}.aes.json",
        std::process::id(),
        rand::random::<u64>()
    ));
    fs::rename(&path, &backup_path).map_err(|error| {
        format!("Could not preserve the unreadable encrypted vault before recovery: {error}")
    })
}

fn recover_unreadable_vault(app: &AppHandle) -> Result<(), String> {
    // The vault is AES-GCM authenticated. A failed authentication means the
    // local ciphertext and Credential Manager key no longer match, so the old
    // values cannot be recovered. Preserve the ciphertext for diagnostics,
    // then create an independent vault for the new token.
    backup_unreadable_vault(app)?;
    reset_vault_key()
}

fn decrypt_vault(app: &AppHandle) -> Result<SecretValues, String> {
    let path = vault_path(app)?;
    if !path.exists() {
        return Ok(SecretValues::default());
    }

    let encrypted: EncryptedVault = serde_json::from_slice(
        &fs::read(&path).map_err(|error| format!("Could not read the encrypted vault: {error}"))?,
    )
    .map_err(|error| format!("Could not parse the encrypted vault: {error}"))?;
    if encrypted.version != 1 {
        return Err("The encrypted vault uses an unsupported version.".to_string());
    }

    let nonce_bytes = BASE64
        .decode(encrypted.nonce)
        .map_err(|_| "The encrypted vault nonce is invalid.".to_string())?;
    if nonce_bytes.len() != 12 {
        return Err("The encrypted vault nonce has an invalid length.".to_string());
    }
    let ciphertext = BASE64
        .decode(encrypted.ciphertext)
        .map_err(|_| "The encrypted vault ciphertext is invalid.".to_string())?;
    let key = vault_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "Could not initialize AES-256-GCM.".to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| VAULT_AUTHENTICATION_ERROR.to_string())?;

    serde_json::from_slice(&plaintext)
        .map_err(|error| format!("Could not decode the decrypted vault: {error}"))
}

fn encrypt_vault(app: &AppHandle, values: &SecretValues) -> Result<(), String> {
    let path = vault_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "The encrypted vault path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the encrypted vault directory: {error}"))?;

    let plaintext = serde_json::to_vec(values)
        .map_err(|error| format!("Could not encode the encrypted vault: {error}"))?;
    let key = vault_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "Could not initialize AES-256-GCM.".to_string())?;
    let mut nonce = [0_u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_ref())
        .map_err(|_| "Could not encrypt the secret with AES-256-GCM.".to_string())?;

    let encrypted = EncryptedVault {
        version: 1,
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(ciphertext),
    };
    let temporary_path = path.with_extension("tmp");
    fs::write(
        &temporary_path,
        serde_json::to_vec(&encrypted)
            .map_err(|error| format!("Could not serialize the encrypted vault: {error}"))?,
    )
    .map_err(|error| format!("Could not write the encrypted vault: {error}"))?;
    // Windows cannot replace an existing file with `rename` in every supported
    // configuration. Removing only this application's prior ciphertext keeps
    // token updates reliable without ever writing a plaintext vault to disk.
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Could not replace the encrypted vault: {error}"))?;
    }
    fs::rename(&temporary_path, &path)
        .map_err(|error| format!("Could not finalize the encrypted vault: {error}"))?;
    Ok(())
}

pub fn has(app: &AppHandle, name: &str) -> Result<bool, String> {
    Ok(decrypt_vault(app)?.values.contains_key(name))
}

pub fn get(app: &AppHandle, name: &str) -> Result<Option<String>, String> {
    Ok(decrypt_vault(app)?.values.get(name).cloned())
}

pub fn set_with_recovery(app: &AppHandle, name: &str, value: &str) -> Result<bool, String> {
    let (mut vault, recovered) = match decrypt_vault(app) {
        Ok(vault) => (vault, false),
        Err(error) if error == VAULT_AUTHENTICATION_ERROR => {
            recover_unreadable_vault(app)?;
            (SecretValues::default(), true)
        }
        Err(error) => return Err(error),
    };
    vault.values.insert(name.to_string(), value.to_string());
    encrypt_vault(app, &vault)?;
    Ok(recovered)
}

pub fn remove(app: &AppHandle, name: &str) -> Result<(), String> {
    let mut vault = decrypt_vault(app)?;
    vault.values.remove(name);
    encrypt_vault(app, &vault)
}
