from sovereignhalt import EnforcementHandler, ToolCall


handler = EnforcementHandler()


def tool(call):
    print(f"EXECUTED {call.tool}")
    return "ok"
print("handler active")
print("starting intentional loop")
call = ToolCall("loop-agent", "read_invoice", {"invoice_id": "INV-2048"})
for attempt in range(1, 6):
    result = handler.handle(call, tool)
    print(
        f"attempt={attempt} decision={result.decision.action} "
        f"executed={result.executed} reason={result.decision.reason}"
    )
