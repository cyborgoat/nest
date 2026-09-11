#[cfg(test)]
use crate::db;
use crate::db::IndexedFile;
use crate::error::AppResult;
use crate::vault;
#[cfg(test)]
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

const TARGET_CHUNK_CHARS: usize = 1200;
pub(crate) const OVERLAP_CHARS: usize = 150;
pub const CHUNKER_VERSION: u32 = 1;
pub const EMBEDDING_VERSION: &str = "all-minilm-l6-v2-q:384:v1";

#[derive(Debug, Clone)]
pub struct TextChunk {
    pub title: String,
    pub content: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone)]
pub struct PendingChunk {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub content: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug)]
pub struct PendingFile {
    pub metadata: IndexedFile,
    pub chunks: Vec<PendingChunk>,
}

#[derive(Debug)]
pub struct IndexPlan {
    pub changed: Vec<PendingFile>,
    pub deleted: Vec<String>,
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
                let mut start = buffer.len() - OVERLAP_CHARS;
                while !buffer.is_char_boundary(start) {
                    start += 1;
                }
                buffer[start..].to_string()
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

fn stable_chunk_id(file_path: &str, chunk: &TextChunk) -> String {
    let mut input =
        String::with_capacity(file_path.len() + chunk.title.len() + chunk.content.len());
    input.push_str(file_path);
    input.push('\0');
    input.push_str(&chunk.start.to_string());
    input.push('\0');
    input.push_str(&chunk.end.to_string());
    input.push('\0');
    input.push_str(&chunk.title);
    input.push('\0');
    input.push_str(&chunk.content);
    blake3::hash(input.as_bytes()).to_hex().to_string()
}

/// Compare the vault with the last committed file metadata. Unchanged files
/// are never read or chunked when size/mtime and index format versions match.
pub fn collect_index_plan(
    vault_root: &Path,
    known_files: Vec<IndexedFile>,
    force: bool,
) -> AppResult<IndexPlan> {
    let known = known_files
        .into_iter()
        .map(|file| (file.file_path.clone(), file))
        .collect::<HashMap<_, _>>();
    let mut seen = HashSet::new();
    let mut changed = Vec::new();

    for entry in WalkDir::new(vault_root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || !crate::vault::is_markdown_path(path) {
            continue;
        }
        let rel = path
            .strip_prefix(vault_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        seen.insert(rel.clone());
        let fs_metadata = path.metadata()?;
        let size_bytes = fs_metadata.len();
        let modified_ns = fs_metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos().min(u128::from(u64::MAX)) as u64)
            .unwrap_or_default();
        let unchanged = !force
            && known.get(&rel).is_some_and(|old| {
                old.size_bytes == size_bytes
                    && old.modified_ns == modified_ns
                    && old.chunker_version == CHUNKER_VERSION
                    && old.embedding_version == EMBEDDING_VERSION
            });
        if unchanged {
            continue;
        }

        let content = match vault::read_file(vault_root, &rel) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let content_hash = blake3::hash(content.as_bytes()).to_hex().to_string();
        let fallback = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("untitled");
        let chunks = chunk_markdown(&content, fallback)
            .into_iter()
            .map(|chunk| PendingChunk {
                id: stable_chunk_id(&rel, &chunk),
                file_path: rel.clone(),
                title: chunk.title,
                content: chunk.content,
                start: chunk.start,
                end: chunk.end,
            })
            .collect();
        changed.push(PendingFile {
            metadata: IndexedFile {
                file_path: rel,
                content_hash,
                size_bytes,
                modified_ns,
                chunker_version: CHUNKER_VERSION,
                embedding_version: EMBEDDING_VERSION.to_string(),
            },
            chunks,
        });
    }

    let deleted = known
        .into_keys()
        .filter(|path| !seen.contains(path))
        .collect();
    Ok(IndexPlan { changed, deleted })
}

/// Persist chunks into SQLite + FTS5.
#[cfg(test)]
pub fn persist_chunks(conn: &Connection, pending: &[PendingChunk]) -> AppResult<(u32, u32)> {
    db::clear_chunks(conn)?;
    let mut files = std::collections::HashSet::new();
    for chunk in pending {
        files.insert(chunk.file_path.clone());
        db::insert_chunk(
            conn,
            &chunk.id,
            &chunk.file_path,
            &chunk.title,
            &chunk.content,
            chunk.start,
            chunk.end,
        )?;
    }
    let file_count = files.len() as u32;
    let chunk_count = pending.len() as u32;
    Ok((file_count, chunk_count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn returns_empty_for_blank_text() {
        assert!(chunk_markdown("", "untitled").is_empty());
        assert!(chunk_markdown("   \n\n  ", "untitled").is_empty());
    }

    #[test]
    fn short_text_without_headings_is_one_chunk_under_the_fallback_title() {
        let chunks = chunk_markdown("Just a short paragraph.", "My Note");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].title, "My Note");
        assert_eq!(chunks[0].content, "Just a short paragraph.");
        assert_eq!(chunks[0].start, 0);
    }

    #[test]
    fn splits_at_each_heading_and_titles_the_following_chunk() {
        let text = "# Intro\nIntro body.\n## Details\nDetails body.\n";
        let chunks = chunk_markdown(text, "fallback");
        let titles: Vec<&str> = chunks.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, vec!["Intro", "Details"]);
        assert!(chunks[0].content.contains("Intro body."));
        assert!(chunks[1].content.contains("Details body."));
    }

    #[test]
    fn empty_heading_text_falls_back_to_the_fallback_title() {
        // A bare "#" (or one that's only whitespace after stripping markers)
        // has nothing left after `trim_start_matches('#').trim()`.
        let chunks = chunk_markdown("#\nBody under a titleless heading.\n", "fallback");
        assert_eq!(chunks[0].title, "fallback");
    }

    #[test]
    fn long_section_splits_with_overlapping_content() {
        // One heading, then enough body text to force at least one
        // TARGET_CHUNK_CHARS-driven split within that single section.
        let mut text = String::from("# Long Section\n");
        for _ in 0..60 {
            text.push_str(&"a".repeat(40));
            text.push('\n');
        }
        let chunks = chunk_markdown(&text, "fallback");
        assert!(
            chunks.len() >= 2,
            "expected the long section to split into multiple chunks, got {}",
            chunks.len()
        );
        // No second heading appears, so every chunk keeps the same title.
        assert!(chunks.iter().all(|c| c.title == "Long Section"));
        // Consecutive chunks overlap: the tail of one chunk's content
        // reappears near the start of the next (OVERLAP_CHARS-driven).
        let tail_len = OVERLAP_CHARS.min(chunks[0].content.len());
        let tail = &chunks[0].content[chunks[0].content.len() - tail_len..];
        assert!(
            chunks[1].content.contains(tail),
            "expected chunk 1 to contain the overlapping tail of chunk 0"
        );
        // Offsets move forward but overlap, never going past the text length.
        assert!(chunks[1].start < chunks[0].end);
        assert!(chunks.iter().all(|c| c.end <= text.len()));
    }

    #[test]
    fn does_not_panic_on_multibyte_chars_near_the_overlap_boundary() {
        // Multi-byte (3-byte CJK) characters positioned so a naive byte
        // slice at exactly OVERLAP_CHARS would land mid-character; the
        // char-boundary walk-back in chunk_markdown must avoid that.
        let mut text = String::from("# 标题\n");
        for _ in 0..80 {
            text.push_str("测试内容文字段落");
            text.push('\n');
        }
        let chunks = chunk_markdown(&text, "fallback");
        assert!(chunks.len() >= 2);
        // Reaching here without panicking already proves the slice was
        // taken on a char boundary; content should still be valid text.
        assert!(chunks.iter().all(|c| !c.content.is_empty()));
    }

    #[test]
    fn incremental_plan_skips_unchanged_files_and_reports_deletions() {
        let root = std::env::temp_dir().join(format!("nest-index-plan-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.md"), "# A\nOne stable paragraph.\n").unwrap();

        let first = collect_index_plan(&root, Vec::new(), false).unwrap();
        assert_eq!(first.changed.len(), 1);
        assert!(first.deleted.is_empty());
        let metadata = first.changed[0].metadata.clone();
        let first_ids = first.changed[0]
            .chunks
            .iter()
            .map(|chunk| chunk.id.clone())
            .collect::<Vec<_>>();

        let second = collect_index_plan(&root, vec![metadata.clone()], false).unwrap();
        assert!(second.changed.is_empty());
        assert!(second.deleted.is_empty());

        let forced = collect_index_plan(&root, vec![metadata.clone()], true).unwrap();
        let forced_ids = forced.changed[0]
            .chunks
            .iter()
            .map(|chunk| chunk.id.clone())
            .collect::<Vec<_>>();
        assert_eq!(forced_ids, first_ids, "unchanged chunks keep stable IDs");

        std::fs::remove_file(root.join("a.md")).unwrap();
        let deleted = collect_index_plan(&root, vec![metadata], false).unwrap();
        assert_eq!(deleted.deleted, vec!["a.md"]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn persist_chunks_replaces_existing_rows_and_counts_files_and_chunks() {
        let root = std::env::temp_dir().join(format!("nest-indexer-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let conn = db::open_db(&root.join("test.db")).unwrap();

        let first_pass = vec![PendingChunk {
            id: Uuid::new_v4().to_string(),
            file_path: "a.md".to_string(),
            title: "A".to_string(),
            content: "stale content".to_string(),
            start: 0,
            end: 14,
        }];
        let (files, chunks) = persist_chunks(&conn, &first_pass).unwrap();
        assert_eq!((files, chunks), (1, 1));

        // A second pass with different files must fully replace the first
        // (persist_chunks clears the table up front), not accumulate.
        let second_pass = vec![
            PendingChunk {
                id: Uuid::new_v4().to_string(),
                file_path: "b.md".to_string(),
                title: "B".to_string(),
                content: "fresh content one".to_string(),
                start: 0,
                end: 18,
            },
            PendingChunk {
                id: Uuid::new_v4().to_string(),
                file_path: "b.md".to_string(),
                title: "B continued".to_string(),
                content: "fresh content two".to_string(),
                start: 18,
                end: 36,
            },
            PendingChunk {
                id: Uuid::new_v4().to_string(),
                file_path: "c.md".to_string(),
                title: "C".to_string(),
                content: "fresh content three".to_string(),
                start: 0,
                end: 20,
            },
        ];
        let (files, chunks) = persist_chunks(&conn, &second_pass).unwrap();
        assert_eq!(files, 2, "b.md and c.md, but not the stale a.md");
        assert_eq!(chunks, 3);

        drop(conn);
        let _ = std::fs::remove_dir_all(root);
    }
}
