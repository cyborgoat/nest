use crate::error::{AppError, AppResult};
use crate::vault;
use std::fs::{self, File};
use std::io::copy;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

/// Extract a zip archive into `dest_root`. Returns the path of the first
/// top-level entry under `dest_root` (used by Hub downloads that place the
/// pack folder at the archive root).
pub(crate) fn extract_zip_to_dir(zip_path: &Path, dest_root: &Path) -> AppResult<PathBuf> {
    vault::ensure_dir(dest_root)?;
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut top: Option<String> = None;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();
        if name.contains("..") {
            return Err(AppError::msg("Zip contains unsafe path"));
        }
        let outpath = dest_root.join(&name);
        if file.is_dir() {
            vault::ensure_dir(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                vault::ensure_dir(parent)?;
            }
            let mut outfile = File::create(&outpath)?;
            copy(&mut file, &mut outfile)?;
        }
        if top.is_none() {
            top = Some(name.split('/').next().unwrap_or(&name).to_string());
        }
    }
    Ok(dest_root.join(top.unwrap_or_default()))
}

/// Temporary directory that is removed on drop unless [`StagingDir::persist`]
/// is called (e.g. after renaming the contents into place).
pub(crate) struct StagingDir {
    path: PathBuf,
    keep: bool,
}

impl StagingDir {
    pub(crate) fn create(path: PathBuf) -> AppResult<Self> {
        vault::ensure_dir(&path)?;
        Ok(Self { path, keep: false })
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// Leave the directory on disk when this guard is dropped.
    #[allow(dead_code)]
    pub(crate) fn persist(mut self) {
        self.keep = true;
    }

    /// Alias for [`StagingDir::persist`].
    #[allow(dead_code)]
    pub(crate) fn forget(mut self) {
        self.keep = true;
    }
}

impl Drop for StagingDir {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

impl AsRef<Path> for StagingDir {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

impl std::ops::Deref for StagingDir {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.path
    }
}
