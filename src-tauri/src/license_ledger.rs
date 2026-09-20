use std::fs;
use std::path::PathBuf;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const LEDGER_FILE: &str = "license-acceptances.json";
const MAX_RECORDS: usize = 1_000;
const ACCEPTANCE_VALIDITY_MINUTES: i64 = 15;

#[derive(Clone, Serialize, Deserialize)]
pub struct LicenseAcceptance {
    pub id: String,
    pub asset_id: String,
    pub source: String,
    pub license: String,
    pub listing_url: String,
    pub accepted_at: DateTime<Utc>,
    #[serde(default)]
    pub used_at: Option<DateTime<Utc>>,
}

#[derive(Default, Serialize, Deserialize)]
struct LicenseLedger {
    #[serde(default)]
    records: Vec<LicenseAcceptance>,
}

fn ledger_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join(LEDGER_FILE))
        .map_err(|error| format!("Could not resolve the local license ledger path: {error}"))
}

fn clean_value(value: &str, label: &str, maximum_length: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > maximum_length {
        return Err(format!("A valid {label} is required."));
    }
    Ok(trimmed.to_string())
}

fn validate_listing(source: &str, listing_url: &str) -> Result<(), String> {
    let url = Url::parse(listing_url)
        .map_err(|_| "The official asset listing URL is invalid.".to_string())?;
    if url.scheme() != "https" {
        return Err("The official asset listing must use HTTPS.".to_string());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let source_matches_host = match source {
        "sketchfab" => host == "sketchfab.com" || host.ends_with(".sketchfab.com"),
        "pixabay" => host == "pixabay.com" || host.ends_with(".pixabay.com"),
        "itchio" => host == "itch.io" || host.ends_with(".itch.io"),
        _ => false,
    };
    if !source_matches_host {
        return Err("The listing must belong to the selected asset provider.".to_string());
    }
    Ok(())
}

fn validate_acceptance(
    asset_id: &str,
    source: &str,
    license: &str,
    listing_url: &str,
) -> Result<(String, String, String, String), String> {
    let asset_id = clean_value(asset_id, "asset identifier", 256)?;
    let source = clean_value(source, "asset source", 32)?.to_ascii_lowercase();
    if !matches!(source.as_str(), "sketchfab" | "pixabay" | "itchio") {
        return Err("This asset provider is not supported for direct downloads.".to_string());
    }
    let license = clean_value(license, "license information", 512)?;
    let normalized_license = license.to_ascii_lowercase();
    if normalized_license.contains("unknown")
        || normalized_license.contains("unavailable")
        || normalized_license.contains("verify")
    {
        return Err("Assets with an unknown license cannot be downloaded. Review the official listing first.".to_string());
    }
    let listing_url = clean_value(listing_url, "official listing URL", 2_048)?;
    validate_listing(&source, &listing_url)?;
    Ok((asset_id, source, license, listing_url))
}

fn read_ledger(app: &AppHandle) -> Result<LicenseLedger, String> {
    let path = ledger_path(app)?;
    if !path.exists() {
        return Ok(LicenseLedger::default());
    }
    serde_json::from_slice(
        &fs::read(path)
            .map_err(|error| format!("Could not read the local license ledger: {error}"))?,
    )
    .map_err(|error| format!("Could not parse the local license ledger: {error}"))
}

fn write_ledger(app: &AppHandle, ledger: &LicenseLedger) -> Result<(), String> {
    let path = ledger_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "The local license ledger path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the local license ledger directory: {error}"))?;
    let temporary = path.with_extension("tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(ledger)
            .map_err(|error| format!("Could not serialize the local license ledger: {error}"))?,
    )
    .map_err(|error| format!("Could not write the local license ledger: {error}"))?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Could not update the local license ledger: {error}"))?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Could not finalize the local license ledger: {error}"))?;
    Ok(())
}

pub fn record(
    app: &AppHandle,
    asset_id: &str,
    source: &str,
    license: &str,
    listing_url: &str,
) -> Result<LicenseAcceptance, String> {
    let (asset_id, source, license, listing_url) =
        validate_acceptance(asset_id, source, license, listing_url)?;
    let now = Utc::now();
    let mut random = [0_u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut random);
    let acceptance = LicenseAcceptance {
        id: format!(
            "lic-{}-{}",
            now.timestamp_millis(),
            URL_SAFE_NO_PAD.encode(random)
        ),
        asset_id,
        source,
        license,
        listing_url,
        accepted_at: now,
        used_at: None,
    };
    let mut ledger = read_ledger(app)?;
    ledger.records.push(acceptance.clone());
    if ledger.records.len() > MAX_RECORDS {
        let excess = ledger.records.len() - MAX_RECORDS;
        ledger.records.drain(0..excess);
    }
    write_ledger(app, &ledger)?;
    Ok(acceptance)
}

pub fn consume(
    app: &AppHandle,
    acceptance_id: &str,
    asset_id: &str,
) -> Result<LicenseAcceptance, String> {
    let acceptance_id = clean_value(acceptance_id, "license acceptance", 256)?;
    let asset_id = clean_value(asset_id, "asset identifier", 256)?;
    let mut ledger = read_ledger(app)?;
    let acceptance = ledger
        .records
        .iter_mut()
        .find(|record| record.id == acceptance_id)
        .ok_or_else(|| {
            "License acceptance is required before downloading this asset.".to_string()
        })?;
    if acceptance.asset_id != asset_id {
        return Err("The license acceptance does not match this asset.".to_string());
    }
    if acceptance.used_at.is_some() {
        return Err(
            "This license acceptance was already used. Review and accept the license again."
                .to_string(),
        );
    }
    let now = Utc::now();
    if now.signed_duration_since(acceptance.accepted_at)
        > Duration::minutes(ACCEPTANCE_VALIDITY_MINUTES)
    {
        return Err(
            "The license acceptance expired. Review and accept the license again.".to_string(),
        );
    }
    acceptance.used_at = Some(now);
    let result = acceptance.clone();
    write_ledger(app, &ledger)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::validate_acceptance;

    #[test]
    fn accepts_a_known_provider_and_license() {
        assert!(validate_acceptance(
            "model-1",
            "sketchfab",
            "CC Attribution",
            "https://sketchfab.com/3d-models/model-1"
        )
        .is_ok());
    }

    #[test]
    fn rejects_unknown_license_information() {
        assert!(validate_acceptance(
            "model-1",
            "sketchfab",
            "License unavailable — verify at source",
            "https://sketchfab.com/3d-models/model-1"
        )
        .is_err());
    }

    #[test]
    fn rejects_a_listing_from_another_provider() {
        assert!(validate_acceptance(
            "model-1",
            "sketchfab",
            "CC Attribution",
            "https://example.com/model-1"
        )
        .is_err());
    }
}
