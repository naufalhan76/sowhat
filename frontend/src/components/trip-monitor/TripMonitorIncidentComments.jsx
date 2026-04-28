import React, { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';

const defaultFmtDate = (value) => value || '-';

export function TripMonitorIncidentComments({ incidentId, webSessionUser, fmtDate = defaultFmtDate }) {
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [commentCount, setCommentCount] = useState(0);

  const fetchComments = async (signal) => {
    if (!incidentId) {
      setComments([]);
      setCommentCount(0);
      return;
    }

    try {
      const response = await fetch(`/api/tms/incidents/${encodeURIComponent(incidentId)}/comments`, { signal });
      if (!response.ok) throw new Error(`Failed to load comments (${response.status})`);
      const data = await response.json();
      const nextComments = Array.isArray(data?.comments) ? data.comments : [];
      setComments(nextComments);
      setCommentCount(nextComments.length);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setComments([]);
        setCommentCount(0);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchComments(controller.signal);
    return () => controller.abort();
  }, [incidentId]);

  const handleSubmit = async () => {
    const text = commentText.trim();
    if (!incidentId || !text || busy) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/tms/incidents/${encodeURIComponent(incidentId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: text }),
      });
      if (!response.ok) throw new Error(`Failed to save comment (${response.status})`);
      const data = await response.json();
      if (data?.ok === false) throw new Error(data?.error || 'Failed to save comment');

      setCommentText('');
      setShowForm(false);
      setShowComments(true);
      await fetchComments();
    } catch (_) {
      // Keep the form open so the user can retry without losing the draft.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="trip-monitor-incident-comments-section" data-user={webSessionUser?.username || undefined}>
      <div className="trip-monitor-incident-actions">
        <button
          type="button"
          className={`sf-btn sf-btn-xs ${showForm ? 'sf-btn-primary' : 'sf-btn-light'}`}
          onClick={() => {
            setShowForm((current) => !current);
            setShowComments(false);
          }}
        >
          <MessageSquare size={12} /> Add
        </button>
        <button
          type="button"
          className={`sf-btn sf-btn-xs ${showComments ? 'sf-btn-primary' : 'sf-btn-light'}`}
          onClick={() => {
            setShowComments((current) => !current);
            setShowForm(false);
          }}
          aria-label={`${commentCount} komentar`}
        >
          <MessageSquare size={12} /> {commentCount}
        </button>
      </div>

      {(showForm || showComments) ? (
        <div className="trip-monitor-comment-card">
          {showForm ? (
            <div className="trip-monitor-comment-form">
              <textarea
                rows={3}
                aria-label="Komentar trip"
                placeholder="Tulis komentar..."
                value={commentText}
                disabled={busy}
                onChange={(event) => setCommentText(event.target.value)}
              />
              <div className="trip-monitor-comment-form-actions">
                <button
                  type="button"
                  className="sf-btn sf-btn-light sf-btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setShowForm(false);
                    setCommentText('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="sf-btn sf-btn-primary sf-btn-sm"
                  disabled={busy || !commentText.trim()}
                  onClick={handleSubmit}
                >
                  {busy ? 'Saving...' : 'Submit'}
                </button>
              </div>
            </div>
          ) : null}

          {showComments ? (
            <div className="trip-monitor-comment-list-container">
              {comments.length ? (
                <div className="trip-monitor-comment-list">
                  {comments.map((comment, index) => (
                    <div key={comment.id || `${incidentId}-comment-${index}`} className="trip-monitor-comment-item">
                      <div className="trip-monitor-comment-meta">
                        <strong>{comment.display_name || comment.displayName || comment.username || '-'}</strong>
                        <span>{fmtDate(comment.created_at || comment.createdAt)}</span>
                      </div>
                      <div className="trip-monitor-comment-text">{comment.comment || '-'}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">Belum ada komentar.</div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
