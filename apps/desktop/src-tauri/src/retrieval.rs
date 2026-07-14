use crate::db::{self, Citation};
use crate::error::AppResult;
use rusqlite::Connection;

/// Lightweight local retrieval: SQLite FTS5 (BM25) over Markdown chunks.
/// No embedding model — runs fully offline on a normal PC.
pub fn retrieve(
    conn: &Connection,
    query: &str,
    scope_paths: &[String],
    top_k: u32,
) -> AppResult<Vec<Citation>> {
    let top_k = top_k.max(1);
    let mut citations = db::fts_search(conn, query, top_k, scope_paths)?;
    if citations.is_empty() {
        citations = db::lexical_search(conn, query, top_k, scope_paths)?;
    }
    Ok(citations)
}

pub fn build_prompt(query: &str, citations: &[Citation]) -> (String, String) {
    let system = "You are Nest, a knowledge assistant. Answer using ONLY the provided reference excerpts when possible. If the references do not contain enough information, say so clearly. Cite references by their [n] numbers inline when helpful.";
    let mut context = String::new();
    for (i, c) in citations.iter().enumerate() {
        context.push_str(&format!(
            "[{}] {} ({})\n{}\n\n",
            i + 1,
            c.title,
            c.file_path,
            c.snippet
        ));
    }
    let user = if context.is_empty() {
        format!(
            "No library references were retrieved.\n\nQuestion: {query}\n\nSay that you could not find relevant knowledge in the vault."
        )
    } else {
        format!("References:\n{context}\nQuestion: {query}")
    };
    (system.to_string(), user)
}
