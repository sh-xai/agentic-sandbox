# ABOUTME: OPA policy for controlling agent access to MCP tools by category.
# ABOUTME: Classifies tools as read/write/destructive and enforces allow/deny rules.
package tool_access

default allow := false
