//! Rig agent: eager local retrieval + one OpenAI-compatible streaming turn.

use crate::db::{self, AppSettings, Citation};
use crate::error::{AppError, AppResult};
use crate::llm::ChatStreamEvent;
use crate::retrieval::{
    self, agent_preamble, format_active_packs_for_prompt, format_citations_for_prompt,
    DEFAULT_TOP_K,
};
use crate::state::SharedState;
use crate::vault;
use futures::StreamExt;
use rig::agent::{AgentHook, Flow, HookContext, MultiTurnStreamItem, StepEvent};
use rig::client::CompletionClient;
use rig::completion::message::Text;
use rig::completion::{CompletionModel, Message};
use rig::providers::openai;
use rig::streaming::{StreamedAssistantContent, StreamingChat};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

const MAX_FOCUS_FILES: usize = 16;
const MAX_FOCUS_CHARS_PER_FILE: usize = 6_000;
const MAX_FOCUS_CHARS_TOTAL: usize = 48_000;
/// Bound on building `@`-focus content (vault walk + file reads). This is
/// local disk I/O, not an LLM call, so it should normally finish in well
/// under a second even for a large folder — the timeout only exists to
/// catch a slow/unresponsive read (network-mounted path, unsynced cloud
/// placeholder, ...) that would otherwise hang the turn forever.
const FOCUS_CONTEXT_TIMEOUT: Duration = Duration::from_secs(20);

/// Result of a completed agent chat run.
pub struct AgentChatResult {
    pub answer: String,
    pub citations: Vec<Citation>,
    pub thinking: Option<String>,
    pub thinking_seconds: Option<f64>,
}

pub struct AgentChatRequest {
    pub app: AppHandle,
    pub state: SharedState,
    pub app_data_dir: PathBuf,
    pub settings: AppSettings,
    pub session_id: String,
    pub query: String,
    pub focus_paths: Vec<String>,
    pub stream_event: String,
    pub prior_history: Vec<Message>,
}

#[derive(Default)]
struct FocusContext {
    text: String,
    citations: Vec<Citation>,
}

/// Rig `AgentHook` that terminates the run if the user clicked "Stop" before
/// this turn's model request was sent. Additive to (not a replacement for)
/// the streaming loop's own cancellation: `StepEvent` has no reasoning/thinking
/// delta variant, so the loop must keep consuming the raw stream itself for
/// the "Thinking…" UI — this hook only closes the earlier, narrower gap.
struct CancelHook {
    cancel_rx: watch::Receiver<bool>,
}

impl<M: CompletionModel> AgentHook<M> for CancelHook {
    async fn on_event(&self, _ctx: &HookContext, event: StepEvent<'_, M>) -> Flow {
        if matches!(event, StepEvent::CompletionCall { .. }) && *self.cancel_rx.borrow() {
            Flow::terminate("cancelled")
        } else {
            Flow::Continue
        }
    }
}

async fn emit_reading_files(app: &AppHandle, stream_event: &str, paths: &[String]) {
    let mut seen = HashSet::new();
    for path in paths {
        if !seen.insert(path.clone()) {
            continue;
        }
        let _ = app.emit(
            stream_event,
            ChatStreamEvent::Reading { path: path.clone() },
        );
        // Brief pause so the UI can show each file before the next.
        tokio::time::sleep(Duration::from_millis(90)).await;
    }
}

pub async fn run_agent_chat(request: AgentChatRequest) -> AppResult<AgentChatResult> {
    let AgentChatRequest {
        app,
        state,
        app_data_dir,
        settings,
        session_id,
        query,
        focus_paths,
        stream_event,
        prior_history,
    } = request;
    if settings.llm_api_key.trim().is_empty() {
        return Err(AppError::msg("API key not configured"));
    }
    if settings.llm_base_url.trim().is_empty() {
        return Err(AppError::msg("LLM Base URL not configured"));
    }
    if settings.chat_model.trim().is_empty() {
        return Err(AppError::msg("Chat model not configured"));
    }

    let mut cancel_rx = state.begin_chat_cancel();

    // Active packs form the retrieval scope; @ focus narrows further. Also
    // fetch the full active-pack list (name + path) in the same lock so the
    // preamble can always tell the model what's installed, not just this
    // turn's retrieval scope.
    let (retrieval_prefixes, active_packs) = {
        let conn = state.db.lock();
        let prefixes = db::resolve_retrieval_prefixes(&conn, &focus_paths)?;
        let packs = db::list_sync_state(&conn)?
            .into_iter()
            .filter(|p| p.active)
            .collect::<Vec<_>>();
        (prefixes, packs)
    };

    // `resolve_retrieval_prefixes` rejects focus outside active packs. Reuse
    // that decision before reading files so crafted IPC input cannot make an
    // inactive pack part of the prompt.
    let valid_focus_paths = focus_paths
        .iter()
        .filter(|path| retrieval_prefixes.contains(path))
        .cloned()
        .collect::<Vec<_>>();
    // `build_focus_context` does a synchronous, potentially slow filesystem
    // walk and file reads (`vault::list_tree`, `vault::read_file`) — run it
    // on a blocking-pool thread so it can't stall the async runtime that's
    // also driving other in-flight chat streams. Bound it with a timeout and
    // race it against cancellation: a slow/unresponsive read has no other
    // bound, and Tokio cannot forcibly abort a `spawn_blocking` closure once
    // it starts running — the timeout/cancel here make the *request* give up
    // promptly (what "Stop" needs to do), even though the underlying
    // blocking-pool thread may keep running the stuck read in the background
    // until it eventually finishes or errors on its own.
    let vault_root = state.vault_path();
    let focus_context = tokio::select! {
        result = build_focus_context_bounded(vault_root, valid_focus_paths, FOCUS_CONTEXT_TIMEOUT) => result?,
        _ = cancel_rx.changed() => return Err(AppError::msg("cancelled")),
    };
    let agent_query = if focus_context.text.is_empty() {
        query.clone()
    } else {
        format!(
            "{query}\n\n---\nExplicitly selected vault content:\n{}",
            focus_context.text
        )
    };

    let openai = openai::Client::builder()
        .api_key(settings.llm_api_key.clone())
        .base_url(settings.llm_base_url.trim_end_matches('/'))
        .build()
        .map_err(|e| AppError::msg(format!("Failed to build OpenAI client: {e}")))?
        .completions_api();

    crate::nest_debug!(
        "agent",
        "start session={session_id} query_len={} focus={:?} retrieval={:?} history={}",
        query.len(),
        focus_paths,
        retrieval_prefixes,
        prior_history.len()
    );

    // Retrieval is deliberately completed before any LLM network request. The
    // previous best-effort call discarded errors and only updated the UI, so a
    // bundled build could silently bypass local search and start the model call.
    // Raced against cancellation (a real async future, so dropping it here
    // actually stops the in-flight work, unlike the `spawn_blocking` above).
    let eager = tokio::select! {
        result = retrieval::retrieve(
            &app_data_dir,
            &state,
            &query,
            &retrieval_prefixes,
            DEFAULT_TOP_K,
        ) => result?,
        _ = cancel_rx.changed() => return Err(AppError::msg("cancelled")),
    };
    crate::nest_debug!("agent", "eager_retrieval hits={}", eager.len());
    let focus_count = focus_context.citations.len();
    let citations = merge_citations(focus_context.citations, eager);
    let preamble = agent_preamble_with_retrieval(&citations, focus_count > 0, &active_packs);
    let reading_paths = citations
        .iter()
        .map(|citation| citation.file_path.clone())
        .collect::<Vec<_>>();
    emit_reading_files(&app, &stream_event, &reading_paths).await;
    let _ = app.emit(
        &stream_event,
        ChatStreamEvent::Citations {
            citations: citations.clone(),
        },
    );

    let agent = openai
        .agent(&settings.chat_model)
        .preamble(&preamble)
        .build();

    let _ = app.emit(&stream_event, ChatStreamEvent::Generating);

    // Closes the one cancellation gap the loop below can't cover: whatever
    // `stream_chat(...)` does internally before the stream object exists (and
    // the loop's own `cancel_rx`-aware `select!` starts). `CompletionCall`
    // fires before the model request is sent, honors `Flow::Terminate`, and
    // is the rig-native checkpoint for exactly this — see
    // `rig::agent::hook` docs.
    let mut stream = agent
        .stream_chat(agent_query, prior_history)
        .add_hook(CancelHook {
            cancel_rx: cancel_rx.clone(),
        })
        .await;

    let mut full = String::new();
    let mut thinking = String::new();
    let mut thinking_started: Option<Instant> = None;
    let mut cancelled = false;

    loop {
        if *cancel_rx.borrow() {
            cancelled = true;
            break;
        }
        // Dropping the stream as soon as cancellation arrives aborts the
        // underlying HTTP/SSE request instead of waiting for another token.
        let item = tokio::select! {
            item = stream.next() => item,
            _ = cancel_rx.changed() => {
                cancelled = true;
                break;
            }
        };
        let Some(item) = item else { break };
        match item {
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(
                Text { text, .. },
            ))) => {
                full.push_str(&text);
                let _ = app.emit(
                    &stream_event,
                    ChatStreamEvent::Token {
                        content: text.clone(),
                    },
                );
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(
                StreamedAssistantContent::ReasoningDelta { reasoning, .. },
            )) => {
                if !reasoning.is_empty() {
                    thinking_started.get_or_insert_with(Instant::now);
                    thinking.push_str(&reasoning);
                    let _ = app.emit(
                        &stream_event,
                        ChatStreamEvent::Thinking { content: reasoning },
                    );
                }
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Reasoning(
                reasoning,
            ))) => {
                let content = reasoning.display_text();
                if !content.is_empty() {
                    thinking_started.get_or_insert_with(Instant::now);
                    let delta = if content.starts_with(&thinking) {
                        content[thinking.len()..].to_string()
                    } else if thinking.is_empty() {
                        content.clone()
                    } else {
                        String::new()
                    };
                    thinking = content.clone();
                    if !delta.is_empty() {
                        let _ =
                            app.emit(&stream_event, ChatStreamEvent::Thinking { content: delta });
                    }
                }
            }
            Ok(MultiTurnStreamItem::FinalResponse(resp)) => {
                crate::nest_debug!(
                    "agent",
                    "final_response output_len={} streamed_len={}",
                    resp.output.len(),
                    full.len()
                );
                if full.trim().is_empty() && !resp.output.trim().is_empty() {
                    full = resp.output;
                    let _ = app.emit(&stream_event, ChatStreamEvent::Generating);
                    let _ = app.emit(
                        &stream_event,
                        ChatStreamEvent::Token {
                            content: full.clone(),
                        },
                    );
                }
                break;
            }
            Ok(_) => {}
            Err(e) => {
                if *cancel_rx.borrow() {
                    cancelled = true;
                    break;
                }
                let msg = e.to_string();
                crate::nest_debug!("agent", "stream error: {msg}");
                return Err(AppError::msg(llm_request_error(&settings, &msg)));
            }
        }
    }

    if *cancel_rx.borrow() {
        cancelled = true;
    }

    if !citations.is_empty() {
        let _ = app.emit(
            &stream_event,
            ChatStreamEvent::Citations {
                citations: citations.clone(),
            },
        );
    }

    if cancelled {
        // A user interrupt is a normal control-flow outcome. Discard buffered
        // tokens so `chat_send` never persists a partial assistant message.
        return Err(AppError::msg("cancelled"));
    }

    if full.trim().is_empty() {
        return Err(AppError::msg(
            "The model finished without returning an answer after reasoning",
        ));
    }

    crate::nest_debug!(
        "agent",
        "done answer_len={} citations={}",
        full.len(),
        citations.len()
    );

    Ok(AgentChatResult {
        answer: full,
        citations,
        thinking: (!thinking.trim().is_empty()).then_some(thinking),
        thinking_seconds: thinking_started.map(|start| start.elapsed().as_secs_f64()),
    })
}

fn llm_request_error(settings: &AppSettings, message: &str) -> String {
    if message.contains("401") || message.to_ascii_lowercase().contains("unauthorized") {
        let provider = reqwest::Url::parse(&settings.llm_base_url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .unwrap_or_else(|| "the configured provider".into());
        return format!(
            "LLM authentication failed at {provider}. Check that the API key belongs to this provider and that the Base URL is correct in Settings."
        );
    }
    format!("LLM request failed: {message}")
}

fn agent_preamble_with_retrieval(
    citations: &[Citation],
    has_focus_content: bool,
    active_packs: &[db::InstalledPack],
) -> String {
    let body = if citations.is_empty() && !has_focus_content {
        format!(
            "{}\n\nNo relevant passages were retrieved for this request. Only answer if the prior conversation already contains the necessary vault evidence; otherwise say plainly that nothing indexed matches this request. You may point the user to one of the active packs listed below if it looks relevant, or suggest finding a different pack in Hub.",
            agent_preamble()
        )
    } else if citations.is_empty() {
        format!(
            "{}\n\nThe user explicitly selected vault files. Their contents are included in the request under 'Explicitly selected vault content'. Treat that content as authoritative local evidence and answer from it; do not claim that the local library has no matching knowledge merely because indexed retrieval returned no passages.",
            agent_preamble()
        )
    } else {
        let focus_instruction = if has_focus_content {
            " The request also contains full explicitly selected vault files corresponding to the initial references; treat them as authoritative local evidence and use both sources."
        } else {
            ""
        };
        format!(
            "{}\n\nThe following passages were retrieved locally for this request. Use them as factual evidence for the answer.{focus_instruction}\n\n{}",
            agent_preamble(),
            format_citations_for_prompt(citations),
        )
    };
    format!("{body}\n\n{}", format_active_packs_for_prompt(active_packs))
}

/// Runs [`build_focus_context`] on a blocking-pool thread, bounded by
/// `timeout`. Tokio cannot forcibly abort a `spawn_blocking` closure once it
/// starts running, so a slow/unresponsive read (network-mounted path,
/// unsynced cloud placeholder, ...) leaves the underlying thread running in
/// the background regardless — this only bounds how long the *caller* waits.
async fn build_focus_context_bounded(
    vault: PathBuf,
    focus_paths: Vec<String>,
    timeout: Duration,
) -> AppResult<FocusContext> {
    let focus_task = tokio::task::spawn_blocking(move || build_focus_context(&vault, &focus_paths));
    match tokio::time::timeout(timeout, focus_task).await {
        Ok(Ok(inner)) => inner,
        Ok(Err(join_err)) => Err(AppError::msg(format!(
            "Focus context task failed: {join_err}"
        ))),
        Err(_elapsed) => Err(AppError::msg(
            "Timed out reading the selected file(s) or folder — check they're accessible \
             (not a disconnected network drive, an unsynced cloud file, etc.).",
        )),
    }
}

fn build_focus_context(vault: &Path, focus_paths: &[String]) -> AppResult<FocusContext> {
    if focus_paths.is_empty() {
        return Ok(FocusContext::default());
    }
    let tree = vault::list_tree(vault)?;
    let mut files = Vec::new();
    for path in focus_paths {
        if let Some(node) = find_tree_node(&tree, path) {
            collect_markdown_files(node, &mut files);
        }
    }
    let mut seen = HashSet::new();
    files.retain(|path| seen.insert(path.clone()));

    let mut parts = Vec::new();
    let mut citations = Vec::new();
    let mut remaining_chars = MAX_FOCUS_CHARS_TOTAL;
    let total_files = files.len();
    for path in files.iter().take(MAX_FOCUS_FILES) {
        if remaining_chars == 0 {
            break;
        }
        if let Ok(content) = vault::read_file(vault, path) {
            let limit = MAX_FOCUS_CHARS_PER_FILE.min(remaining_chars);
            let truncated = truncate_chars(&content, limit);
            remaining_chars = remaining_chars.saturating_sub(truncated.chars().count());
            let reference_number = citations.len() + 1;
            parts.push(format!(
                "### [{reference_number}] Focus file: {path}\n{truncated}"
            ));
            citations.push(Citation {
                chunk_id: format!("focus:{path}"),
                file_path: path.clone(),
                title: path.rsplit('/').next().unwrap_or(path).to_string(),
                snippet: truncate_chars(&content, 280),
                score: 1.0,
            });
        }
    }
    if citations.len() < total_files {
        parts.push(format!(
            "[Focus selection bounded: included {} of {total_files} Markdown files.]",
            citations.len()
        ));
    }
    Ok(FocusContext {
        text: parts.join("\n\n"),
        citations,
    })
}

fn merge_citations(focused: Vec<Citation>, retrieved: Vec<Citation>) -> Vec<Citation> {
    let mut merged = Vec::with_capacity(focused.len() + retrieved.len());
    let mut seen_paths = HashSet::new();
    for citation in focused.into_iter().chain(retrieved) {
        if seen_paths.insert(citation.file_path.clone()) {
            merged.push(citation);
        }
    }
    merged
}

fn find_tree_node<'a>(nodes: &'a [vault::TreeNode], path: &str) -> Option<&'a vault::TreeNode> {
    for node in nodes {
        if node.path == path {
            return Some(node);
        }
        if let Some(found) = node
            .children
            .as_deref()
            .and_then(|children| find_tree_node(children, path))
        {
            return Some(found);
        }
    }
    None
}

fn collect_markdown_files(node: &vault::TreeNode, files: &mut Vec<String>) {
    match node.kind {
        vault::TreeNodeKind::File => files.push(node.path.clone()),
        vault::TreeNodeKind::Folder => {
            if let Some(children) = &node.children {
                for child in children {
                    collect_markdown_files(child, files);
                }
            }
        }
    }
}

fn truncate_chars(content: &str, max_chars: usize) -> String {
    let mut chars = content.chars();
    let prefix = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

#[cfg(test)]
mod tests {
    use super::{
        agent_preamble_with_retrieval, build_focus_context_bounded, collect_markdown_files,
        llm_request_error, merge_citations, truncate_chars,
    };
    use crate::db::{AppSettings, Citation, InstalledPack};
    use crate::vault::{TreeNode, TreeNodeKind};
    use std::time::Duration;

    #[test]
    fn truncates_unicode_on_character_boundaries() {
        assert_eq!(truncate_chars("知识库 content", 3), "知识库…");
        assert_eq!(truncate_chars("短文", 4), "短文");
    }

    /// Mirrors `build_focus_context_bounded`'s technique directly: a
    /// `spawn_blocking` closure that outlives the timeout (as a genuinely
    /// stuck disk read might — a network-mounted path, an unsynced cloud
    /// placeholder, ...) is still bounded by `tokio::time::timeout` from the
    /// awaiting side, even though Tokio cannot forcibly abort the
    /// blocking-pool thread itself once it starts running. This is the exact
    /// risk `build_focus_context_bounded` mitigates; reproducing a real vault
    /// file that both passes `vault::read_file`'s `is_file()` check *and*
    /// blocks on read (a FIFO fails the former) isn't practical in a fast,
    /// portable unit test, so this exercises the underlying combinator
    /// directly instead. Sleep is kept short (not a "forever" hang): the test
    /// runtime waits for the orphaned blocking thread to actually finish
    /// before the process can exit, so a longer sleep here would tax every
    /// test run with real wall-clock time — the 100ms timeout still fires
    /// and returns well before the 1s sleep completes either way.
    #[tokio::test]
    async fn spawn_blocking_stuck_read_is_bounded_by_timeout() {
        let task = tokio::task::spawn_blocking(|| {
            std::thread::sleep(Duration::from_secs(1));
        });
        let result = tokio::time::timeout(Duration::from_millis(100), task).await;
        assert!(
            result.is_err(),
            "expected the timeout to fire before the stuck blocking task finished"
        );
    }

    #[tokio::test]
    async fn build_focus_context_bounded_reads_a_normal_file_quickly() {
        let dir = std::env::temp_dir().join("nest-agent-focus-context-bounded");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("note.md"), "hello from the vault").unwrap();

        let result =
            build_focus_context_bounded(dir, vec!["note.md".to_string()], Duration::from_secs(5))
                .await
                .expect("a normal, fast file read should not time out");

        assert!(result.text.contains("hello from the vault"));
        assert_eq!(result.citations.len(), 1);
    }

    #[test]
    fn authentication_errors_do_not_expose_provider_response_bodies() {
        let settings = AppSettings {
            llm_base_url: "https://openrouter.ai/api/v1".into(),
            ..AppSettings::default()
        };
        let message = llm_request_error(
            &settings,
            "CompletionError: HttpError: Invalid status code 401 Unauthorized with message: secret",
        );
        assert_eq!(
            message,
            "LLM authentication failed at openrouter.ai. Check that the API key belongs to this provider and that the Base URL is correct in Settings."
        );
        assert!(!message.contains("secret"));
    }

    #[test]
    fn folder_focus_collects_nested_markdown_files() {
        let folder = TreeNode {
            name: "cubicles".into(),
            path: "cubicles".into(),
            kind: TreeNodeKind::Folder,
            children: Some(vec![
                TreeNode {
                    name: "README.md".into(),
                    path: "cubicles/README.md".into(),
                    kind: TreeNodeKind::File,
                    children: None,
                },
                TreeNode {
                    name: "guides".into(),
                    path: "cubicles/guides".into(),
                    kind: TreeNodeKind::Folder,
                    children: Some(vec![TreeNode {
                        name: "usage.md".into(),
                        path: "cubicles/guides/usage.md".into(),
                        kind: TreeNodeKind::File,
                        children: None,
                    }]),
                },
            ]),
        };

        let mut files = Vec::new();
        collect_markdown_files(&folder, &mut files);
        assert_eq!(
            files,
            vec!["cubicles/README.md", "cubicles/guides/usage.md"]
        );
    }

    #[test]
    fn direct_focus_is_evidence_when_indexed_retrieval_is_empty() {
        let focused = Citation {
            chunk_id: "focus:cubicles/README.md".into(),
            file_path: "cubicles/README.md".into(),
            title: "README.md".into(),
            snippet: "Cubicles documentation".into(),
            score: 1.0,
        };
        let preamble = agent_preamble_with_retrieval(&[focused], true, &[]);
        assert!(preamble.contains("authoritative local evidence"));
        assert!(!preamble.contains("No relevant passages were retrieved"));
    }

    #[test]
    fn active_packs_are_listed_even_without_citations() {
        let pack = InstalledPack {
            pack_id: "cooking".into(),
            name: "Cooking Basics".into(),
            local_path: "cooking-pack".into(),
            version: "1.0.0".into(),
            patch_revision: 0,
            last_synced: None,
            active: true,
            origin: "hub".into(),
            owner_id: None,
            description: String::new(),
            pending_version: None,
            pending_request_type: None,
            pending_patch_revision: None,
            pending_request_id: None,
            publish_review_status: None,
            publish_review_created_at: None,
            pending_can_cancel: false,
        };
        let preamble = agent_preamble_with_retrieval(&[], false, &[pack]);
        assert!(preamble.contains("Cooking Basics"));
        assert!(preamble.contains("cooking-pack"));
    }

    #[test]
    fn focused_references_are_kept_and_deduplicate_search_hits_by_file() {
        let focused = Citation {
            chunk_id: "focus:cubicles/README.md".into(),
            file_path: "cubicles/README.md".into(),
            title: "README.md".into(),
            snippet: "full focused file".into(),
            score: 1.0,
        };
        let duplicate_hit = Citation {
            chunk_id: "chunk-1".into(),
            file_path: "cubicles/README.md".into(),
            title: "Cubicles".into(),
            snippet: "search excerpt".into(),
            score: 0.8,
        };

        let merged = merge_citations(vec![focused], vec![duplicate_hit]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].chunk_id, "focus:cubicles/README.md");
    }
}
