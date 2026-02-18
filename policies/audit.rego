# ABOUTME: Generates audit records for every tool access decision.
# ABOUTME: Captures tool name, category, allow/deny result, and a timestamp placeholder.
package tool_access.audit

import rego.v1

import data.tool_access

# Produces an audit record summarizing the policy decision for the
# requested tool. The timestamp field is a placeholder for the
# calling service to fill in with the actual wall-clock time.
audit_record := record if {
	record := {
		"tool": input.tool,
		"category": input.category,
		"allowed": tool_access.allow,
		"reason": reason,
		"timestamp": "TIMESTAMP_PLACEHOLDER",
	}
}

# Derive a human-readable reason for the decision.
reason := "tool explicitly denied" if {
	tool_access.tool_explicitly_denied
} else := "category denied" if {
	not tool_access.category_allowed
} else := "allowed" if {
	tool_access.allow
} else := "denied by default"
