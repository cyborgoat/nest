//! Hybrid retrieval: local FastEmbed vectors + FTS5 lexical search.

use crate::db::{self, Citation, InstalledPack};
use crate::embeddings;
use crate::error::AppResult;
use crate::indexer::OVERLAP_CHARS;
use crate::state::SharedState;
use crate::vector_store;
use std::collections::HashSet;
use std::path::Path;

/// Default number of vault passages retrieved for RAG (not user-configurable).
pub const DEFAULT_TOP_K: u32 = 5;

/// Full-content candidate carried through merge/dedup; only `.citation` (with
/// its already-truncated `.snippet`) survives into the returned `Vec<Citation>`.
struct SearchHit {
    citation: Citation,
    content: String,
}

/// Retrieve citations using vector search (primary) merged with FTS (secondary).
pub async fn retrieve(
    app_data_dir: &Path,
    state: &SharedState,
    query: &str,
    retrieval_prefixes: &[String],
    top_k: u32,
) -> AppResult<Vec<Citation>> {
    let top_k = top_k.max(1);
    let mut merged: Vec<SearchHit> = Vec::new();
    let mut seen = HashSet::new();

    crate::nest_debug!(
        "retrieval",
        "query={:?} top_k={top_k} prefixes={retrieval_prefixes:?}",
        query
    );

    // Vector hits first — no Sync connection held across await.
    if let Ok(model) = embeddings::load_embedding_model() {
        if let Ok(hits) =
            vector_store::vector_search(app_data_dir, model, query, top_k, retrieval_prefixes).await
        {
            crate::nest_debug!("retrieval", "vector_hits={}", hits.len());
            for (score, doc) in hits {
                if seen.insert(doc.id.clone()) {
                    merged.push(SearchHit {
                        citation: Citation {
                            chunk_id: doc.id,
                            file_path: doc.file_path,
                            title: doc.title,
                            snippet: snippet(&doc.content),
                            score: score as f32,
                        },
                        content: doc.content,
                    });
                }
            }
        } else {
            crate::nest_debug!("retrieval", "vector_search failed or empty");
        }
    } else {
        crate::nest_debug!("retrieval", "embedding model load failed");
    }

    // FTS lexical complement (sync, short lock).
    let fts = {
        let conn = state.db.lock();
        db::fts_search(&conn, query, top_k, retrieval_prefixes)?
    };
    crate::nest_debug!("retrieval", "fts_hits={}", fts.len());
    for (citation, content) in fts {
        if seen.insert(citation.chunk_id.clone()) {
            merged.push(SearchHit { citation, content });
        }
    }

    if merged.is_empty() {
        let conn = state.db.lock();
        let fallback = db::lexical_search(&conn, query, top_k, retrieval_prefixes)?;
        crate::nest_debug!("retrieval", "lexical_fallback_hits={}", fallback.len());
        merged = fallback
            .into_iter()
            .map(|(citation, content)| SearchHit { citation, content })
            .collect();
    }

    dedupe_overlapping_chunks(&mut merged);
    merged.truncate(top_k as usize);

    let mut citations: Vec<Citation> = merged.into_iter().map(|hit| hit.citation).collect();

    // Drop citations whose files were removed (stale vectors / FTS race).
    let before = citations.len();
    let vault = state.vault_path();
    citations.retain(|c| {
        let path = vault.join(&c.file_path);
        let ok = path.is_file();
        if !ok {
            crate::nest_debug!("retrieval", "dropping stale citation path={}", c.file_path);
        }
        ok
    });
    if citations.len() != before {
        crate::nest_debug!(
            "retrieval",
            "filtered stale citations {} -> {}",
            before,
            citations.len()
        );
    }

    crate::nest_debug!("retrieval", "merged_hits={}", citations.len());
    Ok(citations)
}

/// Drop the redundant member of any same-file pair whose content shares the
/// chunker's deliberate sliding-window overlap (see `indexer::OVERLAP_CHARS`):
/// when a chunk is flushed by size rather than by heading, the chunker copies
/// the trailing ~150 chars of the previous chunk verbatim as the start of the
/// next one, so adjacent chunks are frequently near-duplicates in embedding
/// space and both land in the top-k. This does NOT touch unrelated chunks
/// from the same file that don't share that boundary, so two genuinely
/// different sections of one file are both kept.
///
/// Keeps whichever candidate is earlier in `hits` — i.e. preserves the
/// existing implicit source-priority order (vector hits before FTS before
/// lexical fallback, each already rank-ordered) — rather than re-sorting by
/// `.score`, since vector cosine scores and BM25-derived scores are on
/// different scales and aren't meaningfully comparable against each other.
fn dedupe_overlapping_chunks(hits: &mut Vec<SearchHit>) {
    let mut drop = vec![false; hits.len()];
    for i in 0..hits.len() {
        if drop[i] {
            continue;
        }
        for j in (i + 1)..hits.len() {
            if drop[j] || hits[i].citation.file_path != hits[j].citation.file_path {
                continue;
            }
            if shares_chunk_overlap(&hits[i].content, &hits[j].content) {
                drop[j] = true;
            }
        }
    }
    let mut idx = 0;
    hits.retain(|_| {
        let keep = !drop[idx];
        idx += 1;
        keep
    });
}

/// True when one chunk's ~`OVERLAP_CHARS`-char tail exactly reappears as a
/// substring of the other (or vice versa). Uses `.chars()` windows, not raw
/// byte slicing, to stay UTF-8-safe on arbitrary multibyte vault content, and
/// `.contains()` rather than strict prefix/suffix equality to tolerate the
/// `.trim()` each chunk already went through at indexing time.
fn shares_chunk_overlap(a: &str, b: &str) -> bool {
    let a_tail = char_suffix(a, OVERLAP_CHARS);
    if !a_tail.is_empty() && b.contains(&a_tail) {
        return true;
    }
    let b_tail = char_suffix(b, OVERLAP_CHARS);
    !b_tail.is_empty() && a.contains(&b_tail)
}

fn char_suffix(s: &str, n: usize) -> String {
    let total = s.chars().count();
    s.chars().skip(total.saturating_sub(n)).collect()
}

/// Truncates to at most 280 *characters* (not bytes) — a raw byte-index slice
/// panics whenever the boundary lands mid-character, which any non-ASCII
/// vault content (CJK, accented text, emoji, ...) makes a real, not
/// theoretical, risk.
pub(crate) fn snippet(content: &str) -> String {
    let mut chars = content.chars();
    let prefix = chars.by_ref().take(280).collect::<String>();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

pub fn format_citations_for_prompt(citations: &[Citation]) -> String {
    if citations.is_empty() {
        return "No relevant passages found in the vault. Tell the user clearly that nothing \
                matching their question is in the local library, and suggest downloading a \
                knowledge pack from Hub that covers the topic."
            .to_string();
    }
    let mut out = String::from("Retrieved vault passages:\n");
    for (i, c) in citations.iter().enumerate() {
        out.push_str(&format!(
            "[{}] {} ({})\n{}\n\n",
            i + 1,
            c.title,
            c.file_path,
            c.snippet
        ));
    }
    out
}

/// Concise, persistent reference to what's available locally — distinct from
/// `format_citations_for_prompt`, which is per-turn retrieval evidence. Always
/// included so the model knows local capability even when retrieval is empty.
pub fn format_active_packs_for_prompt(packs: &[InstalledPack]) -> String {
    if packs.is_empty() {
        return "Active knowledge packs: none installed or active yet.".to_string();
    }
    let mut out = String::from("Active knowledge packs (topics available locally):\n");
    for pack in packs {
        out.push_str(&format!("- {} ({})\n", pack.name, pack.local_path));
    }
    out
}

pub fn agent_preamble() -> &'static str {
    "You are Nest, a local-first knowledge assistant. \
     The application retrieves relevant Markdown passages before each model request. \
     Answer using ONLY the retrieved vault content. \
     Cite passages by their [n] numbers inline when helpful. \
     Prefer concise, accurate answers that respect multi-turn conversation context."
}

#[cfg(test)]
mod tests {
    use super::{dedupe_overlapping_chunks, format_active_packs_for_prompt, snippet, SearchHit};
    use crate::db::{Citation, InstalledPack};

    #[test]
    fn snippet_handles_multibyte_markdown() {
        let content = "知".repeat(300);
        let value = snippet(&content);
        assert_eq!(value.chars().count(), 281);
        assert!(value.ends_with('…'));
    }

    fn hit(chunk_id: &str, file_path: &str, content: &str, score: f32) -> SearchHit {
        SearchHit {
            citation: Citation {
                chunk_id: chunk_id.to_string(),
                file_path: file_path.to_string(),
                title: "Title".to_string(),
                snippet: content.chars().take(280).collect(),
                score,
            },
            content: content.to_string(),
        }
    }

    #[test]
    fn drops_adjacent_chunk_sharing_overlap_window() {
        let tail = "z".repeat(150);
        let first = format!("{}{tail}", "a".repeat(1050));
        let second = format!("{tail}{}", "b".repeat(1050));
        let mut hits = vec![
            hit("chunk-1", "notes.md", &first, 0.9),
            hit("chunk-2", "notes.md", &second, 0.85),
            hit("chunk-3", "other.md", "completely unrelated content", 0.5),
        ];
        dedupe_overlapping_chunks(&mut hits);
        let ids: Vec<&str> = hits.iter().map(|h| h.citation.chunk_id.as_str()).collect();
        assert_eq!(ids, vec!["chunk-1", "chunk-3"]);
    }

    #[test]
    fn keeps_distinct_non_overlapping_sections_of_same_file() {
        let mut hits = vec![
            hit("chunk-1", "notes.md", "the first section covers setup", 0.9),
            hit(
                "chunk-2",
                "notes.md",
                "the second section covers teardown",
                0.8,
            ),
        ];
        dedupe_overlapping_chunks(&mut hits);
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn active_packs_are_listed_concisely() {
        let pack = InstalledPack {
            pack_id: "cooking".into(),
            name: "Cooking Basics".into(),
            local_path: "cooking-pack".into(),
            version: "1.0.0".into(),
            last_synced: None,
            active: true,
            origin: "hub".into(),
            owner_id: None,
            description: String::new(),
            pending_version: None,
            pending_request_id: None,
            publish_review_status: None,
            publish_review_created_at: None,
        };
        let out = format_active_packs_for_prompt(&[pack]);
        assert!(out.contains("Cooking Basics"));
        assert!(out.contains("cooking-pack"));
    }

    #[test]
    fn no_active_packs_yields_clear_fallback() {
        let out = format_active_packs_for_prompt(&[]);
        assert!(out.contains("none installed"));
    }
}
