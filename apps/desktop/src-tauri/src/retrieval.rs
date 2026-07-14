//! Hybrid retrieval: local FastEmbed vectors + FTS5 lexical search.

use crate::db::{self, Citation};
use crate::embeddings;
use crate::error::AppResult;
use crate::state::SharedState;
use crate::vector_store;
use std::collections::HashSet;
use std::path::Path;

/// Default number of vault passages retrieved for RAG (not user-configurable).
pub const DEFAULT_TOP_K: u32 = 5;

/// Retrieve citations using vector search (primary) merged with FTS (secondary).
pub async fn retrieve(
    app_data_dir: &Path,
    state: &SharedState,
    embedding_model_id: &str,
    query: &str,
    retrieval_prefixes: &[String],
    top_k: u32,
) -> AppResult<Vec<Citation>> {
    let top_k = top_k.max(1);
    let mut merged: Vec<Citation> = Vec::new();
    let mut seen = HashSet::new();

    crate::nest_debug!(
        "retrieval",
        "query={:?} top_k={top_k} prefixes={retrieval_prefixes:?} model={embedding_model_id}",
        query
    );

    // Vector hits first — no Sync connection held across await.
    if let Ok(model) = embeddings::load_embedding_model(embedding_model_id) {
        if let Ok(hits) =
            vector_store::vector_search(app_data_dir, model, query, top_k, retrieval_prefixes).await
        {
            crate::nest_debug!("retrieval", "vector_hits={}", hits.len());
            for (score, doc) in hits {
                if seen.insert(doc.id.clone()) {
                    merged.push(Citation {
                        chunk_id: doc.id,
                        file_path: doc.file_path,
                        title: doc.title,
                        snippet: snippet(&doc.content),
                        score: score as f32,
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
    for c in fts {
        if seen.insert(c.chunk_id.clone()) {
            merged.push(c);
        }
    }

    if merged.is_empty() {
        let conn = state.db.lock();
        merged = db::lexical_search(&conn, query, top_k, retrieval_prefixes)?;
        crate::nest_debug!("retrieval", "lexical_fallback_hits={}", merged.len());
    }

    merged.truncate(top_k as usize);

    // Drop citations whose files were removed (stale vectors / FTS race).
    let before = merged.len();
    merged.retain(|c| {
        let path = state.vault_root.join(&c.file_path);
        let ok = path.is_file();
        if !ok {
            crate::nest_debug!(
                "retrieval",
                "dropping stale citation path={}",
                c.file_path
            );
        }
        ok
    });
    if merged.len() != before {
        crate::nest_debug!(
            "retrieval",
            "filtered stale citations {} -> {}",
            before,
            merged.len()
        );
    }

    crate::nest_debug!("retrieval", "merged_hits={}", merged.len());
    Ok(merged)
}

fn snippet(content: &str) -> String {
    if content.len() > 280 {
        format!("{}…", &content[..280])
    } else {
        content.to_string()
    }
}

pub fn format_citations_for_tool(citations: &[Citation]) -> String {
    if citations.is_empty() {
        return "No relevant passages found in the vault. Tell the user clearly that nothing \
                matching their question is in the local library, and suggest downloading a \
                knowledge pack from the Hub that covers the topic."
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

pub fn agent_preamble() -> &'static str {
    "You are Nest, a local-first knowledge assistant. \
     Use the vault_search tool to retrieve relevant Markdown passages before answering factual questions about the library. \
     Answer using ONLY retrieved vault content when possible. \
     If vault_search returns nothing relevant (or the library has no matching packs), clearly tell the user you could not find an answer in their local knowledge — do not invent product steps or guess. \
     Suggest they download a relevant knowledge pack from the Hub when the topic is missing. \
     Cite passages by their [n] numbers inline when helpful. \
     Prefer concise, accurate answers that respect multi-turn conversation context."
}
