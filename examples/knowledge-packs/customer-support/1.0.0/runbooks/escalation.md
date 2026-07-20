# Escalation Runbook

## Trigger conditions

- Repeated customer impact
- Security/privacy concern
- Data loss or corruption risk

## Escalation flow

```mermaid
flowchart TD
  A[Agent receives ticket] --> B{Sev-1 or security?}
  B -- yes --> C[Page incident commander]
  B -- no --> D[Assign domain owner]
  C --> E[Status updates every 30 min]
  D --> E
```

## Communication

- Acknowledge quickly
- Share known scope and next update time
- Avoid speculative root causes
