# Rollback Runbook

## Preconditions

- Deploy marker identified
- Rollback target artifact available
- Incident commander assigned

## Procedure

1. Announce rollback start in incident channel.
2. Disable automated progressive rollout.
3. Deploy previous known-good artifact.
4. Run smoke checks.
5. Re-enable normal traffic.

## Validation

- Error rate back to baseline
- Latency within SLO
- No new critical alerts
