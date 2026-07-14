use crate::db;
use crate::error::AppResult;
use crate::vault;
use rusqlite::Connection;
use std::path::Path;
use uuid::Uuid;
use walkdir::WalkDir;

const TARGET_CHUNK_CHARS: usize = 1200;
const OVERLAP_CHARS: usize = 150;

#[derive(Debug, Clone)]
pub struct TextChunk {
    pub title: String,
    pub content: String,
    pub start: usize,
    pub end: usize,
}

pub fn chunk_markdown(text: &str, fallback_title: &str) -> Vec<TextChunk> {
    let mut chunks = Vec::new();
    let mut current_title = fallback_title.to_string();
    let mut buffer = String::new();
    let mut buffer_start = 0usize;
    let mut offset = 0usize;

    for line in text.split_inclusive('\n') {
        let line_len = line.len();
        if line.trim_start().starts_with('#') {
            if !buffer.trim().is_empty() {
                chunks.push(TextChunk {
                    title: current_title.clone(),
                    content: buffer.trim().to_string(),
                    start: buffer_start,
                    end: offset,
                });
            }
            current_title = line.trim().trim_start_matches('#').trim().to_string();
            if current_title.is_empty() {
                current_title = fallback_title.to_string();
            }
            buffer.clear();
            buffer_start = offset;
        }

        if buffer.len() + line_len > TARGET_CHUNK_CHARS && !buffer.is_empty() {
            chunks.push(TextChunk {
                title: current_title.clone(),
                content: buffer.trim().to_string(),
                start: buffer_start,
                end: offset,
            });
            let overlap = if buffer.len() > OVERLAP_CHARS {
                buffer[buffer.len() - OVERLAP_CHARS..].to_string()
            } else {
                buffer.clone()
            };
            buffer_start = offset.saturating_sub(overlap.len());
            buffer = overlap;
        }
        buffer.push_str(line);
        offset += line_len;
    }

    if !buffer.trim().is_empty() {
        chunks.push(TextChunk {
            title: current_title,
            content: buffer.trim().to_string(),
            start: buffer_start,
            end: offset,
        });
    }

    if chunks.is_empty() && !text.trim().is_empty() {
        chunks.push(TextChunk {
            title: fallback_title.to_string(),
            content: text.trim().to_string(),
            start: 0,
            end: text.len(),
        });
    }

    chunks
}

/// Gather Markdown chunks from the vault (no DB / no network).
pub fn collect_pending_chunks(
    vault_root: &Path,
) -> AppResult<Vec<(String, String, String, String, usize, usize)>> {
    let mut pending: Vec<(String, String, String, String, usize, usize)> = Vec::new();

    for entry in WalkDir::new(vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if !path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
        {
            continue;
        }
        let rel = path
            .strip_prefix(vault_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let content = match vault::read_file(vault_root, &rel) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let fallback = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("untitled")
            .to_string();
        for ch in chunk_markdown(&content, &fallback) {
            pending.push((
                Uuid::new_v4().to_string(),
                rel.clone(),
                ch.title,
                ch.content,
                ch.start,
                ch.end,
            ));
        }
    }
    Ok(pending)
}

/// Persist chunks into SQLite + FTS5.
pub fn persist_chunks(
    conn: &Connection,
    pending: &[(String, String, String, String, usize, usize)],
) -> AppResult<(u32, u32)> {
    db::clear_chunks(conn)?;
    let mut files = std::collections::HashSet::new();
    for (id, file_path, title, content, start, end) in pending {
        files.insert(file_path.clone());
        db::insert_chunk(conn, id, file_path, title, content, *start, *end)?;
    }
    let file_count = files.len() as u32;
    let chunk_count = pending.len() as u32;
    db::set_index_meta(
        conn,
        file_count,
        chunk_count,
        Some("Local FTS + vector index (FastEmbed)"),
    )?;
    Ok((file_count, chunk_count))
}
