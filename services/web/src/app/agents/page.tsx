// ABOUTME: Agent control panel for managing agent lifecycle and submitting tasks.
// ABOUTME: Displays agent status, task submission form, and client-tracked task history.
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentStatus, AgentTask } from "@/types";
import styles from "./page.module.css";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function AgentsPage() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [taskInput, setTaskInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ id: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
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

  // Auto-refresh agent status every 10s
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Poll running tasks every 3s
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

      // Track the task client-side
      if (!taskIdsRef.current.has(data.task_id)) {
        taskIdsRef.current.add(data.task_id);
        const taskDetail = await fetchTask(data.task_id);
        if (taskDetail) {
          setTasks((prev) => [taskDetail, ...prev]);
        } else {
          // Fallback if immediate fetch fails
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

  const statusBadgeClass = (taskStatus: AgentTask["status"]) => {
    switch (taskStatus) {
      case "pending": return styles.badgePending;
      case "running": return styles.badgeRunning;
      case "completed": return styles.badgeCompleted;
      case "failed": return styles.badgeFailed;
    }
  };

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Agent Control Panel</h1>
          <p className={styles.subtitle}>Manage agent tasks and monitor status</p>
        </div>
        <div className={styles.controls}>
          <span className={styles.pollingIndicator}>
            <span className={styles.pollingDot} />
            10s
          </span>
        </div>
      </div>

      {statusError && <div className={styles.errorState}>{statusError}</div>}

      {/* Status Cards */}
      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Status</div>
          <div className={`${styles.cardValue} ${status?.ready ? styles.statusReady : styles.statusNotReady}`}>
            {status ? (status.ready ? "Ready" : "Not Ready") : "\u2014"}
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Model</div>
          <div className={styles.cardValue} style={{ fontSize: "1rem", fontFamily: "var(--font-mono)" }}>
            {status?.model ?? "\u2014"}
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Tools Loaded</div>
          <div className={styles.cardValue}>
            {status?.tools_loaded ?? "\u2014"}
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Tasks Total</div>
          <div className={styles.cardValue}>
            {status?.tasks_total ?? "\u2014"}
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Tasks Running</div>
          <div className={styles.cardValue}>
            {status?.tasks_running ?? "\u2014"}
          </div>
        </div>
      </div>

      {/* Tool Names */}
      {status && status.tool_names.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Loaded Tools</div>
          <div className={styles.toolGrid}>
            {status.tool_names.map((name) => (
              <span key={name} className={styles.toolChip}>{name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Task Submission */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Submit Task</div>
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
              <span className={styles.errorState} style={{ padding: 0 }}>{submitError}</span>
            )}
          </div>
        </div>
      </div>

      {/* Task History */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Task History</div>
        {tasks.length === 0 ? (
          <div className={styles.emptyState}>No tasks submitted yet</div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Task ID</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const isExpanded = expandedTaskId === task.id;
                  return (
                    <tr
                      key={task.id}
                      className={isExpanded ? styles.taskRowExpanded : styles.taskRow}
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                    >
                      <td className={styles.taskId}>{task.id.substring(0, 12)}...</td>
                      <td className={styles.taskDescription}>{task.task}</td>
                      <td><span className={statusBadgeClass(task.status)}>{task.status}</span></td>
                      <td className={styles.timestamp}>{formatTimestamp(task.created_at)}</td>
                      <td className={styles.timestamp}>
                        {task.completed_at ? formatTimestamp(task.completed_at) : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Expanded Task Detail */}
      {expandedTaskId && (
        <TaskDetail
          task={tasks.find((t) => t.id === expandedTaskId) ?? null}
          onClose={() => setExpandedTaskId(null)}
        />
      )}
    </div>
  );
}

function TaskDetail({ task, onClose }: { task: AgentTask | null; onClose: () => void }) {
  if (!task) return null;

  return (
    <div className={styles.taskDetail}>
      <div className={styles.taskDetailHeader}>
        <span className={styles.taskDetailTitle}>Task {task.id.substring(0, 16)}...</span>
        <button className={styles.closeButton} onClick={onClose}>{"\u00D7"}</button>
      </div>

      <div className={styles.taskDetailLabel}>Description</div>
      <div className={styles.taskDetailContent}>{task.task}</div>

      {task.result && (
        <>
          <div className={styles.taskDetailLabel}>Result</div>
          <div className={styles.taskDetailContent}>{task.result}</div>
        </>
      )}

      {task.error && (
        <>
          <div className={styles.taskDetailLabel}>Error</div>
          <div className={styles.taskDetailError}>{task.error}</div>
        </>
      )}
    </div>
  );
}
