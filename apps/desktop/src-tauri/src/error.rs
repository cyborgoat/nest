use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("{message}")]
    HubResponse { status: u16, message: String },
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn msg(msg: impl Into<String>) -> Self {
        Self::Message(msg.into())
    }

    pub fn hub_response(status: u16, message: impl Into<String>) -> Self {
        Self::HubResponse {
            status,
            message: message.into(),
        }
    }

    pub fn is_unauthorized(&self) -> bool {
        matches!(self, Self::HubResponse { status: 401, .. })
    }
}
