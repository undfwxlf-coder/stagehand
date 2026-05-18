import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import type { TrackComment } from "../lib/database.types";
import {
  deleteTrackComment,
  formatTimestamp,
  listTrackComments,
  looksLikeReaction,
  postTrackComment,
} from "../lib/comments";
import { formatErr } from "../lib/errors";

const QUICK_REACTIONS = ["🔥", "❤️", "😍", "👏", "💯", "🤯"];

interface Props {
  trackId: string;
  slug?: string;
  versionId?: string | null;
  currentTimeSec: number;
  onSeek?: (sec: number) => void;
  canPost: boolean;
  signInHref?: string;
  // When true, suppresses the composer (e.g. on Insights inside the details sheet).
  readOnly?: boolean;
}

export default function CommentFeed({
  trackId,
  slug,
  versionId,
  currentTimeSec,
  onSeek,
  canPost,
  signInHref = "/auth",
  readOnly = false,
}: Props) {
  const [comments, setComments] = useState<TrackComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const composerRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listTrackComments(trackId, { slug });
      setComments(rows);
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  }, [trackId, slug]);

  useEffect(() => {
    setLoading(true);
    setComments([]);
    void refresh();
  }, [refresh]);

  const post = async (body: string, isReaction: boolean) => {
    if (!body.trim() || posting) return;
    setPosting(true);
    setErr(null);
    try {
      await postTrackComment({
        trackId,
        body: body.trim(),
        timestampSec: Math.max(0, currentTimeSec),
        isReaction,
        slug,
        versionId: versionId ?? null,
      });
      setDraft("");
      await refresh();
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setPosting(false);
    }
  };

  const onSend = () => post(draft, looksLikeReaction(draft));

  const onReact = (emoji: string) => post(emoji, true);

  const onDelete = async (id: string) => {
    if (!confirm("Delete this comment?")) return;
    setDeletingId(id);
    try {
      await deleteTrackComment(id);
      setComments((cs) => cs.filter((c) => c.id !== id));
    } catch (e) {
      alert(formatErr(e));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="bg-panel border border-edge rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={14} className="text-muted" />
        <h2 className="text-sm uppercase tracking-wider text-muted">
          Comments {comments.length > 0 && <span className="text-white/60">· {comments.length}</span>}
        </h2>
      </div>

      {!readOnly && canPost && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => composerRef.current?.focus()}
              className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-accent/15 text-accent tabular-nums"
              title="Pin to current playhead"
            >
              @ {formatTimestamp(currentTimeSec)}
            </button>
            <div className="flex items-center gap-1">
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => onReact(e)}
                  disabled={posting}
                  className="w-7 h-7 rounded-full hover:bg-panel2 active:scale-95 transition text-base leading-none disabled:opacity-60"
                  aria-label={`React ${e}`}
                  title={`React ${e} at ${formatTimestamp(currentTimeSec)}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="Leave a note at this timestamp…"
              maxLength={1000}
              disabled={posting}
              className="flex-1 bg-panel2 border border-edge rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted focus:outline-none focus:border-accent/60 disabled:opacity-60"
            />
            <button
              onClick={onSend}
              disabled={posting || !draft.trim()}
              className="shrink-0 w-9 h-9 rounded-lg bg-accent hover:bg-accent/90 text-white flex items-center justify-center disabled:opacity-40"
              aria-label="Post comment"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      {!readOnly && !canPost && (
        <div className="mb-4 text-xs text-muted">
          <a href={signInHref} className="underline hover:text-white">Sign in</a> to leave a comment or reaction.
        </div>
      )}

      {err && <p className="text-xs text-red-400 mb-3">{err}</p>}

      {loading ? (
        <p className="text-xs text-muted py-3">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted py-3">No comments yet. Pin a thought to a moment in the track.</p>
      ) : (
        <ul className="divide-y divide-edge -mx-4 sm:-mx-5">
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              onSeek={onSeek}
              onDelete={onDelete}
              deleting={deletingId === c.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentRow({
  comment,
  onSeek,
  onDelete,
  deleting,
}: {
  comment: TrackComment;
  onSeek?: (sec: number) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const name = comment.artist_name || "Anonymous";
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const isReaction = comment.is_reaction || looksLikeReaction(comment.body);

  return (
    <li className="px-4 sm:px-5 py-3 flex items-start gap-3">
      <div className="w-7 h-7 shrink-0 rounded-full bg-panel2 border border-edge overflow-hidden flex items-center justify-center text-[11px] text-muted">
        {comment.avatar_url ? (
          <img src={comment.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span>{initial}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs text-white truncate">{name}</span>
          <button
            onClick={() => onSeek?.(comment.timestamp_sec)}
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/15 text-accent tabular-nums hover:bg-accent/25"
            title="Jump to this moment"
          >
            {formatTimestamp(comment.timestamp_sec)}
          </button>
          <span className="text-[10px] text-muted">{relativeTime(comment.created_at)}</span>
        </div>
        {isReaction ? (
          <span className="text-2xl leading-none">{comment.body}</span>
        ) : (
          <p className="text-sm text-white/90 break-words whitespace-pre-wrap">{comment.body}</p>
        )}
      </div>
      {comment.is_mine && (
        <button
          onClick={() => onDelete(comment.id)}
          disabled={deleting}
          className="shrink-0 text-muted hover:text-red-400 disabled:opacity-50"
          aria-label="Delete comment"
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      )}
    </li>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
