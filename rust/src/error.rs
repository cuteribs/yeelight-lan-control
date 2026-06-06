use std::io;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum YeelightError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, YeelightError>;

impl From<&str> for YeelightError {
    fn from(value: &str) -> Self {
        Self::Message(value.to_owned())
    }
}

impl From<String> for YeelightError {
    fn from(value: String) -> Self {
        Self::Message(value)
    }
}
