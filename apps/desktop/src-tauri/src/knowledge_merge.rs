#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeOutcome {
    Clean(String),
    Conflicted,
}

enum Hunk {
    Unchanged,
    Inserted,
    Deleted,
}

fn split_lines(text: &str) -> Vec<&str> {
    text.split('\n').collect()
}

fn hunk_patch(old: &[&str], new: &[&str], max_cells: usize) -> Option<Vec<Hunk>> {
    let n = old.len();
    let m = new.len();
    if n.checked_add(1)
        .and_then(|rows| {
            m.checked_add(1)
                .and_then(|columns| rows.checked_mul(columns))
        })
        .is_none_or(|cells| cells > max_cells)
    {
        return None;
    }
    let mut table = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            table[i][j] = if old[i] == new[j] {
                table[i + 1][j + 1] + 1
            } else {
                table[i + 1][j].max(table[i][j + 1])
            };
        }
    }
    let mut patch = Vec::new();
    let mut i = 0;
    let mut j = 0;
    while i < n && j < m {
        if old[i] == new[j] {
            patch.push(Hunk::Unchanged);
            i += 1;
            j += 1;
        } else if table[i + 1][j] >= table[i][j + 1] {
            patch.push(Hunk::Deleted);
            i += 1;
        } else {
            patch.push(Hunk::Inserted);
            j += 1;
        }
    }
    while i < n {
        patch.push(Hunk::Deleted);
        i += 1;
    }
    while j < m {
        patch.push(Hunk::Inserted);
        j += 1;
    }
    Some(patch)
}

pub fn merge_text(base: &str, proposed: &str, current: &str) -> MergeOutcome {
    merge_text_with_budget(base, proposed, current, 4_000_000)
}

fn merge_text_with_budget(
    base: &str,
    proposed: &str,
    current: &str,
    max_cells: usize,
) -> MergeOutcome {
    if proposed == current {
        return MergeOutcome::Clean(current.to_string());
    }
    let base_lines = split_lines(base);
    let proposed_lines = split_lines(proposed);
    let current_lines = split_lines(current);
    let Some(proposed_patch) = hunk_patch(&base_lines, &proposed_lines, max_cells) else {
        return MergeOutcome::Conflicted;
    };
    let Some(current_patch) = hunk_patch(&base_lines, &current_lines, max_cells) else {
        return MergeOutcome::Conflicted;
    };
    let mut base_idx = 0;
    let mut proposed_hunks: Vec<(usize, usize)> = Vec::new();
    let mut current_hunks: Vec<(usize, usize)> = Vec::new();
    collect_hunks(&proposed_patch, &mut proposed_hunks, &mut base_idx);
    base_idx = 0;
    collect_hunks(&current_patch, &mut current_hunks, &mut base_idx);
    for (ps, pe) in &proposed_hunks {
        for (cs, ce) in &current_hunks {
            let overlaps = (ps < ce && cs < pe) || ps == cs;
            if overlaps {
                return MergeOutcome::Conflicted;
            }
        }
    }
    let mut combined: Vec<(usize, usize, String)> = Vec::new();
    for (start, end) in &proposed_hunks {
        let segment = proposed_lines[inserted_range(&proposed_patch, *start, *end)].join("\n");
        combined.push((*start, *end, segment));
    }
    for (start, end) in &current_hunks {
        let segment = current_lines[inserted_range(&current_patch, *start, *end)].join("\n");
        combined.push((*start, *end, segment));
    }
    combined.sort_by_key(|(start, _, _)| *start);
    let mut result: Vec<String> = Vec::new();
    let mut consumed = 0;
    for (start, end, segment) in &combined {
        while consumed < *start {
            if consumed < base_lines.len() {
                result.push(base_lines[consumed].to_string());
            }
            consumed += 1;
        }
        if !segment.is_empty() {
            for line in segment.split('\n') {
                result.push(line.to_string());
            }
        }
        consumed = *end;
    }
    while consumed < base_lines.len() {
        result.push(base_lines[consumed].to_string());
        consumed += 1;
    }
    MergeOutcome::Clean(result.join("\n"))
}

fn collect_hunks(patch: &[Hunk], hunks: &mut Vec<(usize, usize)>, base_idx: &mut usize) {
    let mut start: Option<usize> = None;
    for hunk in patch {
        match hunk {
            Hunk::Unchanged => {
                if let Some(s) = start {
                    hunks.push((s, *base_idx));
                    start = None;
                }
                *base_idx += 1;
            }
            Hunk::Deleted => {
                if start.is_none() {
                    start = Some(*base_idx);
                }
                *base_idx += 1;
            }
            Hunk::Inserted => {
                if start.is_none() {
                    start = Some(*base_idx);
                }
            }
        }
    }
    if let Some(s) = start {
        hunks.push((s, *base_idx));
    }
}

fn inserted_range(patch: &[Hunk], start: usize, end: usize) -> std::ops::Range<usize> {
    let mut base_idx = 0;
    let mut new_idx = 0;
    let mut range_start: Option<usize> = None;
    let mut range_end = new_idx;
    for hunk in patch {
        match hunk {
            Hunk::Unchanged => {
                if range_start.is_none() && base_idx >= start && base_idx < end {
                    range_start = Some(new_idx);
                }
                if base_idx >= end && range_start.is_some() {
                    range_end = new_idx;
                    break;
                }
                base_idx += 1;
                new_idx += 1;
            }
            Hunk::Deleted => {
                if range_start.is_none() && base_idx >= start && base_idx < end {
                    range_start = Some(new_idx);
                }
                base_idx += 1;
            }
            Hunk::Inserted => {
                if range_start.is_none() && base_idx >= start {
                    range_start = Some(new_idx);
                }
                new_idx += 1;
            }
        }
    }
    if range_end < range_start.unwrap_or(0) {
        range_end = new_idx;
    }
    range_start.unwrap_or(new_idx)..range_end.max(range_start.unwrap_or(new_idx))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_change_is_clean() {
        let outcome = merge_text("a\nb\nc", "a\nX\nc", "a\nX\nc");
        assert_eq!(outcome, MergeOutcome::Clean("a\nX\nc".into()));
    }

    #[test]
    fn independent_hunks_merge_cleanly() {
        let outcome = merge_text("a\nb\nc\nd\ne", "A\nb\nc\nd\ne", "a\nb\nc\nd\nE");
        assert_eq!(outcome, MergeOutcome::Clean("A\nb\nc\nd\nE".into()));
    }

    #[test]
    fn adjacent_hunks_are_not_conflict() {
        let outcome = merge_text("a\nb\nc", "a\nP\nc", "a\nb\nQ\nc");
        match outcome {
            MergeOutcome::Clean(text) => {
                assert!(text.contains('P'));
                assert!(text.contains('Q'));
            }
            MergeOutcome::Conflicted => panic!("adjacent edits should merge"),
        }
    }

    #[test]
    fn overlapping_hunks_conflict() {
        let outcome = merge_text("a\nb\nc", "a\nP1\nc", "a\nP2\nc");
        assert_eq!(outcome, MergeOutcome::Conflicted);
    }

    #[test]
    fn insertions_at_same_spot_conflict_when_different() {
        let outcome = merge_text("a\nb", "a\nX\nb", "a\nY\nb");
        assert_eq!(outcome, MergeOutcome::Conflicted);
    }

    #[test]
    fn identical_insertions_merge_to_one() {
        let outcome = merge_text("a\nb", "a\nX\nb", "a\nX\nb");
        assert_eq!(outcome, MergeOutcome::Clean("a\nX\nb".into()));
    }

    #[test]
    fn delete_vs_modify_conflicts() {
        let outcome = merge_text("a\nb\nc", "a\nc", "a\nB2\nc");
        assert_eq!(outcome, MergeOutcome::Conflicted);
    }

    #[test]
    fn proposed_already_applied_resolves() {
        let outcome = merge_text("a\nb\nc", "a\nNEW\nc", "a\nNEW\nc");
        assert_eq!(outcome, MergeOutcome::Clean("a\nNEW\nc".into()));
    }

    #[test]
    fn create_create_different_conflicts() {
        let outcome = merge_text("", "one", "two");
        assert_eq!(outcome, MergeOutcome::Conflicted);
    }

    #[test]
    fn crlf_content_merges_as_text() {
        let outcome = merge_text("a\r\nb\r\nc", "X\r\nb\r\nc", "a\r\nb\r\nY");
        match outcome {
            MergeOutcome::Clean(text) => {
                assert!(text.starts_with("X\r\n"));
                assert!(text.ends_with("Y"));
            }
            MergeOutcome::Conflicted => panic!("independent CRLF edits should merge"),
        }
    }

    #[test]
    fn utf8_multibyte_lines_merge() {
        let outcome = merge_text("一\n二\n三", "改\n二\n三", "一\n二\n变");
        assert_eq!(outcome, MergeOutcome::Clean("改\n二\n变".into()));
    }

    #[test]
    fn merge_budget_fails_closed_before_allocating_a_large_matrix() {
        let base = (0..100)
            .map(|n| format!("line {n}"))
            .collect::<Vec<_>>()
            .join("\n");
        let proposed = base.replace("line 1", "proposed");
        let current = base.replace("line 99", "current");

        assert_eq!(
            merge_text_with_budget(&base, &proposed, &current, 100),
            MergeOutcome::Conflicted
        );
    }
}
