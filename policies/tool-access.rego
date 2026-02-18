# ABOUTME: OPA policy for controlling agent access to MCP tools by category.
# ABOUTME: Classifies tools as read/write/destructive and enforces allow/deny rules.
package tool_access

default allow := false

# Tool-to-category mapping for reference and validation.
tool_categories := {
	"list_files": "read",
	"read_file": "read",
	"get_system_info": "read",
	"write_file": "write",
	"create_directory": "write",
	"delete_file": "destructive",
	"execute_command": "destructive",
}

# Categories that are permitted. Read and write are allowed;
# destructive operations are denied by default.
allowed_categories := {"read", "write"}

# Tools that are explicitly allowed regardless of other rules.
allowed_tools := {
	"list_files",
	"read_file",
	"get_system_info",
	"write_file",
	"create_directory",
}

# Tools that are explicitly denied. This overrides allowed_tools
# and category-level permissions.
denied_tools := set()

# category_allowed is true when the tool's category is in the
# allowed_categories set.
category_allowed if {
	input.category in allowed_categories
}

# tool_explicitly_denied is true when the tool appears in the
# denied_tools set.
tool_explicitly_denied if {
	input.tool in denied_tools
}

# Allow a tool call when its category is permitted and it has
# not been explicitly denied.
allow if {
	category_allowed
	not tool_explicitly_denied
}
