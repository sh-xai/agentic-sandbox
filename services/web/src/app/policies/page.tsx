// ABOUTME: Policy management page for viewing and editing OPA tool access policies.
// ABOUTME: CRUD interface for Rego rules with a policy tester for access decisions.
"use client";

import { useState, useEffect, useCallback } from "react";
import type { OpaPolicy, OpaPoliciesResponse, PolicyTestResult } from "@/types";
import styles from "./page.module.css";

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<OpaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);

  // Editor state
  const [editorPolicyId, setEditorPolicyId] = useState("");
  const [editorRego, setEditorRego] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Tester state
  const [testTool, setTestTool] = useState("");
  const [testCategory, setTestCategory] = useState("read");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<PolicyTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch("/api/policies");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: OpaPoliciesResponse = await res.json();
      setPolicies(data.result || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch policies");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh policy list every 30s
  useEffect(() => {
    fetchPolicies();
    const interval = setInterval(fetchPolicies, 30000);
    return () => clearInterval(interval);
  }, [fetchPolicies]);

  const handleUploadPolicy = async () => {
    if (!editorPolicyId.trim() || !editorRego.trim() || uploading) return;

    setUploading(true);
    setUploadMessage(null);

    try {
      const res = await fetch(`/api/policies/${encodeURIComponent(editorPolicyId.trim())}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: editorRego,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      setUploadMessage({ type: "success", text: `Policy "${editorPolicyId.trim()}" uploaded` });
      setEditorPolicyId("");
      setEditorRego("");
      fetchPolicies();
    } catch (err) {
      setUploadMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to upload policy",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePolicy = async (policyId: string) => {
    try {
      const res = await fetch(`/api/policies/${encodeURIComponent(policyId)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      if (expandedPolicyId === policyId) {
        setExpandedPolicyId(null);
      }
      fetchPolicies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete policy");
    }
  };

  const handleTestPolicy = async () => {
    if (!testTool.trim() || testing) return;

    setTesting(true);
    setTestResult(null);
    setTestError(null);

    try {
      const res = await fetch("/api/policies/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: testTool.trim(), category: testCategory }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data: PolicyTestResult = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Failed to test policy");
    } finally {
      setTesting(false);
    }
  };

  const getPolicyPreview = (raw: string): string => {
    const lines = raw.split("\n").filter((l) => l.trim());
    return lines.slice(0, 2).join("\n");
  };

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Policy Management</h1>
          <p className={styles.subtitle}>OPA tool access policies (Rego)</p>
        </div>
        <div className={styles.controls}>
          <button onClick={fetchPolicies}>Refresh</button>
          <span className={styles.pollingIndicator}>
            <span className={styles.pollingDot} />
            30s
          </span>
        </div>
      </div>

      {error && <div className={styles.errorState}>{error}</div>}

      <div className={styles.columns}>
        {/* Left column: Policy List */}
        <div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Loaded Policies</div>
            {loading && policies.length === 0 ? (
              <div className={styles.emptyState}>Loading policies...</div>
            ) : policies.length === 0 ? (
              <div className={styles.emptyState}>No policies loaded</div>
            ) : (
              <div className={styles.policyList}>
                {policies.map((policy) => {
                  const isExpanded = expandedPolicyId === policy.id;
                  return (
                    <div
                      key={policy.id}
                      className={isExpanded ? styles.policyItemExpanded : styles.policyItem}
                      onClick={() => setExpandedPolicyId(isExpanded ? null : policy.id)}
                    >
                      <div className={styles.policyHeader}>
                        <span className={styles.policyId}>{policy.id}</span>
                        <button
                          className={styles.deleteButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePolicy(policy.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                      {!isExpanded && (
                        <div className={styles.policyPreview}>
                          {getPolicyPreview(policy.raw)}
                        </div>
                      )}
                      {isExpanded && (
                        <pre className={styles.policySource}>{policy.raw}</pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Editor and Tester */}
        <div>
          {/* Policy Editor */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Upload Policy</div>
            <div className={styles.editorForm}>
              <input
                type="text"
                className={styles.inputField}
                placeholder="Policy ID (e.g., tool_access)"
                value={editorPolicyId}
                onChange={(e) => setEditorPolicyId(e.target.value)}
              />
              <textarea
                className={styles.regoTextarea}
                placeholder={"package tool_access\n\ndefault allow = false\n\nallow {\n  input.category == \"read\"\n}"}
                value={editorRego}
                onChange={(e) => setEditorRego(e.target.value)}
              />
              <button
                className={styles.uploadButton}
                onClick={handleUploadPolicy}
                disabled={!editorPolicyId.trim() || !editorRego.trim() || uploading}
              >
                {uploading ? "Uploading..." : "Upload Policy"}
              </button>
              {uploadMessage && (
                <span className={uploadMessage.type === "success" ? styles.successMessage : styles.errorMessage}>
                  {uploadMessage.text}
                </span>
              )}
            </div>
          </div>

          {/* Policy Tester */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Test Policy</div>
            <div className={styles.testerForm}>
              <div className={styles.testerRow}>
                <div className={styles.testerField}>
                  <label className={styles.testerLabel}>Tool Name</label>
                  <input
                    type="text"
                    className={styles.inputField}
                    placeholder="e.g., read_file"
                    value={testTool}
                    onChange={(e) => setTestTool(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleTestPolicy();
                    }}
                  />
                </div>
                <div className={styles.testerField}>
                  <label className={styles.testerLabel}>Category</label>
                  <select
                    className={styles.inputField}
                    value={testCategory}
                    onChange={(e) => setTestCategory(e.target.value)}
                  >
                    <option value="read">read</option>
                    <option value="write">write</option>
                    <option value="destructive">destructive</option>
                    <option value="unknown">unknown</option>
                  </select>
                </div>
                <button
                  className={styles.testButton}
                  onClick={handleTestPolicy}
                  disabled={!testTool.trim() || testing}
                >
                  {testing ? "Testing..." : "Test"}
                </button>
              </div>
              {testResult && (
                <div className={testResult.allowed ? styles.testAllowed : styles.testDenied}>
                  <span className={styles.testResultTool}>{testResult.tool}</span>
                  ({testResult.category}):
                  {testResult.allowed ? " ALLOWED" : " DENIED"}
                </div>
              )}
              {testError && <span className={styles.errorMessage}>{testError}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
