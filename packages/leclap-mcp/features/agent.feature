Feature: Agent drives the leclap MCP server over stdio

  An MCP client connects to the built stdio server and exercises every tool on the
  authoring surface — schema, validate, Remotion-assisted authoring, a real render,
  and a probe — proving the JSON-RPC framing survives a pino-heavy render through the
  forked worker (no fd-1 stdout corruption). Each call is timed; the instant tools are
  held under a latency budget and a per-tool efficiency table is printed at the end.

  Background:
    Given a running leclap MCP server

  Scenario: Discover the authoring schema
    When the agent requests the template schema
    Then the schema includes sections
    And the "get_template_schema" call ran in under 1500 ms

  Scenario: Validate a well-formed inline template
    When the agent validates a valid inline template
    Then the template is reported valid
    And the "validate_template" call ran in under 1500 ms

  Scenario: Reject a malformed inline template
    When the agent validates a malformed inline template
    Then the call returns an error
    And the "validate_template:invalid" call ran in under 1500 ms

  Scenario: Author with the compose-video prompt
    When the agent opens the compose-video prompt
    Then it receives a primed authoring message
    And the "compose-video:prompt" call ran in under 1500 ms

  Scenario: Compose a video from an inline template
    When the agent composes the color-card template
    Then it receives an output path that exists
    And the render has a positive duration and non-zero size

  Scenario: Learn why a render failed
    When the agent composes a template whose filter FFmpeg rejects
    Then the call returns an error
    And the error leads with the reason the engine gave

  Scenario: Probe the rendered file
    When the agent composes the color-card template
    And the agent probes the rendered file
    Then it reports a video codec
