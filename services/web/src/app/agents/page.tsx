// ABOUTME: Agent control panel for managing agent lifecycle and submitting tasks.
// ABOUTME: Stats bar, tool chips, task form, searchable task table with expandable detail rows.
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { AgentStatus, AgentTask } from "@/types";
import styles from "./page.module.css";

// --- Helpers ---

function formatRelativeTime(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

type TaskFilter = "all" | "pending" | "running" | "completed" | "failed";

function statusDotColor(taskStatus: AgentTask["status"]): string {
  switch (taskStatus) {
    case "pending": return "var(--warning)";
    case "running": return "var(--accent)";
    case "completed": return "var(--success)";
    case "failed": return "var(--error)";
  }
}

function statusBadgeClass(taskStatus: AgentTask["status"]): string {
  switch (taskStatus) {
    case "pending": return styles.badgePending;
    case "running": return styles.badgeRunning;
    case "completed": return styles.badgeCompleted;
    case "failed": return styles.badgeFailed;
  }
}

// --- Main page ---

export default function AgentsPage() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [taskInput, setTaskInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ id: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const taskIdsRef = useRef<Set<string>>(new Set());

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AgentStatus = await res.json();
      setStatus(data);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to fetch status");
    }
  }, []);

  const fetchTask = useCallback(async (taskId: string): Promise<AgentTask | null> => {
    try {
      const res = await fetch(`/api/agent/tasks/${encodeURIComponent(taskId)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  const pollRunningTasks = useCallback(async () => {
    const running = tasks.filter((t) => t.status === "pending" || t.status === "running");
    if (running.length === 0) return;

    const updates = await Promise.all(
      running.map((t) => fetchTask(t.id))
    );

    setTasks((prev) =>
      prev.map((t) => {
        const update = updates.find((u) => u && u.id === t.id);
        return update ?? t;
      })
    );
  }, [tasks, fetchTask]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === "pending" || t.status === "running");
    if (!hasActive) return;

    const interval = setInterval(pollRunningTasks, 3000);
    return () => clearInterval(interval);
  }, [tasks, pollRunningTasks]);

  const handleSubmitTask = async () => {
    if (!taskInput.trim() || submitting) return;

    setSubmitting(true);
    setSubmitResult(null);
    setSubmitError(null);

    try {
      const res = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: taskInput.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setSubmitResult({ id: data.task_id });
      setTaskInput("");

      if (!taskIdsRef.current.has(data.task_id)) {
        taskIdsRef.current.add(data.task_id);
        const taskDetail = await fetchTask(data.task_id);
        if (taskDetail) {
          setTasks((prev) => [taskDetail, ...prev]);
        } else {
          setTasks((prev) => [
            {
              id: data.task_id,
              task: taskInput.trim(),
              status: data.status || "pending",
              result: null,
              error: null,
              created_at: new Date().toISOString(),
              completed_at: null,
            },
            ...prev,
          ]);
        }
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit task");
    } finally {
      setSubmitting(false);
    }
  };

  // Task counts
  const taskCounts = useMemo(() => {
    const counts = { pending: 0, running: 0, completed: 0, failed: 0 };
    for (const t of tasks) {
      counts[t.status]++;
    }
    return counts;
  }, [tasks]);

  // Filtered tasks
  const filtered = useMemo(() => {
    let result = tasks;

    if (filter !== "all") {
      result = result.filter((t) => t.status === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.task.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (t.result ?? "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [tasks, filter, search]);

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Agent Control Panel</h1>
          <p className={styles.subtitle}>Manage agent tasks and monitor status</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.liveDot} />
          <span className={styles.liveText}>10s</span>
        </div>
      </div>

      {statusError && <div className={styles.errorBanner}>{statusError}</div>}

      {/* Stats bar */}
      <div className={styles.statsBar}>
        <div className={styles.stat}>
          <span className={`${styles.statValue} ${
            status ? (status.ready ? styles.statSuccess : styles.statDanger) : ""
          }`}>
            {status ? (status.ready ? "Ready" : "Not Ready") : "\u2014"}
          </span>
          <span className={styles.statLabel}>Status</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue} style={{ fontSize: "0.875rem" }}>
            {status?.model ?? "\u2014"}
          </span>
          <span className={styles.statLabel}>Model</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{status?.tools_loaded ?? "\u2014"}</span>
          <span className={styles.statLabel}>Tools</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{status?.tasks_total ?? "\u2014"}</span>
          <span className={styles.statLabel}>Tasks Total</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{status?.tasks_running ?? "\u2014"}</span>
          <span className={styles.statLabel}>Running</span>
        </div>
      </div>

      {/* Tool chips */}
      {status && status.tool_names.length > 0 && (
        <div className={styles.toolRow}>
          {status.tool_names.map((name) => (
            <span key={name} className={styles.toolChip}>{name}</span>
          ))}
        </div>
      )}

      {/* Task submission */}
      <div className={styles.taskForm}>
        <textarea
          className={styles.taskTextarea}
          placeholder="Describe the task for the agent..."
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          disabled={!status?.ready || submitting}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              handleSubmitTask();
            }
          }}
        />
        <div className={styles.formActions}>
          <button
            className={styles.submitButton}
            onClick={handleSubmitTask}
            disabled={!status?.ready || submitting || !taskInput.trim()}
          >
            {submitting ? "Submitting..." : "Submit Task"}
          </button>
          {submitResult && (
            <span className={styles.taskSubmitted}>
              Submitted: <span className={styles.taskSubmittedId}>{submitResult.id.substring(0, 12)}...</span>
            </span>
          )}
          {submitError && (
            <span className={styles.errorText}>{submitError}</span>
          )}
        </div>
      </div>

      {/* Task toolbar */}
      <div className={styles.sectionLabel}>Task History</div>
      {tasks.length > 0 && (
        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}>&#x1F50D;</span>
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.searchInput}
            />
            {search && (
              <button className={styles.searchClear} onClick={() => setSearch("")}>
                &times;
              </button>
            )}
          </div>
          <div className={styles.filterGroup}>
            {(
              [
                ["all", "All"],
                ["pending", "Pending"],
                ["running", "Running"],
                ["completed", "Completed"],
                ["failed", "Failed"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={`${styles.filterBtn} ${filter === key ? styles.filterBtnActive : ""}`}
                onClick={() => setFilter(key)}
              >
                {label}
                {key !== "all" && (
                  <span className={styles.filterBadge}>
                    {taskCounts[key as keyof typeof taskCounts] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Task table */}
      {tasks.length === 0 ? (
        <div className={styles.emptyState}>No tasks submitted yet</div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>No tasks match the current filters</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colStatus}></th>
                <th className={styles.colBadge}>Status</th>
                <th className={styles.colTaskId}>Task ID</th>
                <th>Description</th>
                <th className={styles.colTime}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  expanded={expandedTaskId === task.id}
                  onToggle={() =>
                    setExpandedTaskId((prev) =>
                      prev === task.id ? null : task.id
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Task row ---

function TaskRow({
  task,
  expanded,
  onToggle,
}: {
  task: AgentTask;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`${styles.taskRow} ${expanded ? styles.taskRowExpanded : ""}`}
        onClick={onToggle}
      >
        <td className={styles.colStatus}>
          <span
            className={`${styles.statusDot} ${task.status === "running" ? styles.statusDotPulse : ""}`}
            style={{ background: statusDotColor(task.status) }}
          />
        </td>
        <td className={styles.colBadge}>
          <span className={`${styles.typeBadge} ${statusBadgeClass(task.status)}`}>
            {task.status.toUpperCase()}
          </span>
        </td>
        <td className={styles.colTaskId}>
          <span className={styles.taskIdText}>{task.id.substring(0, 12)}...</span>
        </td>
        <td className={styles.colDescription}>
          {task.task}
        </td>
        <td className={styles.colTime} title={formatTimestamp(task.created_at)}>
          {formatRelativeTime(task.created_at)}
        </td>
      </tr>
      {expanded && (
        <tr className={styles.detailRow}>
          <td colSpan={5}>
            <TaskDetail task={task} />
          </td>
        </tr>
      )}
    </>
  );
}

// --- Task detail (expandable row) ---

function TaskDetail({ task }: { task: AgentTask }) {
  return (
    <div className={styles.detail}>
      <div className={styles.detailGrid}>
        <span className={styles.detailKey}>Task ID</span>
        <span className={styles.detailVal}>{task.id}</span>
        <span className={styles.detailKey}>Status</span>
        <span className={styles.detailVal}>{task.status}</span>
        <span className={styles.detailKey}>Created</span>
        <span className={styles.detailVal}>{formatTimestamp(task.created_at)}</span>
        {task.completed_at && (
          <>
            <span className={styles.detailKey}>Completed</span>
            <span className={styles.detailVal}>{formatTimestamp(task.completed_at)}</span>
          </>
        )}
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailLabel}>Description</div>
        <pre className={styles.detailContent}>{task.task}</pre>
      </div>

      {task.result && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Result</div>
          <pre className={styles.detailContent}>{task.result}</pre>
        </div>
      )}

      {task.error && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Error</div>
          <pre className={styles.detailContentError}>{task.error}</pre>
        </div>
      )}
    </div>
  );
}
